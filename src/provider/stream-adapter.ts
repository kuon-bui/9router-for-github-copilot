import * as vscode from 'vscode';
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

        try {
          const parsedInput = JSON.parse(previous.buffer) as object;
          if (!previous.id || !previous.name) {
            return;
          }

          progress.report(new vscode.LanguageModelToolCallPart(previous.id, previous.name, parsedInput));
          toolCalls.delete(key);
        } catch {
          return;
        }
      }
    }
  };
}

function getToolAccumulatorKey(event: Extract<RouterStreamEvent, { type: 'tool-call-delta' }>): string {
  if (typeof event.toolCallIndex === 'number') {
    return `index:${event.toolCallIndex}`;
  }

  return `id:${event.toolCallId ?? 'unknown'}`;
}
