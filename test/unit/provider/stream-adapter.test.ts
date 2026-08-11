import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { createRouterEventEmitter } from '../../../src/provider/stream-adapter';
import { NineRouterError } from '../../../src/router/errors';

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
    emitter.emit({ type: 'response-complete' });

    expect(parts[0]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
    expect((parts[0] as vscode.LanguageModelToolCallPart).callId).toBe('call-1');
    expect((parts[0] as vscode.LanguageModelToolCallPart).name).toBe('lookupUser');
    expect((parts[0] as vscode.LanguageModelToolCallPart).input).toEqual({ id: '42' });
  });

  it('waits for response completion before parsing tool arguments', () => {
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
      delta: '{"id":"42"}'
    });

    expect(parts).toEqual([]);

    emitter.emit({ type: 'response-complete' });

    expect(parts[0]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
  });

  it('rejects non-object tool call arguments on completion', () => {
    const emitter = createRouterEventEmitter({
      report() {
        throw new Error('unexpected report');
      }
    } as vscode.Progress<vscode.LanguageModelResponsePart>);

    emitter.emit({
      type: 'tool-call-delta',
      toolCallIndex: 0,
      toolCallId: 'call-1',
      toolName: 'lookupUser',
      delta: '12'
    });

    expect(() => emitter.emit({ type: 'response-complete' })).toThrowError(NineRouterError);
  });

  it('rejects malformed tool call arguments on completion', () => {
    const emitter = createRouterEventEmitter({
      report() {
        throw new Error('unexpected report');
      }
    } as vscode.Progress<vscode.LanguageModelResponsePart>);

    emitter.emit({
      type: 'tool-call-delta',
      toolCallIndex: 0,
      toolCallId: 'call-1',
      toolName: 'lookupUser',
      delta: '{"id"'
    });

    expect(() => emitter.emit({ type: 'response-complete' })).toThrowError(NineRouterError);
  });

  it('emits OpenAI token usage through the Copilot usage data part', () => {
    const parts: unknown[] = [];
    const emitter = createRouterEventEmitter({
      report(part) {
        parts.push(part);
      }
    } as vscode.Progress<vscode.LanguageModelResponsePart>);

    emitter.emit({
      type: 'usage',
      promptTokens: 321,
      completionTokens: 17,
      totalTokens: 338
    });

    expect(parts[0]).toBeInstanceOf(vscode.LanguageModelDataPart);
    const usagePart = parts[0] as vscode.LanguageModelDataPart;
    expect(usagePart.mimeType).toBe('usage');
    expect(JSON.parse(new TextDecoder().decode(usagePart.data))).toEqual({
      prompt_tokens: 321,
      completion_tokens: 17,
      total_tokens: 338
    });
  });
});
