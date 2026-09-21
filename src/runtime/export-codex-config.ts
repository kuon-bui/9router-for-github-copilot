import * as vscode from 'vscode';
import { homedir as osHomedir } from 'node:os';
import path from 'node:path';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { buildCodexExport, mergeCodexConfigToml, selectExportModels } from '@/config/codex-export';
import { isUsableRuntimeSettings, type SettingsSnapshot } from '@/config/settings';
import { NineRouterError } from '@/router/errors';

export interface CodexExportSummary {
  mode: 'profile' | 'merge';
  directory: string;
  catalogPath: string;
  configPath: string;
  warnings: string[];
}

export type CodexExporter = () => Promise<CodexExportSummary | undefined>;

export interface CodexExportFs {
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
  access(path: string): Promise<void>;
  rm(path: string): Promise<void>;
}

interface DestinationQuickPickItem extends vscode.QuickPickItem {
  destination: 'folder' | 'codex-home';
}

interface ModeQuickPickItem extends vscode.QuickPickItem {
  mode: 'profile' | 'merge';
}

async function pathExists(fs: CodexExportFs, targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function confirmOverwrite(
  fs: CodexExportFs,
  targetPaths: string[]
): Promise<boolean> {
  for (const targetPath of targetPaths) {
    if (!(await pathExists(fs, targetPath))) {
      continue;
    }

    const choice = await vscode.window.showWarningMessage(
      `Overwrite existing file?\n${targetPath}`,
      { modal: true },
      'Overwrite',
      'Cancel'
    );
    if (choice !== 'Overwrite') {
      return false;
    }
  }

  return true;
}

function resolveCodexHome(
  env: Record<string, string | undefined>,
  homedir: () => string
): string {
  const configured = (env.CODEX_HOME ?? '').trim();
  return configured.length > 0 ? configured : path.join(homedir(), '.codex');
}

async function ensureDirectory(fs: CodexExportFs, directory: string): Promise<void> {
  try {
    await fs.mkdir(directory, { recursive: true });
  } catch {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      `Failed to create Codex export directory: ${directory}`
    );
  }
}

async function writeExportFiles(
  fs: CodexExportFs,
  input: {
    catalogPath: string;
    configPath: string;
    catalogJson: string;
    configContents: string;
  }
): Promise<void> {
  let previousCatalog: string | undefined;
  if (await pathExists(fs, input.catalogPath)) {
    try {
      previousCatalog = await fs.readFile(input.catalogPath, 'utf8');
    } catch {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        `Failed to read existing Codex catalog: ${input.catalogPath}`
      );
    }
  }

  try {
    await fs.writeFile(input.catalogPath, input.catalogJson, 'utf8');
  } catch {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      `Failed to write Codex catalog: ${input.catalogPath}`
    );
  }

  try {
    await fs.writeFile(input.configPath, input.configContents, 'utf8');
  } catch {
    try {
      if (previousCatalog === undefined) {
        await fs.rm(input.catalogPath);
      } else {
        await fs.writeFile(input.catalogPath, previousCatalog, 'utf8');
      }
    } catch {
      // Best-effort rollback only; surface the original write failure.
    }

    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      `Failed to write Codex config: ${input.configPath}`
    );
  }
}

export function createCodexExporter(dependencies: {
  getSettingsSnapshot: () => SettingsSnapshot | undefined;
  env?: Record<string, string | undefined>;
  homedir?: () => string;
  fs?: CodexExportFs;
}): CodexExporter {
  const env = dependencies.env ?? process.env;
  const homedir = dependencies.homedir ?? osHomedir;
  const fs =
    dependencies.fs ??
    ({
      mkdir,
      readFile,
      writeFile,
      access,
      rm: (targetPath: string) => rm(targetPath, { force: true })
    } as CodexExportFs);

  return async () => {
    const snapshot = dependencies.getSettingsSnapshot();
    if (!snapshot?.runtime || !isUsableRuntimeSettings(snapshot.runtime)) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        '9router runtime settings are invalid. Check diagnostics for details.'
      );
    }

    if (selectExportModels(snapshot.models).models.length === 0) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        'No publishable models available to export.'
      );
    }

    const destination = await vscode.window.showQuickPick<DestinationQuickPickItem>(
      [
        {
          label: 'Choose folder…',
          description: 'Write 9router-models.json and 9router.config.toml',
          destination: 'folder'
        },
        {
          label: 'Install into Codex home',
          description: 'Write under CODEX_HOME or ~/.codex',
          destination: 'codex-home'
        }
      ],
      {
        title: '9router: Export Codex Config',
        placeHolder: 'Choose where to write Codex files'
      }
    );
    if (!destination) {
      return undefined;
    }

    let directory: string;
    let mode: 'profile' | 'merge' = 'profile';

    if (destination.destination === 'folder') {
      const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Export here'
      });
      const selectedFolder = folders?.[0];
      if (!selectedFolder) {
        return undefined;
      }
      directory = selectedFolder.fsPath;
    } else {
      directory = resolveCodexHome(env, homedir);

      const configTomlPath = path.join(directory, 'config.toml');
      if (await pathExists(fs, configTomlPath)) {
        const choice = await vscode.window.showQuickPick<ModeQuickPickItem>(
          [
            {
              label: 'Create profile',
              description: 'Write 9router.config.toml beside config.toml',
              mode: 'profile'
            },
            {
              label: 'Merge into config.toml',
              description: 'Upsert 9router provider settings into config.toml',
              mode: 'merge'
            }
          ],
          {
            title: '9router: Export Codex Config',
            placeHolder: 'config.toml already exists'
          }
        );
        if (!choice) {
          return undefined;
        }
        mode = choice.mode;

        if (mode === 'merge') {
          const continueMerge = await vscode.window.showWarningMessage(
            'Merging rewrites config.toml and may not preserve comments or formatting.',
            { modal: true },
            'Continue',
            'Cancel'
          );
          if (continueMerge !== 'Continue') {
            return undefined;
          }
        }
      }
    }

    const catalogPath = path.join(directory, '9router-models.json');
    const configPath =
      mode === 'merge'
        ? path.join(directory, 'config.toml')
        : path.join(directory, '9router.config.toml');

    const exportResult = buildCodexExport({
      models: snapshot.models,
      normalizedBaseUrl: snapshot.runtime.baseUrl,
      catalogAbsolutePath: catalogPath
    });

    if (!(await confirmOverwrite(fs, [catalogPath, configPath]))) {
      return undefined;
    }

    let configContents = exportResult.profileToml;
    if (mode === 'merge') {
      let existing: string;
      try {
        existing = await fs.readFile(configPath, 'utf8');
      } catch {
        throw new NineRouterError(
          'CONFIGURATION_ERROR',
          `Failed to read Codex config.toml: ${configPath}`
        );
      }

      try {
        configContents = await mergeCodexConfigToml(existing, {
          defaultModel: exportResult.defaultModel,
          catalogAbsolutePath: catalogPath,
          codexBaseUrl: exportResult.codexBaseUrl
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown merge error';
        throw new NineRouterError('CONFIGURATION_ERROR', detail, {
          ...(error instanceof Error ? { details: { cause: error.message } } : {})
        });
      }
    }

    await ensureDirectory(fs, directory);
    await writeExportFiles(fs, {
      catalogPath,
      configPath,
      catalogJson: exportResult.catalogJson,
      configContents
    });

    const launchHint =
      mode === 'profile'
        ? ' Launch with `codex --profile 9router` after the profile is available under CODEX_HOME.'
        : '';
    await vscode.window.showInformationMessage(
      `Exported Codex config to ${catalogPath} and ${configPath}. Set NINE_ROUTER_API_KEY in your environment before running Codex.${launchHint}`
    );

    if (exportResult.warnings.length > 0) {
      await vscode.window.showWarningMessage(exportResult.warnings.join(' '));
    }

    return {
      mode,
      directory,
      catalogPath,
      configPath,
      warnings: exportResult.warnings
    };
  };
}
