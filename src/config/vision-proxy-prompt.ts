import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DEFAULT_VISION_PROXY_PROMPT_PATH = join(
  'prompts/vision',
  'default-vision-proxy-prompt.md'
);

export async function readDefaultVisionProxyPrompt(extensionPath: string): Promise<string> {
  const path = resolve(extensionPath, DEFAULT_VISION_PROXY_PROMPT_PATH);
  let prompt: string;

  try {
    prompt = (await readFile(path, 'utf8')).trim();
  } catch (cause) {
    throw new Error(`Unable to read default Vision proxy prompt: ${path}`, { cause });
  }

  if (prompt.length === 0) {
    throw new Error(`Default Vision proxy prompt is empty: ${path}`);
  }

  return prompt;
}
