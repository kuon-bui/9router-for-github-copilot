import { readdir, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { assertPathWithinCwd } from './path-guard';
import { MAX_LIST_DIRECTORY_ENTRIES } from './output-limits';
import type { WorkspaceFs } from './workspace-fs';
import type { ToolResult } from './read-file';

export interface ListDirectoryInput {
  path?: string;
  depth?: number;
}

const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'target',
  '.venv'
]);

export async function executeListDirectory(
  input: ListDirectoryInput,
  _fs: WorkspaceFs,
  cwd: string
): Promise<ToolResult> {
  const targetDir = assertPathWithinCwd(input.path ?? '.', cwd, true);
  const maxDepth = Math.min(Math.max(1, input.depth ?? 2), 5);
  const results: string[] = [];

  async function walk(currentPath: string, currentDepth: number): Promise<void> {
    if (results.length >= MAX_LIST_DIRECTORY_ENTRIES || currentDepth > maxDepth) {
      return;
    }

    let entries: string[];
    try {
      entries = await readdir(currentPath);
    } catch {
      return;
    }

    for (const name of entries) {
      if (results.length >= MAX_LIST_DIRECTORY_ENTRIES) {
        break;
      }
      if (DEFAULT_IGNORED_DIRS.has(name)) {
        continue;
      }

      const fullEntryPath = resolve(currentPath, name);
      let entryStat;
      try {
        entryStat = await stat(fullEntryPath);
      } catch {
        continue;
      }

      const relPath = relative(targetDir, fullEntryPath).replace(/\\/g, '/');
      if (entryStat.isDirectory()) {
        results.push(`${relPath}/`);
        await walk(fullEntryPath, currentDepth + 1);
      } else {
        results.push(relPath);
      }
    }
  }

  try {
    await walk(targetDir, 1);
    const output = results.join('\n');
    return {
      ok: true,
      output: output.length > 0 ? output : '(empty directory)'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output: `Error listing directory "${input.path ?? '.'}": ${message}`
    };
  }
}
