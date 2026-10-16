import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceFs, normalizeFsPath } from '@/acp/tools/workspace-fs';

describe('createWorkspaceFs', () => {
  it('reads and writes files using local node:fs when client fs is unavailable', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'acp-fs-test-'));
    try {
      const fs = createWorkspaceFs({ cwd: tempDir });
      const targetFile = join(tempDir, 'sample.txt');

      await fs.writeText(targetFile, 'Hello ACP FS!');
      const content = await fs.readText(targetFile);
      expect(content).toBe('Hello ACP FS!');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('delegates to client fs when client handlers are provided', async () => {
    const key = normalizeFsPath('C:/test/file.txt');
    const mockStore: Record<string, string> = {
      [key]: 'client content'
    };

    const fs = createWorkspaceFs({
      cwd: 'C:/test',
      clientFs: {
        readTextFile: async (path: string) => mockStore[path] ?? '',
        writeTextFile: async (path: string, content: string) => {
          mockStore[path] = content;
        }
      }
    });

    const content = await fs.readText('C:/test/file.txt');
    expect(content).toBe('client content');

    await fs.writeText('C:/test/file.txt', 'updated content');
    expect(mockStore[key]).toBe('updated content');
  });
});
