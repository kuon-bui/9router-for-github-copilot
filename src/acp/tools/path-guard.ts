import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

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

  // Symlink escape check if path exists
  if (existsSync(resolvedTarget)) {
    try {
      const realTarget = realpathSync(resolvedTarget);
      const realCwd = existsSync(normalizedCwd) ? realpathSync(normalizedCwd) : normalizedCwd;
      const realRel = relative(realCwd, realTarget);
      const realOutside = isWindows
        ? realRel.startsWith('..') || isAbsolute(realRel) || !realTarget.toLowerCase().startsWith(realCwd.toLowerCase())
        : realRel.startsWith('..') || isAbsolute(realRel);

      if (realOutside) {
        throw new Error(`Symlink target for "${targetPath}" escapes workspace root "${cwd}"`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('escapes workspace')) {
        throw err;
      }
    }
  }

  if (!allowGit) {
    const relParts = rel.split(/[\\/]/);
    if (relParts.includes('.git') || rel === '.git') {
      throw new Error(`Access to protected .git directory is forbidden: "${targetPath}"`);
    }
  }

  return resolvedTarget;
}
