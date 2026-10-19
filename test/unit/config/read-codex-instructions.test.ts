import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDefaultCodexInstructions } from '@/config/read-codex-instructions';

describe('readDefaultCodexInstructions', () => {
  it('reads the bundled Markdown prompt at runtime', async () => {
    const prompt = await readDefaultCodexInstructions(process.cwd());

    expect(prompt).toMatch(/^You are a coding agent/);
    expect(prompt).toContain('<behavior>');
  });

  it('rejects empty or whitespace-only instructions prompt file', async () => {
    const extensionPath = await mkdtemp(join(tmpdir(), '9router-empty-prompt-'));
    const promptDir = join(extensionPath, 'prompts/codex');
    await mkdir(promptDir, { recursive: true });
    await writeFile(join(promptDir, 'default-codex-instructions.md'), '   \n\t  ', 'utf8');

    try {
      await expect(readDefaultCodexInstructions(extensionPath)).rejects.toThrow(
        /Default Codex instructions are empty:/
      );
    } finally {
      await rm(extensionPath, { recursive: true, force: true });
    }
  });

  it('reports the bundled Markdown path when the prompt is missing', async () => {
    const extensionPath = await mkdtemp(join(tmpdir(), '9router-codex-prompt-'));

    try {
      await expect(readDefaultCodexInstructions(extensionPath)).rejects.toThrow(
        `Unable to read default Codex instructions: ${join(
          extensionPath,
          'prompts/codex',
          'default-codex-instructions.md'
        )}`
      );
    } finally {
      await rm(extensionPath, { recursive: true, force: true });
    }
  });
});
