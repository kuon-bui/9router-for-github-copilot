import { describe, expect, it } from 'vitest';
import {
  createResponseAssembler,
  parseToolCallArguments
} from '@/router/response-assembler';

describe('parseToolCallArguments', () => {
  it('parses valid json object', () => {
    const res = parseToolCallArguments('{"path":"foo.txt","content":"hello"}');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual({ path: 'foo.txt', content: 'hello' });
    }
  });

  it('rejects invalid json', () => {
    const res = parseToolCallArguments('{not-json');
    expect(res.ok).toBe(false);
  });

  it('rejects non-object json', () => {
    const arrayRes = parseToolCallArguments('["item"]');
    expect(arrayRes.ok).toBe(false);
    const stringRes = parseToolCallArguments('"hello"');
    expect(stringRes.ok).toBe(false);
    const nullRes = parseToolCallArguments('null');
    expect(nullRes.ok).toBe(false);
  });
});

describe('createResponseAssembler', () => {
  it('assembles text deltas into completed text', () => {
    const assembler = createResponseAssembler();
    assembler.feed({ type: 'text-delta', text: 'Hello ' });
    assembler.feed({ type: 'text-delta', text: 'world!' });
    const result = assembler.finish();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Hello world!');
      expect(result.toolCalls).toHaveLength(0);
    }
  });

  it('falls back to text-done when no deltas were streamed', () => {
    const assembler = createResponseAssembler();
    assembler.feed({ type: 'text-done', text: 'Fallback completed text' });
    const result = assembler.finish();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Fallback completed text');
    }
  });

  it('assembles tool calls across deltas and parses arguments', () => {
    const assembler = createResponseAssembler();
    assembler.feed({
      type: 'tool-call-delta',
      toolCallIndex: 0,
      toolCallId: 'call_1',
      toolName: 'read_file',
      delta: '{"path":'
    });
    assembler.feed({
      type: 'tool-call-delta',
      toolCallIndex: 0,
      delta: '"README.md"}'
    });
    const result = assembler.finish();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        id: 'call_1',
        name: 'read_file',
        argumentsText: '{"path":"README.md"}',
        arguments: { path: 'README.md' }
      });
    }
  });

  it('rejects oversized tool call arguments', () => {
    const assembler = createResponseAssembler();
    const bigString = 'x'.repeat(1024 * 1024 + 1);
    const feedResult = assembler.feed({
      type: 'tool-call-delta',
      toolCallIndex: 0,
      toolCallId: 'call_big',
      toolName: 'test',
      delta: bigString
    });
    expect(feedResult.ok).toBe(false);
  });

  it('reports error when tool call is missing id or name', () => {
    const assembler = createResponseAssembler();
    assembler.feed({
      type: 'tool-call-delta',
      toolCallIndex: 0,
      delta: '{"valid":"json"}'
    });
    const result = assembler.finish();
    expect(result.ok).toBe(false);
  });
});
