import { existsSync, realpathSync } from 'node:fs';
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

  // Symlink escape check for path or nearest existing ancestor
  if (existsSync(normalizedCwd)) {
    let ancestorToCheck = resolvedTarget;
    while (!existsSync(ancestorToCheck)) {
      const parent = dirname(ancestorToCheck);
      if (parent === ancestorToCheck || parent.length <= normalizedCwd.length) {
        break;
      }
      ancestorToCheck = parent;
    }

    if (existsSync(ancestorToCheck)) {
      try {
        const realAncestor = realpathSync(ancestorToCheck);
        const realCwd = realpathSync(normalizedCwd);
        const realRel = relative(realCwd, realAncestor);
        const realOutside = isWindows
          ? realRel.startsWith('..') || isAbsolute(realRel) || !realAncestor.toLowerCase().startsWith(realCwd.toLowerCase())
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
  }

  return resolvedTarget;
}
