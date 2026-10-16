import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { assertPathWithinCwd, isPathWithinCwd } from '@/acp/tools/path-guard';

describe('path-guard', () => {
  const cwd = resolve('C:/test/workspace');

  it('allows paths inside workspace', () => {
    const inside = resolve(cwd, 'src/index.ts');
    expect(isPathWithinCwd(inside, cwd)).toBe(true);
    expect(assertPathWithinCwd('src/index.ts', cwd)).toBe(inside);
  });

  it('rejects paths outside workspace', () => {
    const outside = resolve('C:/test/other/secret.txt');
    expect(isPathWithinCwd(outside, cwd)).toBe(false);
    expect(() => assertPathWithinCwd('../other/secret.txt', cwd)).toThrow(/outside workspace/i);
  });

  it('rejects paths targeting .git directory by default', () => {
    expect(() => assertPathWithinCwd('.git/config', cwd, false)).toThrow(/protected \.git directory/i);
    expect(() => assertPathWithinCwd('.git', cwd, false)).toThrow(/protected \.git directory/i);
  });

  it('allows .git when explicitly allowed (e.g. for read operations)', () => {
    const gitPath = resolve(cwd, '.git/HEAD');
    expect(assertPathWithinCwd('.git/HEAD', cwd, true)).toBe(gitPath);
  });

  it('handles case-insensitivity on Windows', () => {
    const mixedCase = resolve('c:/TEST/workspace/sub/file.txt');
    expect(isPathWithinCwd(mixedCase, cwd)).toBe(true);
  });
});
