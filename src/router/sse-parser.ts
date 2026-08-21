import { NineRouterError } from './errors';
import type { RouterStreamEvent } from '@/types/router-contract';

// ponytail: 1 MiB SSE frame ceiling; raise if 9router formalizes larger tool-call delta frames.
const MAX_SSE_FRAME_BYTES = 1024 * 1024;

// ponytail: 150 ms lets a well-behaved 9router close the SSE body after completion so the HTTP
// request ends cleanly instead of being aborted; lower it if end-of-turn latency ever matters more
// than a clean connection teardown, or set it to 0 to always cancel immediately.
const STREAM_CLOSE_GRACE_MS = 150;

export interface RouterEventStreamOptions {
  closeGraceMs?: number;
}

interface RouterResponseUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
}

interface RouterResponseEnvelope {
  id?: unknown;
  error?: {
    message?: unknown;
  } | null;
  incomplete_details?: {
    reason?: unknown;
  } | null;
  usage?: RouterResponseUsage | null;
}

interface RouterResponseFunctionCallItem {
  type?: unknown;
  call_id?: unknown;
  name?: unknown;
  arguments?: unknown;
}

interface RouterResponsesSsePayload {
  type?: unknown;
  response_id?: unknown;
  output_index?: unknown;
  delta?: unknown;
  message?: unknown;
  error?: {
    message?: unknown;
  };
  response?: RouterResponseEnvelope;
  item?: RouterResponseFunctionCallItem;
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

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload) as unknown;
  } catch {
    throw new NineRouterError('MALFORMED_STREAM_ERROR', '9router returned malformed SSE JSON', {
      details: {
        frameBytes: getUtf8ByteLength(frame)
      }
    });
  }

  if (!isRecord(decoded)) {
    throw new NineRouterError('MALFORMED_STREAM_ERROR', '9router returned malformed SSE payload', {
      details: {
        frameBytes: getUtf8ByteLength(frame)
      }
    });
  }

  const parsed = decoded as RouterResponsesSsePayload;

  if (typeof parsed.type !== 'string') {
    return [];
  }

  if (parsed.type === 'response.output_text.delta' || parsed.type === 'response.refusal.delta') {
    return typeof parsed.delta === 'string' && parsed.delta.length > 0
      ? [{ type: 'text-delta', text: parsed.delta }]
      : [];
  }

  if (
    parsed.type === 'response.reasoning_summary_text.delta' ||
    parsed.type === 'response.reasoning_text.delta'
  ) {
    return typeof parsed.delta === 'string' && parsed.delta.length > 0
      ? [{ type: 'thinking-delta', text: parsed.delta }]
      : [];
  }

  if (parsed.type === 'response.output_item.added') {
    return parseFunctionCallAdded(parsed);
  }

  if (parsed.type === 'response.output_item.done') {
    return parseFunctionCallCompleted(parsed);
  }

  if (parsed.type === 'response.function_call_arguments.delta') {
    if (!isNonNegativeInteger(parsed.output_index) || typeof parsed.delta !== 'string') {
      return [];
    }

    return [
      {
        type: 'tool-call-delta',
        toolCallIndex: parsed.output_index,
        delta: parsed.delta
      }
    ];
  }

  if (parsed.type === 'response.completed') {
    return [
      ...extractUsageEvents(parsed.response?.usage),
      createResponseCompleteEvent(parsed.response)
    ];
  }

  if (parsed.type === 'response.incomplete') {
    const completion = createResponseCompleteEvent(parsed.response);
    const reason = parsed.response?.incomplete_details?.reason;
    completion.finishReason = typeof reason === 'string' && reason.length > 0 ? reason : 'incomplete';

    return [...extractUsageEvents(parsed.response?.usage), completion];
  }

  if (parsed.type === 'response.failed' || parsed.type === 'error') {
    return [createRouterErrorEvent(parsed)];
  }

  return [];
}

function parseFunctionCallAdded(parsed: RouterResponsesSsePayload): RouterStreamEvent[] {
  const item = parsed.item;
  if (item?.type !== 'function_call') {
    return [];
  }

  const callId = typeof item.call_id === 'string' ? item.call_id : undefined;
  const name = typeof item.name === 'string' ? item.name : undefined;
  if (!callId || !name) {
    return [];
  }

  const event: Extract<RouterStreamEvent, { type: 'tool-call-delta' }> = {
    type: 'tool-call-delta',
    toolCallId: callId,
    toolName: name,
    delta: typeof item.arguments === 'string' ? item.arguments : ''
  };

  if (isNonNegativeInteger(parsed.output_index)) {
    event.toolCallIndex = parsed.output_index;
  }

  return [event];
}

function parseFunctionCallCompleted(parsed: RouterResponsesSsePayload): RouterStreamEvent[] {
  const item = parsed.item;
  if (
    item?.type !== 'function_call' ||
    typeof item.call_id !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.arguments !== 'string'
  ) {
    return [];
  }

  const event: Extract<RouterStreamEvent, { type: 'tool-call-complete' }> = {
    type: 'tool-call-complete',
    toolCallId: item.call_id,
    toolName: item.name,
    arguments: item.arguments
  };

  if (isNonNegativeInteger(parsed.output_index)) {
    event.toolCallIndex = parsed.output_index;
  }

  return [event];
}

function extractUsageEvents(usage: RouterResponseUsage | null | undefined): RouterStreamEvent[] {
  if (
    !isNonNegativeInteger(usage?.input_tokens) ||
    !isNonNegativeInteger(usage.output_tokens) ||
    !isNonNegativeInteger(usage.total_tokens)
  ) {
    return [];
  }

  return [
    {
      type: 'usage',
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      totalTokens: usage.total_tokens
    }
  ];
}

function createResponseCompleteEvent(
  response: RouterResponseEnvelope | undefined
): Extract<RouterStreamEvent, { type: 'response-complete' }> {
  const event: Extract<RouterStreamEvent, { type: 'response-complete' }> = {
    type: 'response-complete'
  };
  if (typeof response?.id === 'string' && response.id.length > 0) {
    event.requestId = response.id;
  }

  return event;
}

function createRouterErrorEvent(
  payload: RouterResponsesSsePayload
): Extract<RouterStreamEvent, { type: 'router-error' }> {
  const responseMessage = payload.response?.error?.message;
  const topLevelMessage = payload.error?.message ?? payload.message;
  const event: Extract<RouterStreamEvent, { type: 'router-error' }> = {
    type: 'router-error',
    error:
      typeof responseMessage === 'string' && responseMessage.length > 0
        ? responseMessage
        : typeof topLevelMessage === 'string' && topLevelMessage.length > 0
          ? topLevelMessage
          : '9router response failed'
  };

  const requestId = payload.response?.id ?? payload.response_id;
  if (typeof requestId === 'string' && requestId.length > 0) {
    event.requestId = requestId;
  }

  return event;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  stream: ReadableStream<Uint8Array>,
  options?: RouterEventStreamOptions
): AsyncIterable<RouterStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const closeGraceMs = options?.closeGraceMs ?? STREAM_CLOSE_GRACE_MS;
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
            completed = await awaitStreamClose(reader, closeGraceMs);
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

type StreamCloseOutcome = 'closed' | 'chunk' | 'failed' | 'expired';

// Drains and discards whatever 9router still has queued after the terminal event, so the response
// body reaches its own end and the HTTP request is not aborted client-side. Routers that hold the
// SSE body open past completion hit the grace window and fall back to cancelling the reader.
async function awaitStreamClose(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  graceMs: number
): Promise<boolean> {
  if (graceMs <= 0) {
    return false;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<StreamCloseOutcome>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('expired'), graceMs);
  });

  try {
    while (true) {
      const outcome = await Promise.race([
        reader.read().then(
          (result): StreamCloseOutcome => (result.done ? 'closed' : 'chunk'),
          (): StreamCloseOutcome => 'failed'
        ),
        expired
      ]);

      if (outcome === 'chunk') {
        continue;
      }

      return outcome === 'closed';
    }
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
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
