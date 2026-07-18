import * as vscode from 'vscode';

interface LanguageModelThinkingPartLike {
  readonly value: string | string[];
}

interface LanguageModelThinkingPartConstructor {
  new (value: string | string[]): LanguageModelThinkingPartLike;
}

interface VscodeThinkingApi {
  readonly LanguageModelThinkingPart?: LanguageModelThinkingPartConstructor;
}

function getThinkingPartConstructor(api: unknown): LanguageModelThinkingPartConstructor | undefined {
  if ((typeof api !== 'object' || api === null) && typeof api !== 'function') {
    return undefined;
  }

  const candidate = (api as VscodeThinkingApi).LanguageModelThinkingPart;
  return typeof candidate === 'function' ? candidate : undefined;
}

/**
 * Creates the proposed VS Code thinking response part when the running host exposes it.
 * The cast stays inside this compatibility boundary because the stable response union does
 * not yet include LanguageModelThinkingPart.
 */
export function createLanguageModelThinkingResponsePart(
  value: string,
  api: unknown = vscode
): vscode.LanguageModelResponsePart | undefined {
  const ThinkingPart = getThinkingPartConstructor(api);
  if (!ThinkingPart) {
    return undefined;
  }

  try {
    return new ThinkingPart(value) as unknown as vscode.LanguageModelResponsePart;
  } catch {
    return undefined;
  }
}

export function isLanguageModelThinkingPart(value: unknown, api: unknown = vscode): boolean {
  const ThinkingPart = getThinkingPartConstructor(api);
  if (!ThinkingPart) {
    return false;
  }

  try {
    return value instanceof ThinkingPart;
  } catch {
    return false;
  }
}

export function isLanguageModelThinkingPartAvailable(api: unknown = vscode): boolean {
  return getThinkingPartConstructor(api) !== undefined;
}
