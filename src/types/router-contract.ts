export type RouterRole = 'system' | 'user' | 'assistant' | 'tool';

export type RouterContentPart = string | Record<string, unknown>;
export type RouterMessageContent = string | RouterContentPart[];

export interface RouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface RouterMessage {
  role: RouterRole;
  content: RouterMessageContent | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: RouterToolCall[];
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
  service_tier?: 'fast';
  stream_options?: {
    include_usage: true;
  };
  max_tokens?: number;
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  tools?: RouterToolDefinition[];
  tool_choice?: 'auto' | 'required';
}

export type RouterStreamEvent =
  | { type: 'text-delta'; text: string }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }
  | {
      type: 'tool-call-delta';
      toolCallIndex?: number;
      toolCallId?: string;
      toolName?: string;
      delta: string;
    }
  | { type: 'response-complete'; finishReason?: string; requestId?: string }
  | { type: 'router-error'; error: string; requestId?: string };
