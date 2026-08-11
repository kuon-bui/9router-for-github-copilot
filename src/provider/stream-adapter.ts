import * as vscode from 'vscode';
import { NineRouterError } from '../router/errors';
import type { RouterStreamEvent } from '../types/router-contract';

interface ToolAccumulator {
  id?: string;
  name?: string;
  buffer: string;
}

export interface RouterEventEmitter {
  emit(event: RouterStreamEvent): void;
}

export function createRouterEventEmitter(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>
): RouterEventEmitter {
  const toolCalls = new Map<string, ToolAccumulator>();

  return {
    emit(event) {
      if (event.type === 'text-delta') {
        progress.report(new vscode.LanguageModelTextPart(event.text));
        return;
      }

      if (event.type === 'usage') {
        const usage = {
          prompt_tokens: event.promptTokens,
          completion_tokens: event.completionTokens,
          total_tokens: event.totalTokens
        };
        progress.report(
          new vscode.LanguageModelDataPart(
            new TextEncoder().encode(JSON.stringify(usage)),
            'usage'
          )
        );
        return;
      }

      if (event.type === 'tool-call-delta') {
        const key = getToolAccumulatorKey(event);
        const previous = toolCalls.get(key) ?? {
          buffer: ''
        };

        if (event.toolCallId) {
          previous.id = event.toolCallId;
        }

        if (event.toolName) {
          previous.name = event.toolName;
        }
        previous.buffer += event.delta;
        toolCalls.set(key, previous);
        return;
      }

      if (event.type === 'response-complete') {
        for (const toolCall of toolCalls.values()) {
          emitToolCall(progress, toolCall);
        }

        toolCalls.clear();
      }
    }
  };
}

function emitToolCall(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  toolCall: ToolAccumulator
): void {
  if (!toolCall.id || !toolCall.name) {
    throw createMalformedToolCallError('9router streamed a tool call without id or name');
  }

  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(toolCall.buffer);
  } catch {
    throw createMalformedToolCallError('9router streamed malformed tool call arguments');
  }

  if (!isPlainObject(parsedInput)) {
    throw createMalformedToolCallError('9router streamed non-object tool call arguments');
  }

  progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, parsedInput));
}

function createMalformedToolCallError(message: string): NineRouterError {
  return new NineRouterError('MALFORMED_STREAM_ERROR', message, {
    details: { phase: 'tool-call-streaming' }
  });
}

function isPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getToolAccumulatorKey(event: Extract<RouterStreamEvent, { type: 'tool-call-delta' }>): string {
  if (typeof event.toolCallIndex === 'number') {
    return `index:${event.toolCallIndex}`;
  }

  return `id:${event.toolCallId ?? 'unknown'}`;
}
