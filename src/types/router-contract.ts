export type RouterRole = 'system' | 'user' | 'assistant' | 'tool';

export type RouterContentPart = string | Record<string, unknown>;
export type RouterMessageContent = string | RouterContentPart[];

export interface RouterMessage {
  role: RouterRole;
  content: RouterMessageContent;
  name?: string;
  tool_call_id?: string;
}

export interface RouterToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface RouterChatCompletionRequest {
  model: string;
  messages: RouterMessage[];
  stream: true;
  max_tokens?: number;
  tools?: RouterToolDefinition[];
  tool_choice?: 'auto' | 'required';
}

export type RouterStreamEvent =
  | { type: 'text-delta'; text: string }
  | {
      type: 'tool-call-delta';
      toolCallIndex?: number;
      toolCallId?: string;
      toolName?: string;
      delta: string;
    }
  | { type: 'response-complete'; finishReason?: string; requestId?: string }
  | { type: 'router-error'; error: string; requestId?: string };
