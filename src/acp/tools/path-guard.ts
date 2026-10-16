import { lstatSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export function isPathWithinCwd(targetPath: string, cwd: string, allowGit = false): boolean {
  try {
    assertPathWithinCwd(targetPath, cwd, allowGit);
    return true;
  } catch {
    return false;
  }
}

export function assertPathWithinCwd(targetPath: string, cwd: string, allowGit = false): string {
  if (!targetPath || !cwd) {
    throw new Error('Path and cwd must be non-empty strings');
  }

  const normalizedCwd = resolve(cwd);
  const resolvedTarget = isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(normalizedCwd, targetPath);

  const isWindows = process.platform === 'win32';
  const rel = relative(normalizedCwd, resolvedTarget);

  const isOutside = isWindows
    ? rel.startsWith('..') || isAbsolute(rel) || !resolvedTarget.toLowerCase().startsWith(normalizedCwd.toLowerCase())
    : rel.startsWith('..') || isAbsolute(rel);

  if (isOutside) {
    throw new Error(`Path "${targetPath}" is outside workspace root "${cwd}"`);
  }

  if (!allowGit) {
    const relParts = rel.split(/[\\/]/);
    if (relParts.some((p) => p.toLowerCase() === '.git') || rel.toLowerCase() === '.git') {
      throw new Error(`Access to protected .git directory is forbidden: "${targetPath}"`);
    }
  }

  // Safely resolve symlinks component by component to prevent broken symlink bypass
  let current = normalizedCwd;
  const parts = rel.split(/[\\/]/).filter(Boolean);
  for (const part of parts) {
    current = resolve(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(current);
        const resolvedTarget = isAbsolute(target) ? resolve(target) : resolve(dirname(current), target);
        assertPathWithinCwd(resolvedTarget, normalizedCwd, allowGit);
        current = resolvedTarget;
      }
    } catch (err) {
      if (err instanceof Error && (err.message.includes('outside workspace') || err.message.includes('forbidden'))) {
        throw err;
      }
      break;
    }
  }

  return resolvedTarget;
}
