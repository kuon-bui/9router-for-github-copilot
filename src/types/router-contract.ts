export type RouterResponseMessageRole = 'system' | 'user' | 'assistant';

export interface RouterResponseInputText {
  type: 'input_text';
  text: string;
}

export interface RouterResponseInputImage {
  type: 'input_image';
  image_url: string;
}

export type RouterResponseInputContent =
  | RouterResponseInputText
  | RouterResponseInputImage;

export interface RouterResponseMessage {
  role: RouterResponseMessageRole;
  content: string | RouterResponseInputContent[];
}

export interface RouterResponseFunctionCall {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

export interface RouterResponseFunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export type RouterResponseInputItem =
  | RouterResponseMessage
  | RouterResponseFunctionCall
  | RouterResponseFunctionCallOutput;

export interface RouterToolDefinition {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: false;
}

export interface RouterResponseRequest {
  model: string;
  input: RouterResponseInputItem[];
  stream: true;
  store: false;
  service_tier?: 'fast';
  max_output_tokens?: number;
  reasoning?: {
    effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    summary: 'auto';
  };
  tools?: RouterToolDefinition[];
  tool_choice?: 'auto' | 'required';
}

export type RouterStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
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
  | {
      type: 'tool-call-complete';
      toolCallIndex?: number;
      toolCallId: string;
      toolName: string;
      arguments: string;
    }
  | { type: 'response-complete'; finishReason?: string; requestId?: string }
  | { type: 'router-error'; error: string; requestId?: string };
