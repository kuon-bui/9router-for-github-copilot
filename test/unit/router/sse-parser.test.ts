import { describe, expect, it } from 'vitest';
import { parseRouterEventStream, parseSseChunk } from '@/router/sse-parser';

async function collectEvents(
  stream: ReadableStream<Uint8Array>,
  options?: { closeGraceMs?: number }
): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of parseRouterEventStream(stream, options)) {
    events.push(event);
  }
  return events;
}

describe('parseSseChunk', () => {
  it('extracts text deltas from Responses API events', () => {
    const events = parseSseChunk(
      'event: response.output_text.delta\n' +
        'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n'
    );

    expect(events).toEqual([{ type: 'text-delta', text: 'Hel' }]);
  });

  it('extracts events from CRLF-delimited frames', () => {
    const events = parseSseChunk(
      'event: response.output_text.delta\r\n' +
        'data: {"type":"response.output_text.delta","delta":"Hel"}\r\n\r\n' +
        'event: response.completed\r\n' +
        'data: {"type":"response.completed","response":{"id":"resp-1"}}\r\n\r\n'
    );

    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'response-complete', requestId: 'resp-1' }
    ]);
  });

  it('accepts a trailing done sentinel for router compatibility', () => {
    expect(parseSseChunk('data: [DONE]\n\n')).toEqual([{ type: 'response-complete' }]);
  });

  it('extracts usage from the completed response', () => {
    const events = parseSseChunk(
      'data: {"type":"response.completed","response":{"id":"resp-usage","usage":{"input_tokens":321,"output_tokens":17,"total_tokens":338}}}\n\n'
    );

    expect(events).toEqual([
      {
        type: 'usage',
        promptTokens: 321,
        completionTokens: 17,
        totalTokens: 338
      },
      { type: 'response-complete', requestId: 'resp-usage' }
    ]);
  });

  it('ignores malformed token usage without failing completion', () => {
    const events = parseSseChunk(
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":321,"output_tokens":-1,"total_tokens":320}}}\n\n'
    );

    expect(events).toEqual([{ type: 'response-complete' }]);
  });

  it('extracts function call metadata and argument deltas by output index', () => {
    const events = parseSseChunk(
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call-1","name":"lookupUser","arguments":""}}\n\n' +
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"id\\""}\n\n'
    );

    expect(events).toEqual([
      {
        type: 'tool-call-delta',
        toolCallIndex: 0,
        toolCallId: 'call-1',
        toolName: 'lookupUser',
        delta: ''
      },
      {
        type: 'tool-call-delta',
        toolCallIndex: 0,
        delta: '{"id"'
      }
    ]);
  });

  it('extracts the completed function call as the authoritative argument payload', () => {
    const events = parseSseChunk(
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"call-1","name":"lookupUser","arguments":"{\\"id\\":\\"42\\"}"}}\n\n'
    );

    expect(events).toEqual([
      {
        type: 'tool-call-complete',
        toolCallIndex: 0,
        toolCallId: 'call-1',
        toolName: 'lookupUser',
        arguments: '{"id":"42"}'
      }
    ]);
  });

  it('extracts thinking deltas from reasoning summary events', () => {
    const events = parseSseChunk(
      'data: {"type":"response.reasoning_summary_text.delta","delta":"step one"}\n\n'
    );

    expect(events).toEqual([{ type: 'thinking-delta', text: 'step one' }]);
  });

  it('accepts reasoning text deltas as a router-compatible alias', () => {
    const events = parseSseChunk(
      'data: {"type":"response.reasoning_text.delta","delta":"step one"}\n\n'
    );

    expect(events).toEqual([{ type: 'thinking-delta', text: 'step one' }]);
  });

  it('forwards refusal deltas as visible text', () => {
    const events = parseSseChunk(
      'data: {"type":"response.refusal.delta","delta":"I cannot help with that."}\n\n'
    );

    expect(events).toEqual([{ type: 'text-delta', text: 'I cannot help with that.' }]);
  });

  it('treats incomplete responses as terminal and preserves the reason', () => {
    const events = parseSseChunk(
      'data: {"type":"response.incomplete","response":{"id":"resp-limited","incomplete_details":{"reason":"max_output_tokens"},"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n'
    );

    expect(events).toEqual([
      {
        type: 'usage',
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15
      },
      {
        type: 'response-complete',
        requestId: 'resp-limited',
        finishReason: 'max_output_tokens'
      }
    ]);
  });

  it('extracts safe router errors from failed response events', () => {
    const events = parseSseChunk(
      'data: {"type":"response.failed","response":{"id":"resp-failed","error":{"message":"upstream unavailable"}}}\n\n'
    );

    expect(events).toEqual([
      {
        type: 'router-error',
        error: 'upstream unavailable',
        requestId: 'resp-failed'
      }
    ]);
  });

  it('extracts top-level Responses API error events', () => {
    const events = parseSseChunk(
      'data: {"type":"error","response_id":"resp-error","message":"bad request"}\n\n'
    );

    expect(events).toEqual([
      {
        type: 'router-error',
        error: 'bad request',
        requestId: 'resp-error'
      }
    ]);
  });

  it('ignores unknown or malformed event shapes', () => {
    expect(parseSseChunk('data: {"type":"response.output_text.delta","delta":42}\n\n')).toEqual([]);
    expect(parseSseChunk('data: {"type":"response.created","response":{}}\n\n')).toEqual([]);
    expect(parseSseChunk('data: {"choices":[{"delta":{"content":"legacy"}}]}\n\n')).toEqual([]);
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

  it('classifies valid JSON primitives as malformed stream payloads', () => {
    expect(() => parseSseChunk('data: null\n\n')).toThrow(
      expect.objectContaining({
        code: 'MALFORMED_STREAM_ERROR',
        details: expect.objectContaining({ frameBytes: expect.any(Number) })
      })
    );
  });

  it('extracts CRLF events split across network chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"A"}\r'
          )
        );
        controller.enqueue(new TextEncoder().encode('\n\r'));
        controller.enqueue(
          new TextEncoder().encode(
            '\nevent: response.completed\r\ndata: {"type":"response.completed","response":{}}\r\n\r\n'
          )
        );
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
        controller.enqueue(
          new TextEncoder().encode(`data: ${'\u20ac'.repeat(400_000)}\n\n`)
        );
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
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"response.output_text.delta","delta":"A"}\n\n'
          )
        );
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

  it('stops reading when response.completed arrives before the server closes', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"response.completed","response":{}}\n\n'
          )
        );
      },
      cancel() {
        cancelled = true;
      }
    });

    await expect(collectEvents(stream, { closeGraceMs: 5 })).resolves.toEqual([
      { type: 'response-complete' }
    ]);
    expect(cancelled).toBe(true);
  });

  it('lets the server close the stream after completion instead of aborting it', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"response.completed","response":{}}\n\n')
        );
        setTimeout(() => {
          try {
            controller.close();
          } catch {
            // stream was already cancelled by the parser
          }
        }, 5);
      },
      cancel() {
        cancelled = true;
      }
    });

    await expect(collectEvents(stream, { closeGraceMs: 500 })).resolves.toEqual([
      { type: 'response-complete' }
    ]);
    expect(cancelled).toBe(false);
  });

  it('discards trailing frames sent between completion and stream close', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"response.completed","response":{}}\n\n')
        );
        setTimeout(() => {
          try {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          } catch {
            // stream was already cancelled by the parser
          }
        }, 5);
      }
    });

    await expect(collectEvents(stream, { closeGraceMs: 500 })).resolves.toEqual([
      { type: 'response-complete' }
    ]);
  });

  it('does not wait for a close when the grace window is disabled', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"type":"response.completed","response":{}}\n\n')
        );
      },
      cancel() {
        cancelled = true;
      }
    });

    await expect(collectEvents(stream, { closeGraceMs: 0 })).resolves.toEqual([
      { type: 'response-complete' }
    ]);
    expect(cancelled).toBe(true);
  });
});

describe('parseRouterEventStream incremental delivery', () => {
  it('yields each response delta without buffering the full stream', async () => {
    const frames = [
      'data: {"type":"response.reasoning_summary_text.delta","delta":"think"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"He"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"llo"}\n\n',
      'data: {"type":"response.completed","response":{}}\n\n'
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

    expect(trace.filter((entry) => entry.startsWith('got:'))).toEqual([
      'got:thinking-delta',
      'got:text-delta',
      'got:text-delta',
      'got:response-complete'
    ]);

    // Delivery must be incremental: at least one frame is still unsent when the first event is
    // yielded, so a parser that drains the whole body before yielding fails here.
    const firstDelivery = trace.findIndex((entry) => entry.startsWith('got:'));
    const lastEnqueue = trace.lastIndexOf(`sent#${frames.length}`);
    expect(firstDelivery).toBeGreaterThanOrEqual(0);
    expect(lastEnqueue).toBeGreaterThan(firstDelivery);
  });
});
