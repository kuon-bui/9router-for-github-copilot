import { readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import picomatch from 'picomatch';
import { assertPathWithinCwd } from './path-guard';
import { MAX_FILE_MUTATION_BYTES, MAX_SEARCH_FILES, MAX_SEARCH_MATCHES } from './output-limits';
import type { WorkspaceFs } from './workspace-fs';
import type { ToolResult } from './read-file';

export interface SearchFilesInput {
  query: string;
  regex?: boolean;
  glob?: string;
  path?: string;
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

function isBinary(buffer: Buffer): boolean {
  for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

export async function executeSearchFiles(
  input: SearchFilesInput,
  _fs: WorkspaceFs,
  cwd: string
): Promise<ToolResult> {
  const targetDir = assertPathWithinCwd(input.path ?? '.', cwd, true);
  const matcher = input.glob ? picomatch(input.glob) : null;

  let pattern: RegExp;
  try {
    pattern = input.regex
      ? new RegExp(input.query, 'i')
      : new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  } catch (err) {
    return {
      ok: false,
      output: `Invalid search pattern: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  let scannedFiles = 0;
  const matches: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (scannedFiles >= MAX_SEARCH_FILES || matches.length >= MAX_SEARCH_MATCHES) {
      return;
    }

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (scannedFiles >= MAX_SEARCH_FILES || matches.length >= MAX_SEARCH_MATCHES) {
        break;
      }
      if (DEFAULT_IGNORED_DIRS.has(name)) {
        continue;
      }

      const fullPath = resolve(dir, name);
      let fileStat;
      try {
        fileStat = await stat(fullPath);
      } catch {
        continue;
      }

      if (fileStat.isDirectory()) {
        await walk(fullPath);
      } else if (fileStat.isFile()) {
        scannedFiles++;
        const relPath = relative(targetDir, fullPath).replace(/\\/g, '/');
        if (matcher && !matcher(relPath)) {
          continue;
        }

        if (fileStat.size > MAX_FILE_MUTATION_BYTES) {
          continue;
        }

        let buffer: Buffer;
        try {
          buffer = await readFile(fullPath);
        } catch {
          continue;
        }

        if (isBinary(buffer)) {
          continue;
        }

        const lines = buffer.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (pattern.test(line)) {
            matches.push(`${relPath}:${i + 1}: ${line}`);
            if (matches.length >= MAX_SEARCH_MATCHES) {
              break;
            }
          }
        }
      }
    }
  }

  try {
    await walk(targetDir);
    const output = matches.join('\n');
    return {
      ok: true,
      output: output.length > 0 ? output : 'No matches found.'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output: `Error searching files: ${message}`
    };
  }
}
