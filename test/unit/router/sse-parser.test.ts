import { describe, expect, it } from 'vitest';
import { parseSseChunk } from '../../../src/router/sse-parser';

describe('parseSseChunk', () => {
  it('extracts text deltas from OpenAI-style data lines', () => {
    const events = parseSseChunk('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');

    expect(events).toEqual([{ type: 'text-delta', text: 'Hel' }]);
  });

  it('marks the stream complete when the router sends [DONE]', () => {
    const events = parseSseChunk('data: [DONE]\n\n');

    expect(events).toEqual([{ type: 'response-complete' }]);
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
});
