import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { isLanguageModelThinkingPart } from '../../../src/provider/reasoning-part-compat';
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

  it('emits native thinking parts for streamed reasoning deltas when supported', () => {
    const parts: unknown[] = [];
    const emitter = createRouterEventEmitter({
      report(part) {
        parts.push(part);
      }
    } as vscode.Progress<vscode.LanguageModelResponsePart>);

    emitter.emit({ type: 'reasoning-delta', text: 'Inspecting the request' });

    expect(parts).toHaveLength(1);
    expect(isLanguageModelThinkingPart(parts[0])).toBe(true);
    expect(parts[0]).toMatchObject({ value: 'Inspecting the request' });
  });

  it('drops unsupported reasoning without affecting later visible text', () => {
    const parts: unknown[] = [];
    const emitter = createRouterEventEmitter(
      {
        report(part) {
          parts.push(part);
        }
      } as vscode.Progress<vscode.LanguageModelResponsePart>,
      {
        createThinkingPart: () => undefined
      }
    );

    emitter.emit({ type: 'reasoning-delta', text: 'Hidden detail' });
    emitter.emit({ type: 'text-delta', text: 'Visible answer' });

    expect(parts).toHaveLength(1);
    expect(parts[0]).toBeInstanceOf(vscode.LanguageModelTextPart);
    expect((parts[0] as vscode.LanguageModelTextPart).value).toBe('Visible answer');
    expect(emitter.getReasoningSummary()).toEqual({
      receivedDeltas: 1,
      receivedCharacters: 13,
      emittedDeltas: 0,
      droppedDeltas: 1
    });
  });

  it('continues when the host rejects a constructed thinking part', () => {
    const visibleParts: vscode.LanguageModelTextPart[] = [];
    const emitter = createRouterEventEmitter({
      report(part) {
        if (isLanguageModelThinkingPart(part)) {
          throw new Error('Unsupported response part');
        }

        if (part instanceof vscode.LanguageModelTextPart) {
          visibleParts.push(part);
        }
      }
    } as vscode.Progress<vscode.LanguageModelResponsePart>);

    emitter.emit({ type: 'reasoning-delta', text: 'Hidden detail' });
    emitter.emit({ type: 'text-delta', text: 'Visible answer' });

    expect(visibleParts.map((part) => part.value)).toEqual(['Visible answer']);
    expect(emitter.getReasoningSummary()).toMatchObject({
      emittedDeltas: 0,
      droppedDeltas: 1
    });
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
