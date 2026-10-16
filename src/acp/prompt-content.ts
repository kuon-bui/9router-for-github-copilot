import type { RouterResponseMessage } from '@/types/router-contract';

export interface PromptContentBlock {
  type: string;
  text?: string;
  uri?: string;
  resource?: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
}

export function convertPromptBlocksToTextMessage(blocks: PromptContentBlock[]): RouterResponseMessage {
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'resource' && block.resource) {
      if (typeof block.resource.text === 'string') {
        parts.push(`<file path="${block.resource.uri}">\n${block.resource.text}\n</file>`);
      } else {
        parts.push(`[Binary resource at ${block.resource.uri} omitted]`);
      }
    } else if (block.type === 'resource_link' && block.uri) {
      parts.push(`[Referenced resource: ${block.uri}. Use read_file to inspect if needed.]`);
    }
  }

  const combined = parts.join('\n\n').trim();
  const textContent = combined.length > 0 ? combined : ' ';

  return {
    role: 'user',
    content: [{ type: 'input_text', text: textContent }]
  };
}
