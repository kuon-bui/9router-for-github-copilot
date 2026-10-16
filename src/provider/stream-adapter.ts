import * as vscode from 'vscode';
import { NineRouterError } from '@/router/errors';
import {
  MAX_TOTAL_TOOL_CALL_ARGUMENT_BYTES,
  MAX_TOOL_CALL_ARGUMENT_BYTES,
  parseToolCallArguments
} from '@/router/response-assembler';
import type { RouterStreamEvent } from '@/types/router-contract';
import type { ThinkingPartHost } from '@/types/vscode-chat-compat';

interface ToolAccumulator {
  id?: string;
  name?: string;
  buffer: string;
  bytes: number;
}

export interface RouterEventEmitter {
  emit(event: RouterStreamEvent): void;
}

export function isThinkingPartSupported(host: ThinkingPartHost = vscode): boolean {
  return typeof host.LanguageModelThinkingPart === 'function';
}

export function reportThinkingPart(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  value: string,
  id?: string,
  host: ThinkingPartHost = vscode
): void {
  const thinkingPart = host.LanguageModelThinkingPart;
  if (typeof thinkingPart !== 'function') {
    return;
  }

  // Narrow interop cast: stable typings do not name proposed thinking parts yet.
  progress.report(new thinkingPart(value, id) as unknown as vscode.LanguageModelResponsePart);
}

export function createRouterEventEmitter(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  host: ThinkingPartHost = vscode
): RouterEventEmitter {
  const toolCalls = new Map<string, ToolAccumulator>();
  let totalToolCallBytes = 0;
  let streamedText = false;
  let completedText = '';

  return {
    emit(event) {
      if (event.type === 'text-delta') {
        streamedText = true;
        progress.report(new vscode.LanguageModelTextPart(event.text));
        return;
      }

      // Held back rather than reported on arrival: when deltas already streamed this is the same
      // text again, and only the terminal event tells us whether the turn produced any.
      if (event.type === 'text-done') {
        completedText += event.text;
        return;
      }

      if (event.type === 'thinking-delta') {
        reportThinkingPart(progress, event.text, undefined, host);
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
          buffer: '',
          bytes: 0
        };

        if (event.toolCallId) {
          previous.id = event.toolCallId;
        }

        if (event.toolName) {
          previous.name = event.toolName;
        }

        const deltaBytes = new TextEncoder().encode(event.delta).byteLength;
        previous.bytes += deltaBytes;
        totalToolCallBytes += deltaBytes;
        if (
          previous.bytes > MAX_TOOL_CALL_ARGUMENT_BYTES ||
          totalToolCallBytes > MAX_TOTAL_TOOL_CALL_ARGUMENT_BYTES
        ) {
          throw createMalformedToolCallError('9router streamed oversized tool call arguments');
        }

        previous.buffer += event.delta;
        toolCalls.set(key, previous);
        return;
      }

      if (event.type === 'tool-call-complete') {
        const key = getToolAccumulatorKey(event);
        const previous = toolCalls.get(key);
        const argumentBytes = new TextEncoder().encode(event.arguments).byteLength;
        const nextTotalBytes = totalToolCallBytes - (previous?.bytes ?? 0) + argumentBytes;
        if (
          argumentBytes > MAX_TOOL_CALL_ARGUMENT_BYTES ||
          nextTotalBytes > MAX_TOTAL_TOOL_CALL_ARGUMENT_BYTES
        ) {
          throw createMalformedToolCallError('9router streamed oversized tool call arguments');
        }

        totalToolCallBytes = nextTotalBytes;
        toolCalls.set(key, {
          id: event.toolCallId,
          name: event.toolName,
          buffer: event.arguments,
          bytes: argumentBytes
        });
        return;
      }

      if (event.type === 'response-complete') {
        if (!streamedText && completedText.length > 0) {
          progress.report(new vscode.LanguageModelTextPart(completedText));
        }

        completedText = '';

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

  const parsed = parseToolCallArguments(toolCall.buffer);
  if (!parsed.ok) {
    throw createMalformedToolCallError(parsed.reason);
  }

  progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, parsed.value));
}

function createMalformedToolCallError(message: string): NineRouterError {
  return new NineRouterError('MALFORMED_STREAM_ERROR', message, {
    details: { phase: 'tool-call-streaming' }
  });
}

function getToolAccumulatorKey(
  event: Extract<RouterStreamEvent, { type: 'tool-call-delta' | 'tool-call-complete' }>
): string {
  if (typeof event.toolCallIndex === 'number') {
    return `index:${event.toolCallIndex}`;
  }

  return `id:${event.toolCallId ?? 'unknown'}`;
}
