import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCodexExporter } from '@/runtime/export-codex-config';
import { NineRouterError } from '@/router/errors';
import type { SettingsSnapshot } from '@/config/settings';
import type { ConfiguredModel } from '@/types/product-model';
import {
  __getErrorMessages,
  __getInformationMessages,
  __getOpenDialogCalls,
  __getWarningMessages,
  __resetVscodeState,
  __setOpenDialogResult,
  __setQuickPickValues,
  __setWarningResponse,
  __setWarningResponses
} from '@test/support/vscode';

function model(
  partial: Partial<ConfiguredModel> & Pick<ConfiguredModel, 'id' | 'name' | 'modelId'>
): ConfiguredModel {
  return {
    sourceIndex: partial.sourceIndex ?? 0,
    id: partial.id,
    name: partial.name,
    modelId: partial.modelId,
    toolMode: partial.toolMode ?? 'off',
    visionMode: partial.visionMode ?? 'off',
    thinkingMode: partial.thinkingMode ?? 'off',
    thinkingEfforts: partial.thinkingEfforts ?? [],
    maxInputTokens: partial.maxInputTokens ?? 128_000,
    maxOutputTokens: partial.maxOutputTokens ?? 8_192,
    ...(partial.serviceTier ? { serviceTier: partial.serviceTier } : {})
  };
}

function usableSnapshot(models: ConfiguredModel[]): SettingsSnapshot {
  return {
    state: 'valid',
    runtime: {
      baseUrl: 'http://127.0.0.1:20128',
      requestTimeoutMs: 60_000,
      debugMode: 'minimal',
      visionProxySource: undefined,
      visionProxyModelId: '',
      visionProxyPrompt: ''
    },
    models,
    publishedModels: [],
    rejectedModels: [],
    issues: []
  };
}

function memoryFs() {
  const files = new Map<string, string>();
  return {
    files,
    async mkdir(): Promise<string | undefined> {
      return undefined;
    },
    async readFile(filePath: string): Promise<string> {
      const value = files.get(filePath);
      if (value === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return value;
    },
    async writeFile(filePath: string, data: string): Promise<void> {
      files.set(filePath, data);
    },
    async access(filePath: string): Promise<void> {
      if (!files.has(filePath)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
    },
    async rm(filePath: string): Promise<void> {
      files.delete(filePath);
    }
  };
}

describe('createCodexExporter', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  it('throws CONFIGURATION_ERROR when runtime is missing', async () => {
    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () => ({
        state: 'invalid-runtime',
        runtime: undefined,
        models: [],
        publishedModels: [],
        rejectedModels: [],
        issues: []
      }),
      fs: memoryFs()
    });

    await expect(exportCodexConfig()).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR'
    });
  });

  it('throws CONFIGURATION_ERROR when no exportable models remain', async () => {
    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () => usableSnapshot([]),
      fs: memoryFs()
    });

    await expect(exportCodexConfig()).rejects.toBeInstanceOf(NineRouterError);
    await expect(exportCodexConfig()).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'No publishable models available to export.'
    });
  });

  it('returns undefined and writes nothing when destination Quick Pick is cancelled', async () => {
    const fs = memoryFs();
    __setQuickPickValues([undefined]);

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      fs
    });

    await expect(exportCodexConfig()).resolves.toBeUndefined();
    expect(fs.files.size).toBe(0);
    expect(__getInformationMessages()).toEqual([]);
  });

  it('writes catalog + profile into the chosen folder', async () => {
    const fs = memoryFs();
    const folder = path.join('/tmp', 'codex-export');
    __setQuickPickValues([{ label: 'Choose folder…', destination: 'folder' }]);
    __setOpenDialogResult([folder]);

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      fs
    });

    const summary = await exportCodexConfig();
    const catalogPath = path.join(folder, '9router-models.json');
    const configPath = path.join(folder, '9router.config.toml');

    expect(summary).toEqual({
      mode: 'profile',
      directory: folder,
      catalogPath,
      configPath,
      warnings: []
    });
    expect(fs.files.get(catalogPath)).toContain('"slug": "router/agent"');
    expect(fs.files.get(configPath)).toContain('model = "router/agent"');
    expect(fs.files.has(path.join(folder, 'config.toml'))).toBe(false);
    expect(__getOpenDialogCalls()[0]).toMatchObject({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false
    });
    expect(__getInformationMessages().join('\n')).toContain(catalogPath);
    expect(__getInformationMessages().join('\n')).toContain('NINE_ROUTER_API_KEY');
    expect(__getInformationMessages().join('\n')).toContain('codex --profile 9router');
  });

  it('installs a profile into Codex home when config.toml is absent', async () => {
    const fs = memoryFs();
    const home = path.join('/home', 'me');
    const directory = path.join(home, '.codex');
    __setQuickPickValues([{ label: 'Install into Codex home', destination: 'codex-home' }]);

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      env: { CODEX_HOME: '   ' },
      homedir: () => home,
      fs
    });

    const summary = await exportCodexConfig();
    expect(summary).toMatchObject({
      mode: 'profile',
      directory,
      catalogPath: path.join(directory, '9router-models.json'),
      configPath: path.join(directory, '9router.config.toml')
    });
    expect(fs.files.has(path.join(directory, '9router-models.json'))).toBe(true);
    expect(fs.files.has(path.join(directory, '9router.config.toml'))).toBe(true);
  });

  it('merges into config.toml when user chooses merge and confirms rewrite warning', async () => {
    const fs = memoryFs();
    const directory = path.join('/home', 'me', '.codex');
    const catalogPath = path.join(directory, '9router-models.json');
    const configPath = path.join(directory, 'config.toml');
    fs.files.set(
      configPath,
      [
        'model = "other"',
        'notice = "keep-me"',
        '',
        '[model_providers.openai]',
        'name = "OpenAI"',
        ''
      ].join('\n')
    );

    __setQuickPickValues([
      { label: 'Install into Codex home', destination: 'codex-home' },
      { label: 'Merge into config.toml', mode: 'merge' }
    ]);
    __setWarningResponses(['Continue']);

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      env: { CODEX_HOME: directory },
      fs
    });

    const summary = await exportCodexConfig();
    expect(summary).toEqual({
      mode: 'merge',
      directory,
      catalogPath,
      configPath,
      warnings: []
    });
    expect(fs.files.get(catalogPath)).toContain('"slug": "router/agent"');
    expect(fs.files.get(configPath)).toContain('model = "router/agent"');
    expect(fs.files.get(configPath)).toContain('notice = "keep-me"');
    expect(fs.files.get(configPath)).toContain('[model_providers.openai]');
    expect(fs.files.get(configPath)).toContain('[model_providers.9router]');
    expect(__getWarningMessages().join('\n')).toContain('may not preserve comments');
    expect(__getInformationMessages().join('\n')).toContain(configPath);
    expect(__getInformationMessages().join('\n')).toContain('NINE_ROUTER_API_KEY');
  });

  it('trims blank CODEX_HOME and falls back to homedir/.codex', async () => {
    const fs = memoryFs();
    const home = path.join('/Users', 'kuon');
    __setQuickPickValues([{ label: 'Install into Codex home', destination: 'codex-home' }]);

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      env: { CODEX_HOME: '\t  \n' },
      homedir: () => home,
      fs
    });

    const summary = await exportCodexConfig();
    expect(summary?.directory).toBe(path.join(home, '.codex'));
  });

  it('does not write anything when overwrite is declined', async () => {
    const fs = memoryFs();
    const directory = path.join('/tmp', 'codex-home');
    const catalogPath = path.join(directory, '9router-models.json');
    const configPath = path.join(directory, '9router.config.toml');
    fs.files.set(catalogPath, '{"models":[]}');
    fs.files.set(configPath, 'model = "old"\n');

    __setQuickPickValues([{ label: 'Install into Codex home', destination: 'codex-home' }]);
    __setWarningResponse('Cancel');

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      env: { CODEX_HOME: directory },
      fs
    });

    await expect(exportCodexConfig()).resolves.toBeUndefined();
    expect(fs.files.get(catalogPath)).toBe('{"models":[]}');
    expect(fs.files.get(configPath)).toBe('model = "old"\n');
    expect(__getErrorMessages()).toEqual([]);
  });

  it('cancels mode Quick Pick without writing catalog or config files', async () => {
    const fs = memoryFs();
    const directory = path.join('/home', 'me', '.codex');
    fs.files.set(path.join(directory, 'config.toml'), 'model = "other"\n');
    const mkdirCalls: string[] = [];
    const wrapped = {
      ...fs,
      async mkdir(target: string, options: { recursive: true }) {
        mkdirCalls.push(target);
        return fs.mkdir(target, options);
      }
    };

    __setQuickPickValues([
      { label: 'Install into Codex home', destination: 'codex-home' },
      undefined
    ]);

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      env: { CODEX_HOME: directory },
      fs: wrapped
    });

    await expect(exportCodexConfig()).resolves.toBeUndefined();
    expect(fs.files.has(path.join(directory, '9router-models.json'))).toBe(false);
    expect(fs.files.has(path.join(directory, '9router.config.toml'))).toBe(false);
    expect(mkdirCalls).toEqual([]);
  });

  it('cancels merge rewrite warning without writing catalog or config files', async () => {
    const fs = memoryFs();
    const directory = path.join('/home', 'me', '.codex');
    const configPath = path.join(directory, 'config.toml');
    fs.files.set(configPath, 'model = "other"\nnotice = "keep-me"\n');

    __setQuickPickValues([
      { label: 'Install into Codex home', destination: 'codex-home' },
      { label: 'Merge into config.toml', mode: 'merge' }
    ]);
    __setWarningResponses(['Cancel']);

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      env: { CODEX_HOME: directory },
      fs
    });

    await expect(exportCodexConfig()).resolves.toBeUndefined();
    expect(fs.files.has(path.join(directory, '9router-models.json'))).toBe(false);
    expect(fs.files.get(configPath)).toBe('model = "other"\nnotice = "keep-me"\n');
  });

  it('maps mkdir failure to CONFIGURATION_ERROR', async () => {
    __setQuickPickValues([{ label: 'Install into Codex home', destination: 'codex-home' }]);
    const fs = {
      ...memoryFs(),
      async mkdir(): Promise<string | undefined> {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
    };

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      env: { CODEX_HOME: path.join('/tmp', 'blocked-codex') },
      fs
    });

    await expect(exportCodexConfig()).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('create')
    });
  });

  it('rolls back catalog when config write fails', async () => {
    const fs = memoryFs();
    const directory = path.join('/tmp', 'codex-export');
    const catalogPath = path.join(directory, '9router-models.json');
    const configPath = path.join(directory, '9router.config.toml');
    let configWrites = 0;
    const wrapped = {
      ...fs,
      async writeFile(filePath: string, data: string, encoding: 'utf8') {
        if (filePath === configPath) {
          configWrites += 1;
          throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        }
        return fs.writeFile(filePath, data, encoding);
      },
      async rm(filePath: string) {
        fs.files.delete(filePath);
      }
    };

    __setQuickPickValues([{ label: 'Choose folder…', destination: 'folder' }]);
    __setOpenDialogResult([directory]);

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () =>
        usableSnapshot([model({ id: 'agent', name: 'Agent', modelId: 'router/agent' })]),
      fs: wrapped
    });

    await expect(exportCodexConfig()).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: expect.stringContaining('write')
    });
    expect(configWrites).toBe(1);
    expect(fs.files.has(catalogPath)).toBe(false);
    expect(fs.files.has(configPath)).toBe(false);
  });
});
