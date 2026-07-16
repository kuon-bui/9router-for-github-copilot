import { adaptToolOptionsForRouter } from './tool-adapter';
import type { DisplayModelSetting } from '../types/product-model';
import type {
  RouterChatCompletionRequest,
  RouterContentPart,
  RouterMessage,
  RouterMessageContent
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

  if (role === 3 || role === 'tool') {
    return 'tool';
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

      return '[Unsupported input part omitted]';
    })
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

function adaptMessageToRouterMessage(
  message: HostChatRequestMessage,
  selectedModel: DisplayModelSetting
): RouterMessage {
  const toolResult = findToolResultPart(message.content);
  if (toolResult) {
    return {
      role: 'tool',
      content: extractToolResultText(toolResult),
      tool_call_id: toolResult.callId
    };
  }

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

interface ToolResultLike {
  callId: string;
  content: readonly unknown[];
}

function findToolResultPart(content: HostChatRequestMessage['content']): ToolResultLike | undefined {
  if (typeof content === 'string') {
    return undefined;
  }

  return content.find((part): part is ToolResultLike => {
    return (
      typeof part === 'object' &&
      part !== null &&
      'callId' in part &&
      typeof part.callId === 'string' &&
      'content' in part &&
      Array.isArray(part.content)
    );
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
  const messages: RouterMessage[] = input.messages.map((message) =>
    adaptMessageToRouterMessage(message, input.selectedModel)
  );

  const request: RouterChatCompletionRequest = {
    model: input.selectedModel.comboId,
    stream: true,
    messages
  };

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
