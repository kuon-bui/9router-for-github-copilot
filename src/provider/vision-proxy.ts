import type { DisplayModelSetting } from '../types/product-model';

export interface HostChatRequestMessage {
  role: unknown;
  content: string | readonly unknown[];
  name?: string;
}

export type VisionCompatibilityOutcome =
  | 'text-only'
  | 'native-vision'
  | 'vision-proxied'
  | 'vision-blocked';

export interface VisionCompatibilityResult {
  messages: readonly HostChatRequestMessage[];
  outcome: VisionCompatibilityOutcome;
  hasVisionInput: boolean;
  blockReason?: string;
}

export function hasNonTextContent(message: HostChatRequestMessage): boolean {
  if (typeof message.content === 'string') {
    return false;
  }

  return message.content.some((part) => {
    if (typeof part === 'string') {
      return false;
    }

    if (typeof part === 'object' && part !== null && 'value' in part && typeof part.value === 'string') {
      return false;
    }

    return true;
  });
}

export async function summarizeImageInputs(
  messages: readonly HostChatRequestMessage[]
): Promise<string> {
  const attachmentCount = messages.filter(hasNonTextContent).length;
  return `Vision proxy summary unavailable. ${attachmentCount} message(s) contained non-text inputs.`;
}

export async function prepareVisionCompatibleMessages(input: {
  selectedModel: DisplayModelSetting;
  messages: readonly HostChatRequestMessage[];
  summarizeImageInputs?: (
    messages: readonly HostChatRequestMessage[]
  ) => Promise<string>;
}): Promise<VisionCompatibilityResult> {
  const hasVisionInput = input.messages.some(hasNonTextContent);

  if (!hasVisionInput) {
    return {
      messages: input.messages,
      outcome: 'text-only',
      hasVisionInput
    };
  }

  if (input.selectedModel.visionMode === 'native') {
    return {
      messages: input.messages,
      outcome: 'native-vision',
      hasVisionInput
    };
  }

  if (input.selectedModel.visionMode === 'off') {
    return {
      messages: input.messages,
      outcome: 'vision-blocked',
      hasVisionInput,
      blockReason: `Display model "${input.selectedModel.key}" cannot accept image inputs because visionMode is off.`
    };
  }

  const summarize = input.summarizeImageInputs ?? summarizeImageInputs;
  const summary = await summarize(input.messages);

  return {
    messages: input.messages.map((message, index) => {
      if (index !== 0) {
        return message;
      }

      const prefix = typeof message.content === 'string' ? message.content : '[Non-text content omitted for proxy]';
      return {
        ...message,
        content: `${prefix}\n\n[Vision proxy summary]\n${summary}`
      };
    }),
    outcome: 'vision-proxied',
    hasVisionInput
  };
}
