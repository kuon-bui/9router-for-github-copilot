import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { registerCommands } from '@/runtime/commands';
import { createCodexExporter } from '@/runtime/export-codex-config';
import { readDefaultCodexInstructions } from '@/config/read-codex-instructions';
import { NineRouterError } from '@/router/errors';
import type { ConfiguredModel } from '@/types/product-model';
import type { SettingsSnapshot } from '@/config/settings';
import {
  __getCommandHandler,
  __getErrorMessages,
  __getInformationMessages,
  __resetVscodeState,
  __setOpenDialogResult,
  __setQuickPickValues,
  Uri
} from '@test/support/vscode';

function createContext() {
  return {
    subscriptions: [] as { dispose(): void }[],
    extensionUri: Uri.file('/ext'),
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined
    }
  } as never;
}

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

describe('9routerCopilot.exportCodexConfig', () => {
  beforeEach(() => {
    __resetVscodeState();
  });

  it('registers and invokes the exporter dependency', async () => {
    const exportCodexConfig = vi.fn(async () => ({
      mode: 'profile' as const,
      directory: '/tmp/codex',
      catalogPath: '/tmp/codex/9router-models.json',
      configPath: '/tmp/codex/9router.config.toml',
      warnings: []
    }));

    registerCommands(createContext(), { exportCodexConfig });
    await __getCommandHandler('9routerCopilot.exportCodexConfig')?.();

    expect(exportCodexConfig).toHaveBeenCalledTimes(1);
  });

  it('surfaces configuration errors without writing guidance about secrets', async () => {
    registerCommands(createContext(), {
      exportCodexConfig: async () => {
        throw new NineRouterError(
          'CONFIGURATION_ERROR',
          'No publishable models available to export.'
        );
      }
    });

    await __getCommandHandler('9routerCopilot.exportCodexConfig')?.();

    expect(__getErrorMessages().join('\n')).toContain('No publishable models available to export.');
    expect(__getErrorMessages().join('\n')).not.toMatch(/sk-|api key value/i);
    expect(__getInformationMessages()).toEqual([]);
  });

  it('exports models populated with the bundled Markdown prompt end-to-end', async () => {
    const fs = memoryFs();
    const folder = path.join('/tmp', 'e2e-codex-export');
    __setQuickPickValues([{ label: 'Choose folder…', destination: 'folder' }]);
    __setOpenDialogResult([folder]);

    const snapshot = usableSnapshot([
      model({ id: 'agent', name: 'Agent', modelId: 'router/agent' }),
      model({ id: 'coder', name: 'Coder', modelId: 'router/coder' })
    ]);

    const exportCodexConfig = createCodexExporter({
      getSettingsSnapshot: () => snapshot,
      loadCodexInstructions: () => readDefaultCodexInstructions(process.cwd()),
      fs
    });

    registerCommands(createContext(), { exportCodexConfig });
    await __getCommandHandler('9routerCopilot.exportCodexConfig')?.();

    const catalogPath = path.join(folder, '9router-models.json');
    const catalogRaw = fs.files.get(catalogPath);
    expect(catalogRaw).toBeDefined();

    const parsed = JSON.parse(catalogRaw!);
    expect(parsed.models).toHaveLength(2);

    const expectedPrompt = await readDefaultCodexInstructions(process.cwd());
    for (const exportedModel of parsed.models) {
      expect(exportedModel.model_messages.instructions_template).toBe(expectedPrompt);
      expect(exportedModel.model_messages.instructions_template).toContain('<behavior>');
      expect(exportedModel.model_messages.instructions_template).toContain('<communication>');
    }
  });
});
