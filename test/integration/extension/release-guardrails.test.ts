import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../../package.json';

describe('release guardrails', () => {
  it('does not contribute placeholder combo ids as executable defaults', () => {
    const properties = manifest.contributes.configuration.properties;

    expect(properties['9router-copilot.modelMappings.daily'].default).toBe('');
    expect(properties['9router-copilot.modelMappings.agent'].default).toBe('');
    expect(properties['9router-copilot.modelMappings.fallback'].default).toBe('');
  });

  it('contributes per-model thinking settings with safe defaults', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { default?: unknown; enum?: unknown[] }
    >;
    const acceptedModes = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

    for (const modelKey of ['daily', 'agent', 'fallback'] as const) {
      const setting = properties[`9router-copilot.thinkingMode.${modelKey}`];
      expect(setting).toMatchObject({
        default: 'off',
        enum: acceptedModes
      });
    }
  });

  it('documents thinking configuration without moving reasoning policy into the extension', async () => {
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
    const productionDesign = await readFile(
      resolve(
        process.cwd(),
        'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
      ),
      'utf8'
    );

    expect(readme).toContain('### Thinking Mode');
    expect(readme).toContain('9router-copilot.thinkingMode.agent');
    expect(readme).toContain('base combo id');
    expect(productionDesign).toContain('9router-copilot.thinkingMode.daily');
    expect(productionDesign).toContain('provider-specific reasoning translation');
  });

  it('keeps the VSIX package command explicit about local repository metadata', () => {
    const packageCommand = manifest.scripts.package;
    const hasRepositoryMetadata = 'repository' in manifest;

    expect(packageCommand).toContain('vsce package');
    expect(packageCommand).toContain('--no-dependencies');
    expect(hasRepositoryMetadata || packageCommand.includes('--allow-missing-repository')).toBe(true);
  });

  it('ships an explicit license artifact matching the private package policy', async () => {
    await expect(access(resolve(process.cwd(), 'LICENSE'), constants.R_OK)).resolves.toBeUndefined();

    const license = await readFile(resolve(process.cwd(), 'LICENSE'), 'utf8');
    expect(manifest.license).toBe('UNLICENSED');
    expect(license).toContain('UNLICENSED');
    expect(license).toContain('not licensed for copying');
  });

  it('keeps source, tests, and internal docs out of the packaged VSIX', async () => {
    const vscodeIgnore = await readFile(resolve(process.cwd(), '.vscodeignore'), 'utf8');

    expect(vscodeIgnore).toContain('.vscode/**');
    expect(vscodeIgnore).toContain('src/**');
    expect(vscodeIgnore).toContain('test/**');
    expect(vscodeIgnore).toContain('docs/**');
    expect(vscodeIgnore).toContain('AGENTS.md');
    expect(vscodeIgnore).toContain('CODE_CONVENTION.md');
    expect(vscodeIgnore).not.toContain('dist/src/**');
  });

  it('keeps VS Code debug workspace assets available for local extension development', async () => {
    const launchPath = resolve(process.cwd(), '.vscode/launch.json');
    const tasksPath = resolve(process.cwd(), '.vscode/tasks.json');

    await expect(access(launchPath, constants.R_OK)).resolves.toBeUndefined();
    await expect(access(tasksPath, constants.R_OK)).resolves.toBeUndefined();

    const launchJson = JSON.parse(await readFile(launchPath, 'utf8')) as {
      configurations?: Array<{ name?: string }>;
    };

    expect(launchJson.configurations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Watch and Debug Extension'
        }),
        expect.objectContaining({
          name: 'Build Once and Debug Extension'
        })
      ])
    );
  });

  it('documents the VS Code debug workflow for local development', async () => {
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('## Debug in VS Code');
    expect(readme).toContain('Watch and Debug Extension');
    expect(readme).toContain('Build Once and Debug Extension');
    expect(readme).toContain('9router Copilot');
  });
});
