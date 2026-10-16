import { createHash } from 'node:crypto';

export function sanitizeIdentifier(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export function sanitizeMcpToolName(serverName: string, toolName: string): string {
  const cleanServer = sanitizeIdentifier(serverName);
  const cleanTool = sanitizeIdentifier(toolName);
  const fullName = `mcp__${cleanServer}__${cleanTool}`;

  if (fullName.length <= 64) {
    return fullName;
  }

  const hash = createHash('sha256')
    .update(`${serverName}:${toolName}`)
    .digest('hex')
    .slice(0, 8);

  const prefix = `mcp__${cleanServer}__`.slice(0, 32);
  const toolBudget = 64 - prefix.length - 1 - hash.length;
  const truncatedTool = cleanTool.slice(0, Math.max(1, toolBudget));

  return `${prefix}${truncatedTool}_${hash}`;
}

export function parseMcpToolName(fullName: string): { serverName: string; toolName: string } | null {
  if (!fullName.startsWith('mcp__')) {
    return null;
  }

  const rest = fullName.slice('mcp__'.length);
  const sepIndex = rest.indexOf('__');
  if (sepIndex === -1) {
    return null;
  }

  const serverName = rest.slice(0, sepIndex);
  const toolName = rest.slice(sepIndex + 2);

  if (!serverName || !toolName) {
    return null;
  }

  return { serverName, toolName };
}
