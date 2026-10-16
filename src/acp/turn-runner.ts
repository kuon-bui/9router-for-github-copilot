import { raceAbort } from './abort';
import { createAuthRequiredError, createInvalidParamsError } from './errors';
import { convertPromptBlocksToTextMessage } from './prompt-content';
import { buildSystemPrompt } from './system-prompt';
import { createResponseAssembler } from '@/router/response-assembler';
import type { PromptContentBlock } from './prompt-content';
import type { Session } from './session-store';
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
  notifyClient: (method: string, params: unknown) => Promise<void>;
}

export async function executePromptTurn(options: ExecutePromptTurnOptions): Promise<PromptTurnResult> {
  const { session, client, apiKey, baseUrl, timeoutMs, turnSignal, prompt, notifyClient } = options;

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

  try {
    if (session.history.length === 0) {
      session.history.push(buildSystemPrompt({ cwd: session.cwd, mode: session.mode }));
    }

    const userMessage = convertPromptBlocksToTextMessage(prompt);
    session.history.push(userMessage);

    const requestPayload: RouterResponseRequest = {
      model: session.model,
      input: [...session.history],
      stream: true,
      store: false
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
    if (finished.ok && finished.text.length > 0) {
      session.history.push({
        role: 'assistant',
        content: [{ type: 'output_text', text: finished.text }]
      });
    }

    return { stopReason: 'end_turn' };
  } catch (error) {
    if (combinedSignal.aborted) {
      return { stopReason: 'cancelled' };
    }
    throw error;
  } finally {
    session.activeTurn = null;
    cleanupAbort();
  }
}
