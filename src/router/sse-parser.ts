import { NineRouterError } from './errors';
import type { RouterStreamEvent } from '../types/router-contract';

interface RouterSsePayload {
  id?: string;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  error?: {
    message?: string;
  };
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
}

export function parseSseChunk(chunk: string): RouterStreamEvent[] {
  const frames = chunk
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter((frame) => frame.length > 0);

  return frames.flatMap((frame) => parseSseFrame(frame));
}

function parseSseFrame(frame: string): RouterStreamEvent[] {
  const lines = frame
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'));

  if (lines.length === 0) {
    return [];
  }

  const payload = lines.map((line) => line.slice('data:'.length).trim()).join('\n');

  if (payload === '[DONE]') {
    return [{ type: 'response-complete' }];
  }

  let parsed: RouterSsePayload;
  try {
    parsed = JSON.parse(payload) as RouterSsePayload;
  } catch (error) {
    throw new NineRouterError('MALFORMED_STREAM_ERROR', '9router returned malformed SSE JSON', {
      details: {
        frame,
        cause: error instanceof Error ? error.message : 'Unknown parse error'
      }
    });
  }

  if (parsed.error?.message) {
    const event: RouterStreamEvent = {
      type: 'router-error',
      error: parsed.error.message
    };

    if (parsed.id) {
      event.requestId = parsed.id;
    }

    return [event];
  }

  const events: RouterStreamEvent[] = [];
  if (
    isNonNegativeInteger(parsed.usage?.prompt_tokens) &&
    isNonNegativeInteger(parsed.usage.completion_tokens) &&
    isNonNegativeInteger(parsed.usage.total_tokens)
  ) {
    events.push({
      type: 'usage',
      promptTokens: parsed.usage.prompt_tokens,
      completionTokens: parsed.usage.completion_tokens,
      totalTokens: parsed.usage.total_tokens
    });
  }

  const choice = parsed.choices?.[0];
  if (!choice) {
    return events;
  }

  const text = choice.delta?.content;
  if (typeof text === 'string' && text.length > 0) {
    events.push({ type: 'text-delta', text });
  }

  const toolCalls = choice.delta?.tool_calls ?? [];
  for (const toolCall of toolCalls) {
    const toolCallIndex = toolCall.index;
    const toolCallId = toolCall.id;
    const toolName = toolCall.function?.name;
    const delta = toolCall.function?.arguments;
    if ((toolCallId || typeof toolCallIndex === 'number') && typeof delta === 'string') {
      const event: RouterStreamEvent = {
        type: 'tool-call-delta',
        delta
      };

      if (typeof toolCallIndex === 'number') {
        event.toolCallIndex = toolCallIndex;
      }

      if (toolCallId) {
        event.toolCallId = toolCallId;
      }

      if (toolName) {
        event.toolName = toolName;
      }

      events.push(event);
    }
  }

  if (choice.finish_reason) {
    const event: RouterStreamEvent = {
      type: 'response-complete',
      finishReason: choice.finish_reason
    };

    if (parsed.id) {
      event.requestId = parsed.id;
    }

    events.push(event);
  }

  return events;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export async function* parseRouterEventStream(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<RouterStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = buffer.indexOf('\n\n');
    while (boundaryIndex >= 0) {
      const frame = buffer.slice(0, boundaryIndex + 2);
      buffer = buffer.slice(boundaryIndex + 2);
      for (const event of parseSseChunk(frame)) {
        yield event;
      }
      boundaryIndex = buffer.indexOf('\n\n');
    }
  }

  const trailing = decoder.decode();
  if (trailing) {
    buffer += trailing;
  }

  if (buffer.trim().length > 0) {
    for (const event of parseSseChunk(buffer)) {
      yield event;
    }
  }
}
