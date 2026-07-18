import { describe, expect, it } from 'vitest';
import { parseRouterEventStream, parseSseChunk } from '../../../src/router/sse-parser';

describe('parseSseChunk', () => {
  it('extracts text deltas from OpenAI-style data lines', () => {
    const events = parseSseChunk('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');

    expect(events).toEqual([{ type: 'text-delta', text: 'Hel' }]);
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

  it('extracts reasoning deltas from OpenAI-style reasoning content', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\n'
    );

    expect(events).toEqual([{ type: 'reasoning-delta', text: 'private reasoning' }]);
  });

  it.each(['cot_summary', 'reasoning_text', 'reasoning_content', 'reasoning', 'thinking'])(
    'normalizes the %s reasoning string alias',
    (field) => {
      const events = parseSseChunk(
        `data: {"choices":[{"delta":{"${field}":"private reasoning"}}]}\n\n`
      );

      expect(events).toEqual([{ type: 'reasoning-delta', text: 'private reasoning' }]);
    }
  );

  it('emits only the highest-precedence reasoning value when aliases coexist', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"cot_summary":"summary","reasoning_content":"detail"}}]}\n\n'
    );

    expect(events).toEqual([{ type: 'reasoning-delta', text: 'summary' }]);
  });

  it('emits reasoning before visible content from the same frame', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"content":"Visible","reasoning_content":"private reasoning"}}]}\n\n'
    );

    expect(events).toEqual([
      { type: 'reasoning-delta', text: 'private reasoning' },
      { type: 'text-delta', text: 'Visible' }
    ]);
  });

  it('ignores empty and non-string reasoning values from the router boundary', () => {
    expect(
      parseSseChunk('data: {"choices":[{"delta":{"reasoning_content":""}}]}\n\n')
    ).toEqual([]);
    expect(
      parseSseChunk('data: {"choices":[{"delta":{"reasoning_content":{"text":"bad"}}}]}\n\n')
    ).toEqual([]);
  });

  it('parses CRLF-delimited SSE frames', () => {
    const events = parseSseChunk(
      'data: {"choices":[{"delta":{"reasoning_content":"detail"}}]}\r\n\r\n' +
        'data: {"choices":[{"delta":{"content":"Visible"}}]}\r\n\r\n'
    );

    expect(events).toEqual([
      { type: 'reasoning-delta', text: 'detail' },
      { type: 'text-delta', text: 'Visible' }
    ]);
  });

  it('recognizes a CRLF frame boundary split across transport chunks', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"reasoning":"detail"}}]}\r')
        );
        controller.enqueue(encoder.encode('\n\r'));
        controller.enqueue(
          encoder.encode('\ndata: {"choices":[{"delta":{"content":"Visible"}}]}\r\n\r\n')
        );
        controller.close();
      }
    });
    const events = [];

    for await (const event of parseRouterEventStream(stream)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'reasoning-delta', text: 'detail' },
      { type: 'text-delta', text: 'Visible' }
    ]);
  });
});
