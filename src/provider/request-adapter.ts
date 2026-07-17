import { adaptToolOptionsForRouter } from './tool-adapter';
import type { DisplayModelSetting } from '../types/product-model';
import type {
  RouterChatCompletionRequest,
  RouterContentPart,
  RouterMessage,
  RouterMessageContent,
  RouterToolCall
} from '../types/router-contract';
import type { HostToolDefinition } from './tool-adapter';
import type { HostChatRequestMessage } from './vision-proxy';

function mapRole(role: unknown): RouterMessage['role'] {
  if (role === 0 || role === 'system') {
    return 'system';
  }

  if (role === 2 || role === 'assistant') {
    return 'assistant';
  }

  return 'user';
}

function extractTextContent(content: HostChatRequestMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (typeof part === 'object' && part !== null && 'value' in part && typeof part.value === 'string') {
        return part.value;
      }

      if (isToolCallPartLike(part) || isToolResultPartLike(part)) {
        return '';
      }

      return '[Unsupported input part omitted]';
    })
    .filter((part) => part.length > 0)
    .join('\n');
}

function adaptNativeVisionContent(content: HostChatRequestMessage['content']): RouterMessageContent {
  if (typeof content === 'string') {
    return content;
  }

  return content.map((part): RouterContentPart => {
    if (typeof part === 'string') {
      return { type: 'text', text: part };
    }

    if (typeof part === 'object' && part !== null && 'value' in part && typeof part.value === 'string') {
      return { type: 'text', text: part.value };
    }

    if (typeof part === 'object' && part !== null) {
      return part as Record<string, unknown>;
    }

    return { type: 'text', text: String(part) };
  });
}

function adaptOrdinaryMessage(
  message: HostChatRequestMessage,
  selectedModel: DisplayModelSetting
): RouterMessage {
  const routerMessage: RouterMessage = {
    role: mapRole(message.role),
    content:
      selectedModel.visionMode === 'native'
        ? adaptNativeVisionContent(message.content)
        : extractTextContent(message.content)
  };

  if (message.name) {
    routerMessage.name = message.name;
  }

  return routerMessage;
}

interface ToolCallLike {
  callId: string;
  name: string;
  input: object;
}

interface ToolResultLike {
  callId: string;
  content: readonly unknown[];
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
): RouterToolCall[] {
  if (typeof content === 'string') {
    return [];
  }

  const toolCalls: RouterToolCall[] = [];

  for (const part of content) {
    const toolCall = createRouterToolCall(part);
    if (toolCall) {
      toolCalls.push(toolCall);
    }
  }

  return toolCalls;
}

function createRouterToolCall(part: unknown): RouterToolCall | undefined {
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
    serializedInput = JSON.stringify(part.input);
  } catch {
    return undefined;
  }

  if (serializedInput === undefined) {
    return undefined;
  }

  const toolCall: ToolCallLike = {
    callId,
    name,
    input: part.input
  };

  return {
    id: toolCall.callId,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: serializedInput
    }
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

      return JSON.stringify(part);
    })
    .join('\n');
}

export function adaptMessagesToRouterRequest(input: {
  selectedModel: DisplayModelSetting;
  messages: readonly HostChatRequestMessage[];
  tools?: readonly HostToolDefinition[];
  hostToolMode?: unknown;
  maxTokens?: number;
}): RouterChatCompletionRequest {
  const activeToolCallIds = new Set<string>();
  const messages: RouterMessage[] = [];

  for (const message of input.messages) {
    const toolCalls = extractRouterToolCalls(message.content);
    if (toolCalls.length > 0) {
      activeToolCallIds.clear();
      const routerMessage: RouterMessage = {
        role: 'assistant',
        content: extractTextContent(message.content).trim() || null,
        tool_calls: toolCalls
      };

      if (message.name) {
        routerMessage.name = message.name;
      }

      messages.push(routerMessage);
      for (const toolCall of toolCalls) {
        activeToolCallIds.add(toolCall.id);
      }
      continue;
    }

    const toolResults = findToolResultParts(message.content);
    if (toolResults.length > 0) {
      const matchingResults: RouterMessage[] = [];
      const orphanedResultContents: string[] = [];

      for (const toolResult of toolResults) {
        const callId = toolResult.callId.trim();
        const content = extractToolResultText(toolResult);
        if (callId.length > 0 && activeToolCallIds.delete(callId)) {
          matchingResults.push({
            role: 'tool',
            content,
            tool_call_id: callId
          });
        } else {
          orphanedResultContents.push(content);
        }
      }

      messages.push(...matchingResults);

      const ordinaryText = extractTextContent(message.content).trim();
      if (orphanedResultContents.length > 0 || ordinaryText) {
        activeToolCallIds.clear();
      }

      for (const content of orphanedResultContents) {
        messages.push({
          role: 'user',
          content
        });
      }

      if (ordinaryText) {
        messages.push({
          role: 'user',
          content: ordinaryText
        });
      }
      continue;
    }

    activeToolCallIds.clear();
    messages.push(adaptOrdinaryMessage(message, input.selectedModel));
  }

  const request: RouterChatCompletionRequest = {
    model: input.selectedModel.comboId,
    stream: true,
    messages
  };

  if (input.selectedModel.thinkingMode !== 'off') {
    request.reasoning_effort = input.selectedModel.thinkingMode;
  }

  if (typeof input.maxTokens === 'number') {
    request.max_tokens = input.maxTokens;
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
