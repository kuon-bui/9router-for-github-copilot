import { NineRouterError } from './errors';
import type { RouterStreamEvent } from '@/types/router-contract';

// ponytail: 1 MiB SSE frame ceiling; raise if 9router formalizes larger tool-call delta frames.
const MAX_SSE_FRAME_BYTES = 1024 * 1024;

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
      reasoning_content?: string;
      reasoning?: string;
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
  } catch {
    throw new NineRouterError('MALFORMED_STREAM_ERROR', '9router returned malformed SSE JSON', {
      details: {
        frameBytes: getUtf8ByteLength(frame)
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

  const thinking = extractThinkingText(choice.delta);
  if (thinking !== undefined) {
    events.push({ type: 'thinking-delta', text: thinking });
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

// 9router forwards reasoning under `reasoning_content`; some upstreams use `reasoning` instead.
type RouterSseDelta = NonNullable<RouterSsePayload['choices']>[number]['delta'];

function extractThinkingText(delta: RouterSseDelta): string | undefined {
  for (const candidate of [delta?.reasoning_content, delta?.reasoning]) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function findFrameBoundary(buffer: string): { index: number; length: number } | undefined {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');

  if (lf < 0 && crlf < 0) {
    return undefined;
  }

  if (lf >= 0 && (crlf < 0 || lf < crlf)) {
    return { index: lf, length: 2 };
  }

  return { index: crlf, length: 4 };
}

export async function* parseRouterEventStream(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<RouterStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let boundary = findFrameBoundary(buffer);
      while (boundary) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        assertSseFrameWithinLimit(frame);
        for (const event of parseSseChunk(frame)) {
          yield event;
          if (event.type === 'response-complete') {
            return;
          }
        }
        boundary = findFrameBoundary(buffer);
      }

      assertSseFrameWithinLimit(buffer);
    }

    const trailing = decoder.decode();
    if (trailing) {
      buffer += trailing;
    }

    if (buffer.trim().length > 0) {
      assertSseFrameWithinLimit(buffer);
      for (const event of parseSseChunk(buffer)) {
        yield event;
        if (event.type === 'response-complete') {
          return;
        }
      }
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function assertSseFrameWithinLimit(frame: string): void {
  const frameBytes = getUtf8ByteLength(frame);
  if (frameBytes <= MAX_SSE_FRAME_BYTES) {
    return;
  }

  throw new NineRouterError(
    'MALFORMED_STREAM_ERROR',
    '9router SSE frame exceeded maximum supported size',
    {
      details: {
        frameBytes,
        maxFrameBytes: MAX_SSE_FRAME_BYTES
      }
    }
  );
}

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
