import * as vscode from 'vscode';
import type { RouterStreamEvent } from '../types/router-contract';
import { createLanguageModelThinkingResponsePart } from './reasoning-part-compat';

interface ToolAccumulator {
  id?: string;
  name?: string;
  buffer: string;
}

export interface RouterEventEmitter {
  emit(event: RouterStreamEvent): void;
  getReasoningSummary(): ReasoningStreamSummary;
}

export interface ReasoningStreamSummary {
  receivedDeltas: number;
  receivedCharacters: number;
  emittedDeltas: number;
  droppedDeltas: number;
}

interface RouterEventEmitterOptions {
  createThinkingPart?: (value: string) => vscode.LanguageModelResponsePart | undefined;
}

export function createRouterEventEmitter(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  options: RouterEventEmitterOptions = {}
): RouterEventEmitter {
  const toolCalls = new Map<string, ToolAccumulator>();
  const createThinkingPart =
    options.createThinkingPart ?? createLanguageModelThinkingResponsePart;
  const reasoningSummary: ReasoningStreamSummary = {
    receivedDeltas: 0,
    receivedCharacters: 0,
    emittedDeltas: 0,
    droppedDeltas: 0
  };

  return {
    emit(event) {
      if (event.type === 'reasoning-delta') {
        reasoningSummary.receivedDeltas += 1;
        reasoningSummary.receivedCharacters += event.text.length;

        const part = createThinkingPart(event.text);
        if (part) {
          try {
            progress.report(part);
            reasoningSummary.emittedDeltas += 1;
          } catch {
            reasoningSummary.droppedDeltas += 1;
          }
        } else {
          reasoningSummary.droppedDeltas += 1;
        }
        return;
      }

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
    },
    getReasoningSummary() {
      return { ...reasoningSummary };
    }
  };
}

function getToolAccumulatorKey(event: Extract<RouterStreamEvent, { type: 'tool-call-delta' }>): string {
  if (typeof event.toolCallIndex === 'number') {
    return `index:${event.toolCallIndex}`;
  }

  return `id:${event.toolCallId ?? 'unknown'}`;
}
