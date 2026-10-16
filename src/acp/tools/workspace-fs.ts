import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export function normalizeFsPath(path: string): string {
  return resolve(path).replace(/\\/g, '/');
}

export interface ClientFsDelegate {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
}

export interface WorkspaceFsOptions {
  cwd: string;
  clientFs?: ClientFsDelegate | undefined;
}

export interface WorkspaceFs {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
}

export function createWorkspaceFs(options: WorkspaceFsOptions): WorkspaceFs {
  const { cwd, clientFs } = options;

  return {
    async readText(path: string): Promise<string> {
      const fullPath = resolve(cwd, path);
      if (clientFs) {
        try {
          return await clientFs.readTextFile(normalizeFsPath(fullPath));
        } catch {
          // Fall back to node:fs
        }
      }
      return readFile(fullPath, 'utf8');
    },

    async writeText(path: string, content: string): Promise<void> {
      const fullPath = resolve(cwd, path);
      if (clientFs) {
        try {
          await clientFs.writeTextFile(normalizeFsPath(fullPath), content);
          return;
        } catch {
          // Fall back to node:fs
        }
      }
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
    }
  };
}
