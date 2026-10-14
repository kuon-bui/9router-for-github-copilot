import { adaptToolOptionsForRouter } from './tool-adapter';
import type { ConfiguredModel } from '@/types/product-model';
import type {
  RouterResponseFunctionCall,
  RouterResponseFunctionCallOutput,
  RouterResponseInputItem,
  RouterResponseMessage,
  RouterResponseMessageContent,
  RouterResponseRequest
} from '@/types/router-contract';
import type { HostToolDefinition } from './tool-adapter';
import type { HostChatRequestMessage } from './vision-proxy';
import { createRouterImagePart, isHostImageDataPart } from './image-input-adapter';
import { canonicalJsonStringify } from './canonical-json';

// VS Code numbers LanguageModelChatMessageRole as User = 1, Assistant = 2, System = 3.
function mapRole(role: unknown): RouterResponseMessage['role'] {
  if (role === 3 || role === 0 || role === 'system') {
    return 'system';
  }

  if (role === 2 || role === 'assistant') {
    return 'assistant';
  }

  return 'user';
}

// Unsupported parts are dropped rather than replaced with placeholder text: anything written here
// is model-visible, and a model that reads a placeholder in its own past turns starts answering
// with it.
function extractTextContent(content: HostChatRequestMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (isThinkingPartLike(part)) {
        return '';
      }

      if (typeof part === 'object' && part !== null && 'value' in part && typeof part.value === 'string') {
        return part.value;
      }

      return '';
    })
    .filter((part) => part.length > 0)
    .join('\n');
}

// An assistant turn may only carry `output_text`, and it has no notion of an inbound image, so
// image parts are dropped there rather than sent as `input_image` and rejected by the router.
function adaptNativeVisionContent(
  content: HostChatRequestMessage['content'],
  role: RouterResponseMessage['role']
): string | RouterResponseMessageContent[] {
  if (typeof content === 'string') {
    return content;
  }

  const asText = (text: string): RouterResponseMessageContent =>
    role === 'assistant' ? { type: 'output_text', text } : { type: 'input_text', text };

  return content
    .map((part): RouterResponseMessageContent | undefined => {
      if (typeof part === 'string') {
        return asText(part);
      }

      if (isHostImageDataPart(part)) {
        return role === 'assistant' ? undefined : createRouterImagePart(part);
      }

      if (isThinkingPartLike(part)) {
        return undefined;
      }

      if (typeof part === 'object' && part !== null && 'value' in part && typeof part.value === 'string') {
        return asText(part.value);
      }

      return undefined;
    })
    .filter((part): part is RouterResponseMessageContent => part !== undefined);
}

function adaptOrdinaryMessage(
  message: HostChatRequestMessage,
  selectedModel: ConfiguredModel
): RouterResponseMessage {
  const role = mapRole(message.role);

  return {
    role,
    content:
      selectedModel.visionMode === 'native'
        ? adaptNativeVisionContent(message.content, role)
        : extractTextContent(message.content)
  };
}

interface ToolResultLike {
  callId: string;
  content: readonly unknown[];
}

// Replayed reasoning (`LanguageModelThinkingPart`) is not assistant output, so it never becomes
// input text. Its `value` may be a string array, and it always carries own `id` and `metadata`
// slots, which a text part never has.
function isThinkingPartLike(part: unknown): boolean {
  if (typeof part !== 'object' || part === null || !('value' in part)) {
    return false;
  }

  if (Array.isArray(part.value)) {
    return part.value.every((item) => typeof item === 'string');
  }

  return typeof part.value === 'string' && ('id' in part || 'metadata' in part);
}

function isToolCallPartLike(part: unknown): part is Record<string, unknown> {
  return (
    typeof part === 'object' &&
    part !== null &&
    'callId' in part &&
    'name' in part &&
    'input' in part
  );
}

function isToolResultPartLike(part: unknown): part is Record<string, unknown> {
  return (
    typeof part === 'object' &&
    part !== null &&
    'callId' in part &&
    'content' in part &&
    Array.isArray(part.content)
  );
}

function extractRouterToolCalls(
  content: HostChatRequestMessage['content']
): RouterResponseFunctionCall[] {
  if (typeof content === 'string') {
    return [];
  }

  const toolCalls: RouterResponseFunctionCall[] = [];

  for (const part of content) {
    const toolCall = createRouterToolCall(part);
    if (toolCall) {
      toolCalls.push(toolCall);
    }
  }

  return toolCalls;
}

function createRouterToolCall(part: unknown): RouterResponseFunctionCall | undefined {
  if (!isToolCallPartLike(part)) {
    return undefined;
  }

  const callId = typeof part.callId === 'string' ? part.callId.trim() : '';
  const name = typeof part.name === 'string' ? part.name.trim() : '';
  if (
    callId.length === 0 ||
    name.length === 0 ||
    typeof part.input !== 'object' ||
    part.input === null
  ) {
    return undefined;
  }

  let serializedInput: string | undefined;
  try {
    serializedInput = canonicalJsonStringify(part.input);
  } catch {
    return undefined;
  }

  if (serializedInput === undefined) {
    return undefined;
  }

  return {
    type: 'function_call',
    call_id: callId,
    name,
    arguments: serializedInput
  };
}

function findToolResultParts(content: HostChatRequestMessage['content']): ToolResultLike[] {
  if (typeof content === 'string') {
    return [];
  }

  return content.filter((part): part is ToolResultLike => {
    return isToolResultPartLike(part) && typeof part.callId === 'string';
  });
}

function extractToolResultText(toolResult: ToolResultLike): string {
  return toolResult.content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (typeof part === 'object' && part !== null && 'value' in part && typeof part.value === 'string') {
        return part.value;
      }

      const serializedPart = canonicalJsonStringify(part);
      return serializedPart ?? '';
    })
    .join('\n');
}

export function adaptMessagesToRouterRequest(input: {
  selectedModel: ConfiguredModel;
  messages: readonly HostChatRequestMessage[];
  tools?: readonly HostToolDefinition[];
  hostToolMode?: unknown;
  maxTokens?: number;
}): RouterResponseRequest {
  const activeToolCallIds = new Set<string>();
  const responseInput: RouterResponseInputItem[] = [];

  for (const message of input.messages) {
    const toolCalls = extractRouterToolCalls(message.content);
    if (toolCalls.length > 0) {
      activeToolCallIds.clear();

      const assistantText = extractTextContent(message.content).trim();
      if (assistantText) {
        responseInput.push({
          role: 'assistant',
          content: assistantText
        });
      }

      responseInput.push(...toolCalls);
      for (const toolCall of toolCalls) {
        activeToolCallIds.add(toolCall.call_id);
      }
      continue;
    }

    const toolResults = findToolResultParts(message.content);
    if (toolResults.length > 0) {
      const matchingResults: RouterResponseFunctionCallOutput[] = [];
      const orphanedResultContents: string[] = [];

      for (const toolResult of toolResults) {
        const callId = toolResult.callId.trim();
        const output = extractToolResultText(toolResult);
        if (callId.length > 0 && activeToolCallIds.delete(callId)) {
          matchingResults.push({
            type: 'function_call_output',
            call_id: callId,
            output
          });
        } else {
          orphanedResultContents.push(output);
        }
      }

      responseInput.push(...matchingResults);

      const ordinaryText = extractTextContent(message.content).trim();
      if (orphanedResultContents.length > 0 || ordinaryText) {
        activeToolCallIds.clear();
      }

      for (const content of orphanedResultContents) {
        responseInput.push({
          role: 'user',
          content
        });
      }

      if (ordinaryText) {
        responseInput.push({
          role: 'user',
          content: ordinaryText
        });
      }
      continue;
    }

    activeToolCallIds.clear();
    const ordinaryMessage = adaptOrdinaryMessage(message, input.selectedModel);
    if (ordinaryMessage.content.length > 0) {
      responseInput.push(ordinaryMessage);
    }
  }

  const request: RouterResponseRequest = {
    model: input.selectedModel.modelId,
    stream: true,
    store: false,
    input: responseInput
  };

  if (input.selectedModel.thinkingMode !== 'off') {
    request.reasoning = {
      effort: input.selectedModel.thinkingMode,
      summary: 'auto'
    };
  }

  if (input.selectedModel.serviceTier === 'fast') {
    request.service_tier = input.selectedModel.serviceTier;
  }

  if (typeof input.maxTokens === 'number') {
    request.max_output_tokens = input.maxTokens;
  }

  const toolOptionsInput: Parameters<typeof adaptToolOptionsForRouter>[0] = {
    selectedModel: input.selectedModel
  };

  if (input.tools) {
    toolOptionsInput.tools = input.tools;
  }

  if (input.hostToolMode !== undefined) {
    toolOptionsInput.hostToolMode = input.hostToolMode;
  }

  const toolOptions = adaptToolOptionsForRouter(toolOptionsInput);

  if (toolOptions.definitions.length > 0) {
    request.tools = toolOptions.definitions;
    if (toolOptions.toolChoice) {
      request.tool_choice = toolOptions.toolChoice;
    }
  }

  return request;
}
