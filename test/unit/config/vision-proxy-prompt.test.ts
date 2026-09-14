import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDefaultVisionProxyPrompt } from '@/config/vision-proxy-prompt';

describe('readDefaultVisionProxyPrompt', () => {
  it('reads the bundled Markdown prompt at runtime', async () => {
    const prompt = await readDefaultVisionProxyPrompt(process.cwd());

    expect(prompt).toMatch(/^Text extraction is mandatory\./);
    expect(prompt).toContain('--- Visual Context ---');
  });

  it('reports the bundled Markdown path when the prompt is missing', async () => {
    const extensionPath = await mkdtemp(join(tmpdir(), '9router-prompt-'));

    try {
      await expect(readDefaultVisionProxyPrompt(extensionPath)).rejects.toThrow(
        `Unable to read default Vision proxy prompt: ${join(
          extensionPath,
          'prompts/vision',
          'default-vision-proxy-prompt.md'
        )}`
      );
    } finally {
      await rm(extensionPath, { recursive: true, force: true });
    }
  });
});
