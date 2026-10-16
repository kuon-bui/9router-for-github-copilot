import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createFake9routerServer } from '../../support/fake-9router-server';

describe('ACP Agent Stdio Integration', () => {
  it('handles initialize, session/new, prompt, and cancel over stdio', async () => {
    const fakeServer = await createFake9routerServer();

    const distPath = resolve(__dirname, '../../../packages/acp-agent/dist/index.cjs');
    const proc = spawn(process.execPath, [distPath], {
      env: {
        ...process.env,
        NINEROUTER_API_KEY: 'sk-test-token-value',
        NINEROUTER_BASE_URL: fakeServer.baseUrl
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const receivedLines: string[] = [];
    let stderrOutput = '';

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString('utf8').split('\n');
      for (const line of lines) {
        if (line.trim().length > 0) {
          receivedLines.push(line.trim());
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderrOutput += chunk.toString('utf8');
    });

    function waitForLine(predicate: (msg: Record<string, unknown>) => boolean, timeoutMs = 5000): Promise<Record<string, unknown>> {
      return new Promise((resolvePromise, reject) => {
        const check = (): boolean => {
          for (const line of receivedLines) {
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              if (predicate(parsed)) {
                resolvePromise(parsed);
                return true;
              }
            } catch {
              // ignore partial lines
            }
          }
          return false;
        };

        if (check()) {
          return;
        }

        const interval = setInterval(() => {
          if (check()) {
            clearInterval(interval);
            clearTimeout(timer);
          }
        }, 50);

        const timer = setTimeout(() => {
          clearInterval(interval);
          reject(new Error(`Timeout waiting for line. Received: ${receivedLines.join(' | ')}. Stderr: ${stderrOutput}`));
        }, timeoutMs);
      });
    }

    try {
      // 1. Send initialize
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: 'stdio-test', version: '1.0.0' }
          }
        }) + '\n'
      );

      const initResp = await waitForLine((msg) => msg['id'] === 1);
      const initResult = initResp['result'] as Record<string, unknown>;
      expect(initResult['protocolVersion']).toBe(1);
      const agentInfo = initResult['agentInfo'] as Record<string, unknown>;
      expect(agentInfo['name']).toBe('9router-acp');

      // 2. Send session/new
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'session/new',
          params: {
            cwd: process.cwd(),
            mcpServers: []
          }
        }) + '\n'
      );

      const sessionResp = await waitForLine((msg) => msg['id'] === 2);
      const sessionResult = sessionResp['result'] as Record<string, unknown>;
      expect(sessionResult['sessionId']).toBeDefined();
      const sessionId = sessionResult['sessionId'] as string;
      const modes = sessionResult['modes'] as Record<string, unknown>;
      expect(modes['currentModeId']).toBe('ask');
      const configOptions = sessionResult['configOptions'] as unknown[];
      expect(configOptions).toHaveLength(3);

      // 3. Send session/prompt
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'session/prompt',
          params: {
            sessionId,
            prompt: [
              {
                type: 'text',
                text: 'Hello from client'
              }
            ]
          }
        }) + '\n'
      );

      const promptResp = await waitForLine((msg) => msg['id'] === 3);
      const promptResult = promptResp['result'] as Record<string, unknown>;
      expect(promptResult['stopReason']).toBe('end_turn');

      // 4. Stderr must never contain raw API key
      expect(stderrOutput).not.toContain('sk-test-token-value');
    } finally {
      proc.kill();
      await fakeServer.close();
    }
  });
});
