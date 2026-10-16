import type { ToolResult } from '../tools/read-file';

export interface McpContentItem {
  type: string;
  text?: string | undefined;
  data?: string | undefined;
  mimeType?: string | undefined;
  uri?: string | undefined;
}

export interface McpCallToolResult {
  isError?: boolean | undefined;
  content?: McpContentItem[] | undefined;
  [key: string]: unknown;
}

export function formatMcpToolResult(result: McpCallToolResult): ToolResult {
  const isError = Boolean(result.isError);
  const items = Array.isArray(result.content) ? result.content : [];

  const textBlocks: string[] = [];
  for (const item of items) {
    if (item.type === 'text' && typeof item.text === 'string') {
      textBlocks.push(item.text);
    } else if (item.type === 'image') {
      textBlocks.push(`[Image content: ${item.mimeType ?? 'unknown type'}]`);
    } else if (item.type === 'resource' && item.uri) {
      textBlocks.push(`[Resource: ${item.uri}]`);
    }
  }

  const output = textBlocks.join('\n\n').trim();

  return {
    ok: !isError,
    output: output.length > 0 ? output : (isError ? 'Tool returned an error with no message' : '(empty tool response)')
  };
}
