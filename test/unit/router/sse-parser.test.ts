import { describe, expect, it } from 'vitest';
import { parseRouterEventStream, parseSseChunk } from '../../../src/router/sse-parser';

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

  it('does not expose reasoning-only deltas as response events', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\n'
    );

    expect(events).toEqual([]);
  });

  it('emits visible content without exposing a sibling reasoning delta', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"content":"Visible","reasoning_content":"private reasoning"}}]}\n\n'
    );

    expect(events).toEqual([{ type: 'text-delta', text: 'Visible' }]);
  });

  it('does not include raw malformed frame content in parser errors', () => {
    const secret = 'prompt-secret';

    expect(() => parseSseChunk(`data: {"secret":"${secret}"\n\n`)).toThrow(
      expect.objectContaining({
        code: 'MALFORMED_STREAM_ERROR',
        details: expect.objectContaining({ frameLength: expect.any(Number) })
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
      details: expect.objectContaining({ maxFrameLength: 1024 * 1024 })
    });
  });
});
