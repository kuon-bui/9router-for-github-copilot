import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { buildInlineCompletionRequest, normalizeInlineSuggestion } from '../../../src/provider/inline-request-adapter';

function document(text: string, languageId = 'typescript') {
  const offsetAt = (position: { line: number; character: number }) => {
    const lines = text.split('\n');
    return lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) +
      position.character;
  };

  return {
    languageId,
    getText: (range?: vscode.Range) =>
      range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text,
    offsetAt,
    positionAt: (offset: number) => new vscode.Position(0, Math.min(text.length, offset))
  };
}

const settings = {
  maxTokens: 64,
  prefixChars: 12,
  suffixChars: 8
};

describe('buildInlineCompletionRequest', () => {
  it('builds a small chat completion request for cursor context', () => {
    const request = buildInlineCompletionRequest({
      modelId: 'combo/inline',
      document: document('const value = arr\nconsole.log(value)\n'),
      position: new vscode.Position(1, 7),
      settings
    });

    expect(request).toMatchObject({
      model: 'combo/inline',
      stream: true,
      max_tokens: 64,
      messages: [
        { role: 'system' },
        {
          role: 'user',
          content: expect.stringContaining('<prefix>')
        }
      ]
    });
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('tool_choice');
    expect(request).not.toHaveProperty('reasoning_effort');
    expect(request).not.toHaveProperty('stream_options');
  });

  it('bounds prefix and suffix context', () => {
    const source = document('0123456789abcdefghijklmnopqrstuvwxyz');
    const request = buildInlineCompletionRequest({
      modelId: 'combo/inline',
      document: source,
      position: new vscode.Position(0, 20),
      settings
    });

    expect(request.messages[1]?.content).toContain('89abcdefghij');
    expect(request.messages[1]?.content).toContain('klmnopqr');
    expect(request.messages[1]?.content).not.toContain('01234567');
    expect(request.messages[1]?.content).not.toContain('klmnopqrs');
  });
});

describe('normalizeInlineSuggestion', () => {
  it('drops blank suggestions', () => {
    expect(normalizeInlineSuggestion('   \n')).toBeUndefined();
  });

  it('strips markdown fences', () => {
    expect(normalizeInlineSuggestion('```ts\nreturn value;\n```')).toBe('return value;');
  });

  it('preserves meaningful indentation and trailing whitespace', () => {
    expect(normalizeInlineSuggestion('  return value;\n    ')).toBe('  return value;\n    ');
  });
});
