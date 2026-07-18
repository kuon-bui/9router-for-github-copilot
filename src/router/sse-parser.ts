import { NineRouterError } from './errors';
import type { RouterStreamEvent } from '../types/router-contract';

interface RouterSseDelta {
  content?: string;
  cot_summary?: unknown;
  reasoning_text?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
  thinking?: unknown;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

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
    delta?: RouterSseDelta;
  }>;
}

export function parseSseChunk(chunk: string): RouterStreamEvent[] {
  const frames = chunk
    .split(/\r?\n\r?\n/)
    .map((frame) => frame.trim())
    .filter((frame) => frame.length > 0);

  return frames.flatMap((frame) => parseSseFrame(frame));
}

function parseSseFrame(frame: string): RouterStreamEvent[] {
  const lines = frame
    .split(/\r?\n/)
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

  const reasoning = getReasoningDelta(choice.delta);
  if (reasoning) {
    events.push({ type: 'reasoning-delta', text: reasoning });
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

function getReasoningDelta(delta: RouterSseDelta | undefined): string | undefined {
  if (!delta) {
    return undefined;
  }

  const candidates = [
    delta.cot_summary,
    delta.reasoning_text,
    delta.reasoning_content,
    delta.reasoning,
    delta.thinking
  ];
  return candidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
  );
}

function findSseFrameBoundary(buffer: string): { index: number; length: number } | undefined {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (typeof match?.index !== 'number') {
    return undefined;
  }

  return { index: match.index, length: match[0].length };
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
    let boundary = findSseFrameBoundary(buffer);
    while (boundary) {
      const frameEnd = boundary.index + boundary.length;
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd);
      for (const event of parseSseChunk(frame)) {
        yield event;
      }
      boundary = findSseFrameBoundary(buffer);
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
