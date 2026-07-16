import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { createRouterEventEmitter } from '../../../src/provider/stream-adapter';

describe('createRouterEventEmitter', () => {
  it('emits text parts for streamed text deltas', () => {
    const parts: unknown[] = [];
    const emitter = createRouterEventEmitter({
      report(part) {
        parts.push(part);
      }
    } as vscode.Progress<vscode.LanguageModelResponsePart>);

    emitter.emit({ type: 'text-delta', text: 'Hello' });

    expect(parts[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    expect((parts[0] as vscode.LanguageModelTextPart).value).toBe('Hello');
  });

  it('assembles tool call arguments across streaming chunks', () => {
    const parts: unknown[] = [];
    const emitter = createRouterEventEmitter({
      report(part) {
        parts.push(part);
      }
    } as vscode.Progress<vscode.LanguageModelResponsePart>);

    emitter.emit({
      type: 'tool-call-delta',
      toolCallIndex: 0,
      toolCallId: 'call-1',
      toolName: 'lookupUser',
      delta: '{"id"'
    });
    emitter.emit({
      type: 'tool-call-delta',
      toolCallIndex: 0,
      delta: ':"42"}'
    });

    expect(parts[0]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
    expect((parts[0] as vscode.LanguageModelToolCallPart).callId).toBe('call-1');
    expect((parts[0] as vscode.LanguageModelToolCallPart).name).toBe('lookupUser');
    expect((parts[0] as vscode.LanguageModelToolCallPart).input).toEqual({ id: '42' });
  });
});
