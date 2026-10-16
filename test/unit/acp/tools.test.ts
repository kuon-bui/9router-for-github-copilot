import { describe, expect, it } from 'vitest';
import { executeReadFile } from '@/acp/tools/read-file';
import { executeListDirectory } from '@/acp/tools/list-directory';
import { executeSearchFiles } from '@/acp/tools/search-files';
import { executeEditFile } from '@/acp/tools/edit-file';
import { executeWriteFile } from '@/acp/tools/write-file';
import { truncateOutput } from '@/acp/tools/output-limits';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceFs } from '@/acp/tools/workspace-fs';

describe('tools', () => {
  it('truncateOutput preserves head and tail when exceeding max bytes', () => {
    const shortText = 'Hello world';
    expect(truncateOutput(shortText, 50)).toBe('Hello world');

    const longText = 'A'.repeat(100) + 'MIDDLE' + 'B'.repeat(100);
    const truncated = truncateOutput(longText, 50);
    expect(truncated.length).toBeLessThanOrEqual(100);
    expect(truncated).toContain('[... truncated');
    expect(truncated.startsWith('A')).toBe(true);
    expect(truncated.endsWith('B')).toBe(true);
  });

  it('executeReadFile reads content with offset and limit', async () => {
    const fsMock = {
      readText: async () => 'line 1\nline 2\nline 3\nline 4\nline 5',
      writeText: async () => {}
    };

    const res = await executeReadFile({ path: 'test.txt', offset: 2, limit: 2 }, fsMock, 'C:/test');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.output).toBe('line 2\nline 3');
    }
  });

  it('executeEditFile replaces text and returns unified diff', async () => {
    let written = '';
    const fsMock = {
      readText: async () => 'hello world\nsecond line',
      writeText: async (_path: string, content: string) => { written = content; }
    };

    const res = await executeEditFile(
      { path: 'a.txt', old_string: 'world', new_string: 'there' },
      fsMock,
      'C:/test'
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(written).toBe('hello there\nsecond line');
      expect(res.diff).toContain('world');
      expect(res.diff).toContain('there');
    }
  });

  it('executeEditFile returns error when old_string does not match', async () => {
    const fsMock = {
      readText: async () => 'hello world',
      writeText: async () => {}
    };

    const res = await executeEditFile(
      { path: 'a.txt', old_string: 'nonexistent', new_string: 'there' },
      fsMock,
      'C:/test'
    );

    expect(res.ok).toBe(false);
    expect(res.output).toContain('Could not find exact match');
  });

  it('executeWriteFile writes content to disk', async () => {
    let writtenPath = '';
    let writtenContent = '';
    const fsMock = {
      readText: async () => '',
      writeText: async (path: string, content: string) => {
        writtenPath = path;
        writtenContent = content;
      }
    };

    const res = await executeWriteFile(
      { path: 'src/app.ts', content: 'console.log("hello");' },
      fsMock,
      'C:/test'
    );

    expect(res.ok).toBe(true);
    expect(writtenPath.replace(/\\/g, '/')).toContain('src/app.ts');
    expect(writtenContent).toBe('console.log("hello");');
  });

  it('executeListDirectory and executeSearchFiles inspect files in temp workspace', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'acp-tools-test-'));
    try {
      await mkdir(join(tempDir, 'sub'), { recursive: true });
      await writeFile(join(tempDir, 'file1.txt'), 'find me keyword here');
      await writeFile(join(tempDir, 'sub/file2.ts'), 'export const secret = 42;');

      const fs = createWorkspaceFs({ cwd: tempDir });

      // list_directory
      const listRes = await executeListDirectory({ path: '.', depth: 2 }, fs, tempDir);
      expect(listRes.ok).toBe(true);
      if (listRes.ok) {
        expect(listRes.output).toContain('file1.txt');
        expect(listRes.output).toContain('sub/file2.ts');
      }

      // search_files
      const searchRes = await executeSearchFiles({ query: 'keyword' }, fs, tempDir);
      expect(searchRes.ok).toBe(true);
      if (searchRes.ok) {
        expect(searchRes.output).toContain('file1.txt');
        expect(searchRes.output).toContain('find me keyword here');
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
