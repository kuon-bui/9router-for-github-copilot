import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DEFAULT_CODEX_INSTRUCTIONS_PATH = join(
  'prompts/codex',
  'default-codex-instructions.md'
);

export async function readDefaultCodexInstructions(extensionPath: string): Promise<string> {
  const path = resolve(extensionPath, DEFAULT_CODEX_INSTRUCTIONS_PATH);
  let prompt: string;

  try {
    prompt = (await readFile(path, 'utf8')).trim();
  } catch (cause) {
    throw new Error(`Unable to read default Codex instructions: ${path}`, { cause });
  }

  if (prompt.length === 0) {
    throw new Error(`Default Codex instructions are empty: ${path}`);
  }

  return prompt;
}
