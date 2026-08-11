import type * as vscode from 'vscode';
import type { InlineSettings } from '../config/settings';
import type { RouterChatCompletionRequest } from '../types/router-contract';

interface InlineDocumentLike {
  readonly languageId: string;
  getText(range?: vscode.Range): string;
  offsetAt(position: vscode.Position): number;
}

export function buildInlineCompletionRequest(input: {
  modelId: string;
  document: InlineDocumentLike;
  position: vscode.Position;
  settings: Pick<InlineSettings, 'maxTokens' | 'prefixChars' | 'suffixChars'>;
}): RouterChatCompletionRequest {
  const context = extractInlineContext(input.document, input.position, input.settings);

  return {
    model: input.modelId,
    messages: [
      {
        role: 'system',
        content:
          'You are an inline code completion engine. Return only the exact text to insert at the cursor. Do not explain. Do not wrap output in Markdown fences.'
      },
      {
        role: 'user',
        content: [
          `Language: ${input.document.languageId}`,
          '<prefix>',
          context.prefix,
          '</prefix>',
          '<suffix>',
          context.suffix,
          '</suffix>'
        ].join('\n')
      }
    ],
    stream: true,
    max_tokens: input.settings.maxTokens
  };
}

function extractInlineContext(
  document: InlineDocumentLike,
  position: vscode.Position,
  settings: Pick<InlineSettings, 'prefixChars' | 'suffixChars'>
): { prefix: string; suffix: string } {
  const text = document.getText();
  const offset = document.offsetAt(position);

  return {
    prefix: text.slice(Math.max(0, offset - settings.prefixChars), offset),
    suffix: text.slice(offset, offset + settings.suffixChars)
  };
}

export function normalizeInlineSuggestion(input: string): string | undefined {
  const withoutFence = stripMarkdownFence(input);
  return withoutFence.trim().length > 0 ? withoutFence : undefined;
}

function stripMarkdownFence(input: string): string {
  const trimmed = input.trim();
  const fence = trimmed.match(/^```[\w-]*\s*\n([\s\S]*?)\n```$/u);
  return fence?.[1] ?? input;
}
