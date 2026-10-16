import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { sanitizeEnvironment } from '../tools/local-process-runner';
import { formatMcpToolResult } from './mcp-result';
import { parseMcpToolName, sanitizeMcpToolName } from './mcp-tool-names';
import type { StderrLogger } from '../stderr-logger';
import type { ToolResult } from '../tools/read-file';
import type { RouterToolDefinition } from '@/types/router-contract';

export interface McpServerConfigBase {
  name?: string;
  [key: string]: unknown;
}

export interface McpServerStdioConfig extends McpServerConfigBase {
  type?: 'stdio' | undefined;
  command: string;
  args?: string[] | undefined;
  env?: Array<{ name: string; value: string }> | undefined;
}

export interface McpServerHttpConfig extends McpServerConfigBase {
  type: 'http';
  url: string;
  headers?: Array<{ name: string; value: string }> | undefined;
}

export type McpServerConfig = McpServerStdioConfig | McpServerHttpConfig;

interface ConnectedServer {
  serverName: string;
  client: Client;
  tools: Map<string, string>; // exposedName -> realToolName
}

export interface McpHub {
  connectServers(servers: unknown[]): Promise<void>;
  ready(timeoutMs?: number): Promise<void>;
  getTools(): RouterToolDefinition[];
  hasTool(name: string): boolean;
  executeTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
  close(): Promise<void>;
}

export function createMcpHub(logger?: StderrLogger): McpHub {
  const connectedServers: ConnectedServer[] = [];
  const toolDefinitions: RouterToolDefinition[] = [];
  const toolRegistry = new Map<string, { server: ConnectedServer; realName: string }>();
  let initPromise: Promise<void> | null = null;

  async function doConnectServers(servers: unknown[]): Promise<void> {
    for (let i = 0; i < servers.length; i++) {
        const rawServer = servers[i] as McpServerConfig | undefined;
        if (!rawServer || typeof rawServer !== 'object') {
          continue;
        }

        const serverName = rawServer.name ?? `server_${i + 1}`;

        try {
          let transport;

          if (rawServer.type === 'http' && 'url' in rawServer) {
            const headersObj: Record<string, string> = {};
            if (Array.isArray(rawServer.headers)) {
              for (const h of rawServer.headers) {
                if (h && typeof h.name === 'string' && typeof h.value === 'string') {
                  headersObj[h.name] = h.value;
                }
              }
            }

            transport = new StreamableHTTPClientTransport(new URL(rawServer.url), {
              requestInit: {
                headers: headersObj
              }
            });
          } else if ('command' in rawServer) {
            const stdioConfig = rawServer as McpServerStdioConfig;
            const customEnv: Record<string, string> = {};
            if (Array.isArray(stdioConfig.env)) {
              for (const e of stdioConfig.env) {
                if (e && typeof e.name === 'string' && typeof e.value === 'string') {
                  customEnv[e.name] = e.value;
                }
              }
            }

            const mergedEnv = {
              ...sanitizeEnvironment(),
              ...customEnv
            };

            transport = new StdioClientTransport({
              command: stdioConfig.command,
              args: stdioConfig.args ?? [],
              env: mergedEnv
            });
          } else {
            continue;
          }

          const client = new Client({
            name: '9router-acp',
            version: '0.15.0'
          });

          await client.connect(transport);
          const toolsResult = await client.listTools();

          const serverEntry: ConnectedServer = {
            serverName,
            client,
            tools: new Map()
          };

          for (const tool of toolsResult.tools) {
            const exposedName = sanitizeMcpToolName(serverName, tool.name);
            serverEntry.tools.set(exposedName, tool.name);
            toolRegistry.set(exposedName, { server: serverEntry, realName: tool.name });

            toolDefinitions.push({
              type: 'function',
              name: exposedName,
              description: `[MCP: ${serverName}] ${tool.description ?? tool.name}`,
              parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
              strict: false
            });
          }

          connectedServers.push(serverEntry);
          logger?.log('metadata', `Connected to MCP server: ${serverName} (${toolsResult.tools.length} tools)`);
        } catch (err) {
          logger?.warn(`Failed to connect to MCP server "${serverName}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

  return {
    connectServers(servers: unknown[]): Promise<void> {
      initPromise = doConnectServers(servers);
      return initPromise;
    },

    async ready(timeoutMs = 30000): Promise<void> {
      if (!initPromise) {
        return;
      }
      if (timeoutMs <= 0) {
        await initPromise;
        return;
      }
      let timeoutId: ReturnType<typeof setTimeout>;
      const timerPromise = new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([initPromise, timerPromise]);
      clearTimeout(timeoutId!);
    },

    getTools(): RouterToolDefinition[] {
      return [...toolDefinitions];
    },

    hasTool(name: string): boolean {
      return toolRegistry.has(name) || Boolean(parseMcpToolName(name));
    },

    async executeTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
      const entry = toolRegistry.get(name);
      if (!entry) {
        return {
          ok: false,
          output: `MCP tool not found or server disconnected: "${name}"`
        };
      }

      try {
        const result = await entry.server.client.callTool(
          {
            name: entry.realName,
            arguments: args
          },
          signal ? { signal } : undefined
        );

        return formatMcpToolResult(result);
      } catch (err) {
        return {
          ok: false,
          output: `MCP tool execution failed: ${err instanceof Error ? err.message : String(err)}`
        };
      }
    },

    async close(): Promise<void> {
      for (const server of connectedServers) {
        try {
          await server.client.close();
        } catch {
          // ignore
        }
      }
      connectedServers.length = 0;
      toolDefinitions.length = 0;
      toolRegistry.clear();
    }
  };
}
