import { raceAbort } from './abort';
import { createAuthRequiredError, createInvalidParamsError } from './errors';
import { checkToolPermission } from './permissions';
import { convertPromptBlocksToTextMessage } from './prompt-content';
import { buildSystemPrompt } from './system-prompt';
import { MAX_MODEL_OUTPUT_BYTES, truncateOutput } from './tools/output-limits';
import { getAvailableTools } from './tools/registry';
import { executeBuiltinTool } from './tools/tool-executor';
import { createWorkspaceFs } from './tools/workspace-fs';
import { createResponseAssembler } from '@/router/response-assembler';
import type { CheckPermissionInput } from './permissions';
import type { PromptContentBlock } from './prompt-content';
import type { Session } from './session-store';
import type { WorkspaceFs } from './tools/workspace-fs';
import type { ClientTerminalDelegate } from './tools/client-terminal-runner';
import type { RouterClient } from '@/router/client';
import type { RouterResponseRequest } from '@/types/router-contract';

export interface PromptTurnResult {
  stopReason: 'end_turn' | 'max_tokens' | 'refusal' | 'max_turn_requests' | 'cancelled';
}

export interface ExecutePromptTurnOptions {
  session: Session;
  client: RouterClient;
  apiKey?: string | undefined;
  baseUrl: string;
  timeoutMs: number;
  turnSignal?: AbortSignal | undefined;
  prompt: PromptContentBlock[];
  workspaceFs?: WorkspaceFs | undefined;
  requestPermission?: CheckPermissionInput['requestPermission'] | undefined;
  clientTerminal?: ClientTerminalDelegate | undefined;
  maxTurnRequests?: number | undefined;
  notifyClient: (method: string, params: unknown) => Promise<void>;
}

function finalizeDanglingFunctionCalls(session: Session): void {
  const pendingCallIds = new Set<string>();

  for (const item of session.history) {
    if ('type' in item && item.type === 'function_call') {
      pendingCallIds.add(item.call_id);
    } else if ('type' in item && item.type === 'function_call_output') {
      pendingCallIds.delete(item.call_id);
    }
  }

  for (const callId of pendingCallIds) {
    session.history.push({
      type: 'function_call_output',
      call_id: callId,
      output: 'Cancelled by user'
    });
  }
}

export async function executePromptTurn(options: ExecutePromptTurnOptions): Promise<PromptTurnResult> {
  const {
    session,
    client,
    apiKey,
    baseUrl,
    timeoutMs,
    turnSignal,
    prompt,
    workspaceFs = createWorkspaceFs({ cwd: session.cwd }),
    requestPermission,
    clientTerminal,
    maxTurnRequests = 50,
    notifyClient
  } = options;

  if (session.activeTurn !== null) {
    throw createInvalidParamsError('Turn already in progress for this session');
  }

  if (!apiKey) {
    throw createAuthRequiredError();
  }

  const turnController = new AbortController();
  const { signal: combinedSignal, cleanup: cleanupAbort } = raceAbort([
    turnController.signal,
    turnSignal
  ]);

  session.activeTurn = { abortController: turnController };

  const permissionRequester: CheckPermissionInput['requestPermission'] = requestPermission ?? (async () => ({
    outcome: { outcome: 'selected' as const, optionId: 'allow' }
  }));

  try {
    if (session.history.length === 0) {
      session.history.push(buildSystemPrompt({ cwd: session.cwd, mode: session.mode }));
    }

    const userMessage = convertPromptBlocksToTextMessage(prompt);
    session.history.push(userMessage);

    for (let iteration = 0; iteration < maxTurnRequests; iteration++) {
      if (combinedSignal.aborted) {
        finalizeDanglingFunctionCalls(session);
        return { stopReason: 'cancelled' };
      }

      const builtinTools = getAvailableTools(session.mode);
      const mcpTools = session.mode !== 'read-only' ? session.mcpHub.getTools() : [];
      const tools = [...builtinTools, ...mcpTools];
      const requestPayload: RouterResponseRequest = {
        model: session.model,
        input: [...session.history],
        stream: true,
        store: false,
        ...(tools.length > 0 ? { tools } : {})
      };

      if (session.reasoningEffort !== 'off') {
        requestPayload.reasoning = {
          effort: session.reasoningEffort,
          summary: 'auto'
        };
      }

      const assembler = createResponseAssembler();
      const eventStream = client.streamResponse({
        baseUrl,
        apiKey,
        request: requestPayload,
        timeoutMs,
        signal: combinedSignal
      });

      for await (const event of eventStream) {
        if (combinedSignal.aborted) {
          finalizeDanglingFunctionCalls(session);
          return { stopReason: 'cancelled' };
        }

        assembler.feed(event);

        if (event.type === 'text-delta') {
          await notifyClient('session/update', {
            sessionId: session.sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: {
                type: 'text',
                text: event.text
              }
            }
          });
        }
      }

      const finished = assembler.finish();
      if (!finished.ok) {
        throw new Error(finished.reason);
      }

      const toolCalls = finished.toolCalls;

      // If the model produced output text, record it
      if (finished.text.length > 0) {
        session.history.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: finished.text }]
        });
      }

      // If no tool calls were made, the turn is finished
      if (toolCalls.length === 0) {
        return { stopReason: 'end_turn' };
      }

      // Process tool calls sequentially
      for (const call of toolCalls) {
        if (combinedSignal.aborted) {
          finalizeDanglingFunctionCalls(session);
          return { stopReason: 'cancelled' };
        }

        // Record function call in history
        session.history.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.argumentsText
        });

        // Notify client of pending tool call
        await notifyClient('session/update', {
          sessionId: session.sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: call.id,
            title: `Running ${call.name}`,
            status: 'pending',
            rawInput: call.arguments
          }
        });

        // Check permission
        const permission = await checkToolPermission({
          session,
          toolName: call.name,
          args: call.arguments,
          requestPermission: permissionRequester
        });

        if (!permission.allowed) {
          const reason = permission.reason ?? 'User rejected this action';
          await notifyClient('session/update', {
            sessionId: session.sessionId,
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: call.id,
              status: 'failed',
              rawOutput: { error: reason }
            }
          });

          session.history.push({
            type: 'function_call_output',
            call_id: call.id,
            output: reason
          });
          continue;
        }

        // Handle update_plan client notification
        if (call.name === 'update_plan' && Array.isArray((call.arguments as Record<string, unknown>)['entries'])) {
          await notifyClient('session/update', {
            sessionId: session.sessionId,
            update: {
              sessionUpdate: 'plan',
              entries: (call.arguments as Record<string, unknown>)['entries']
            }
          });
        }

        // Execute tool
        const toolResult = session.mcpHub.hasTool(call.name)
          ? await session.mcpHub.executeTool(call.name, call.arguments, combinedSignal)
          : await executeBuiltinTool(call.name, call.arguments, {
              cwd: session.cwd,
              fs: workspaceFs,
              signal: combinedSignal,
              ...(clientTerminal ? { clientTerminal } : {})
            });

        const outputForModel = truncateOutput(toolResult.output, MAX_MODEL_OUTPUT_BYTES);

        // Notify client of tool call completion
        await notifyClient('session/update', {
          sessionId: session.sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: call.id,
            status: toolResult.ok ? 'completed' : 'failed',
            rawOutput: { result: toolResult.output }
          }
        });

        session.history.push({
          type: 'function_call_output',
          call_id: call.id,
          output: outputForModel
        });
      }
    }

    return { stopReason: 'max_turn_requests' };
  } catch (error) {
    if (combinedSignal.aborted) {
      finalizeDanglingFunctionCalls(session);
      return { stopReason: 'cancelled' };
    }
    throw error;
  } finally {
    session.activeTurn = null;
    cleanupAbort();
  }
}
