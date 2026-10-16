import type { RouterStreamEvent } from '@/types/router-contract';

export const MAX_TOOL_CALL_ARGUMENT_BYTES = 1024 * 1024;
export const MAX_TOTAL_TOOL_CALL_ARGUMENT_BYTES = 4 * 1024 * 1024;

export interface AssembledToolCall {
  id: string;
  name: string;
  argumentsText: string;
  arguments: Record<string, unknown>;
}

export type AssemblerFeedResult =
  | { ok: true }
  | { ok: false; reason: string };

export type AssemblerFinishResult =
  | { ok: true; text: string; toolCalls: AssembledToolCall[]; thinkingText: string }
  | { ok: false; reason: string };

interface ToolAccumulator {
  id?: string;
  name?: string;
  buffer: string;
  bytes: number;
}

export function parseToolCallArguments(
  raw: string
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: '9router streamed malformed tool call arguments' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: '9router streamed non-object tool call arguments' };
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}

function getToolAccumulatorKey(
  event: Extract<RouterStreamEvent, { type: 'tool-call-delta' | 'tool-call-complete' }>
): string {
  if (typeof event.toolCallIndex === 'number') {
    return `index:${event.toolCallIndex}`;
  }

  return `id:${event.toolCallId ?? 'unknown'}`;
}

export interface ResponseAssembler {
  feed(event: RouterStreamEvent): AssemblerFeedResult;
  finish(): AssemblerFinishResult;
  getText(): string;
  getThinkingText(): string;
  getToolCalls(): AssembledToolCall[];
}

export function createResponseAssembler(): ResponseAssembler {
  const toolCalls = new Map<string, ToolAccumulator>();
  let totalToolCallBytes = 0;
  let streamedText = false;
  let text = '';
  let completedText = '';
  let thinkingText = '';
  let errorReason: string | undefined;

  return {
    feed(event: RouterStreamEvent): AssemblerFeedResult {
      if (errorReason) {
        return { ok: false, reason: errorReason };
      }

      if (event.type === 'text-delta') {
        streamedText = true;
        text += event.text;
        return { ok: true };
      }

      if (event.type === 'text-done') {
        completedText += event.text;
        return { ok: true };
      }

      if (event.type === 'thinking-delta') {
        thinkingText += event.text;
        return { ok: true };
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
          errorReason = '9router streamed oversized tool call arguments';
          return { ok: false, reason: errorReason };
        }

        previous.buffer += event.delta;
        toolCalls.set(key, previous);
        return { ok: true };
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
          errorReason = '9router streamed oversized tool call arguments';
          return { ok: false, reason: errorReason };
        }

        totalToolCallBytes = nextTotalBytes;
        toolCalls.set(key, {
          id: event.toolCallId,
          name: event.toolName,
          buffer: event.arguments,
          bytes: argumentBytes
        });
        return { ok: true };
      }

      return { ok: true };
    },

    finish(): AssemblerFinishResult {
      if (errorReason) {
        return { ok: false, reason: errorReason };
      }

      const finalText = streamedText || completedText.length === 0 ? text : completedText;
      const assembledCalls: AssembledToolCall[] = [];

      for (const call of toolCalls.values()) {
        if (!call.id || !call.name) {
          return { ok: false, reason: '9router streamed a tool call without id or name' };
        }

        const parsed = parseToolCallArguments(call.buffer);
        if (!parsed.ok) {
          return { ok: false, reason: parsed.reason };
        }

        assembledCalls.push({
          id: call.id,
          name: call.name,
          argumentsText: call.buffer,
          arguments: parsed.value
        });
      }

      return {
        ok: true,
        text: finalText,
        toolCalls: assembledCalls,
        thinkingText
      };
    },

    getText(): string {
      return streamedText || completedText.length === 0 ? text : completedText;
    },

    getThinkingText(): string {
      return thinkingText;
    },

    getToolCalls(): AssembledToolCall[] {
      const calls: AssembledToolCall[] = [];
      for (const call of toolCalls.values()) {
        if (call.id && call.name) {
          const parsed = parseToolCallArguments(call.buffer);
          if (parsed.ok) {
            calls.push({
              id: call.id,
              name: call.name,
              argumentsText: call.buffer,
              arguments: parsed.value
            });
          }
        }
      }
      return calls;
    }
  };
}
