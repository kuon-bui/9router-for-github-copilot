import { describe, expect, it } from 'vitest';
import { parseRouterEventStream, parseSseChunk } from '@/router/sse-parser';

async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of parseRouterEventStream(stream)) {
    events.push(event);
  }
  return events;
}

describe('parseSseChunk', () => {
  it('extracts text deltas from OpenAI-style data lines', () => {
    const events = parseSseChunk('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');

    expect(events).toEqual([{ type: 'text-delta', text: 'Hel' }]);
  });

  it('extracts events from CRLF-delimited frames', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
    );

    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'response-complete' }
    ]);
  });

  it('marks the stream complete when the router sends [DONE]', () => {
    const events = parseSseChunk('data: [DONE]\n\n');

    expect(events).toEqual([{ type: 'response-complete' }]);
  });

  it('extracts normalized token usage from the final usage chunk', () => {
    const events = parseSseChunk(
      'data: {"choices":[],"usage":{"prompt_tokens":321,"completion_tokens":17,"total_tokens":338}}\n\n'
    );

    expect(events).toEqual([
      {
        type: 'usage',
        promptTokens: 321,
        completionTokens: 17,
        totalTokens: 338
      }
    ]);
  });

  it('ignores malformed token usage instead of exposing untrusted values', () => {
    const events = parseSseChunk(
      'data: {"choices":[],"usage":{"prompt_tokens":321,"completion_tokens":-1,"total_tokens":320}}\n\n'
    );

    expect(events).toEqual([]);
  });

  it('extracts tool-call deltas with stable index information', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"lookupUser","arguments":"{\\"id\\""}}]}}]}\n\n'
    );

    expect(events).toEqual([
      {
        type: 'tool-call-delta',
        toolCallIndex: 0,
        toolCallId: 'call-1',
        toolName: 'lookupUser',
        delta: '{"id"'
      }
    ]);
  });

  it('extracts thinking deltas from reasoning-only frames', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"reasoning_content":"step one"}}]}\n\n'
    );

    expect(events).toEqual([{ type: 'thinking-delta', text: 'step one' }]);
  });

  it('emits the thinking delta before a sibling text delta', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"content":"Visible","reasoning_content":"step one"}}]}\n\n'
    );

    expect(events).toEqual([
      { type: 'thinking-delta', text: 'step one' },
      { type: 'text-delta', text: 'Visible' }
    ]);
  });

  it('accepts reasoning as an alias for reasoning_content', () => {
    const events = parseSseChunk('data: {"choices":[{"delta":{"reasoning":"step one"}}]}\n\n');

    expect(events).toEqual([{ type: 'thinking-delta', text: 'step one' }]);
  });

  it('emits a single thinking delta when both reasoning fields carry the same text', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"reasoning_content":"step one","reasoning":"step one"}}]}\n\n'
    );

    expect(events).toEqual([{ type: 'thinking-delta', text: 'step one' }]);
  });

  it('ignores reasoning fields that are empty or not strings', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"reasoning_content":"","reasoning":42,"content":"Visible"}}]}\n\n'
    );

    expect(events).toEqual([{ type: 'text-delta', text: 'Visible' }]);
  });

  it('does not include raw malformed frame content in parser errors', () => {
    const secret = 'prompt-secret';

    expect(() => parseSseChunk(`data: {"secret":"${secret}"\n\n`)).toThrow(
      expect.objectContaining({
        code: 'MALFORMED_STREAM_ERROR',
        details: expect.objectContaining({ frameBytes: expect.any(Number) })
      })
    );

    try {
      parseSseChunk(`data: {"secret":"${secret}"\n\n`);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it('extracts CRLF events split across network chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"A"}}]}\r'));
        controller.enqueue(new TextEncoder().encode('\n\r'));
        controller.enqueue(new TextEncoder().encode('\ndata: [DONE]\r\n\r\n'));
        controller.close();
      }
    });

    await expect(collectEvents(stream)).resolves.toEqual([
      { type: 'text-delta', text: 'A' },
      { type: 'response-complete' }
    ]);
  });

  it('rejects oversized SSE frames', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${'x'.repeat(1024 * 1024 + 1)}\n\n`));
        controller.close();
      }
    });

    await expect(collectEvents(stream)).rejects.toMatchObject({
      code: 'MALFORMED_STREAM_ERROR',
      details: expect.objectContaining({ maxFrameBytes: 1024 * 1024 })
    });
  });

  it('measures SSE limits in UTF-8 bytes', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${'€'.repeat(400_000)}\n\n`));
        controller.close();
      }
    });

    await expect(collectEvents(stream)).rejects.toMatchObject({
      code: 'MALFORMED_STREAM_ERROR',
      details: expect.objectContaining({
        frameBytes: expect.any(Number),
        maxFrameBytes: 1024 * 1024
      })
    });
  });

  it('cancels the reader when stream consumption exits early', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      },
      cancel() {
        cancelled = true;
      }
    });

    for await (const event of parseRouterEventStream(stream)) {
      void event;
      break;
    }

    expect(cancelled).toBe(true);
  });
});

describe('parseRouterEventStream incremental delivery', () => {
  it('yields each frame before the next one is enqueued', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n'
    ];
    const trace: string[] = [];
    let next = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const frame = frames[next];
        if (frame === undefined) {
          controller.close();
          return;
        }

        next += 1;
        trace.push(`sent#${next}`);
        controller.enqueue(new TextEncoder().encode(frame));
      }
    });

    for await (const event of parseRouterEventStream(stream)) {
      trace.push(`got:${event.type}`);
    }

    expect(trace).toEqual([
      'sent#1',
      'sent#2',
      'got:thinking-delta',
      'sent#3',
      'got:text-delta',
      'got:text-delta'
    ]);
  });
});
