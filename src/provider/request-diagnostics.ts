import type { RouterResponseRequest } from '@/types/router-contract';

export interface RouterRequestDiagnostics {
  assistantMessageCount: number;
  functionCallCount: number;
  functionCallOutputCount: number;
  hasReasoning: boolean;
  imagePartCount: number;
  inputItemCount: number;
  maxOutputTokens: number | 'omitted';
  systemMessageCount: number;
  textPartCount: number;
  toolChoice: string;
  toolDefinitionCount: number;
  userMessageCount: number;
}

export function createRouterRequestDiagnostics(
  request: RouterResponseRequest
): RouterRequestDiagnostics {
  let assistantMessageCount = 0;
  let functionCallCount = 0;
  let functionCallOutputCount = 0;
  let imagePartCount = 0;
  let systemMessageCount = 0;
  let textPartCount = 0;
  let userMessageCount = 0;

  for (const item of request.input) {
    if ('type' in item && item.type === 'function_call') {
      functionCallCount += 1;
      continue;
    }

    if ('type' in item && item.type === 'function_call_output') {
      functionCallOutputCount += 1;
      continue;
    }

    if (item.role === 'assistant') {
      assistantMessageCount += 1;
    } else if (item.role === 'system') {
      systemMessageCount += 1;
    } else {
      userMessageCount += 1;
    }

    if (typeof item.content === 'string') {
      textPartCount += 1;
      continue;
    }

    for (const part of item.content) {
      if (part.type === 'input_image') {
        imagePartCount += 1;
      } else {
        textPartCount += 1;
      }
    }
  }

  return {
    assistantMessageCount,
    functionCallCount,
    functionCallOutputCount,
    hasReasoning: request.reasoning !== undefined,
    imagePartCount,
    inputItemCount: request.input.length,
    maxOutputTokens: request.max_output_tokens ?? 'omitted',
    systemMessageCount,
    textPartCount,
    toolChoice: request.tool_choice ?? 'omitted',
    toolDefinitionCount: request.tools?.length ?? 0,
    userMessageCount
  };
}
