import * as vscode from 'vscode';
import { NineRouterError } from '@/router/errors';
import type { RouterStreamEvent } from '@/types/router-contract';
import type { ThinkingPartHost } from '@/types/vscode-chat-compat';

// ponytail: 1 MiB per call and 4 MiB total cover normal tool JSON; raise if 9router supports larger tool payloads.
const MAX_TOOL_CALL_ARGUMENT_BYTES = 1024 * 1024;
const MAX_TOTAL_TOOL_CALL_ARGUMENT_BYTES = 4 * 1024 * 1024;

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

export function createRouterEventEmitter(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  host: ThinkingPartHost = vscode
): RouterEventEmitter {
  const toolCalls = new Map<string, ToolAccumulator>();
  const thinkingPart = host.LanguageModelThinkingPart;
  let totalToolCallBytes = 0;

  return {
    emit(event) {
      if (event.type === 'text-delta') {
        progress.report(new vscode.LanguageModelTextPart(event.text));
        return;
      }

      if (event.type === 'thinking-delta') {
        if (typeof thinkingPart === 'function') {
          // Narrow interop cast: thinking parts are accepted by the host at runtime but the stable
          // LanguageModelResponsePart union does not name them yet.
          progress.report(new thinkingPart(event.text) as unknown as vscode.LanguageModelResponsePart);
        }

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

function getToolAccumulatorKey(
  event: Extract<RouterStreamEvent, { type: 'tool-call-delta' | 'tool-call-complete' }>
): string {
  if (typeof event.toolCallIndex === 'number') {
    return `index:${event.toolCallIndex}`;
  }

  return `id:${event.toolCallId ?? 'unknown'}`;
}
