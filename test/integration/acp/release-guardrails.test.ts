import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ACP Release Guardrails', () => {
  const root = resolve(__dirname, '../../..');

  it('synchronizes root package.json and packages/acp-agent/package.json versions', () => {
    const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };
    const agentPkg = JSON.parse(readFileSync(resolve(root, 'packages/acp-agent/package.json'), 'utf8')) as { version: string };

    expect(agentPkg.version).toBe(rootPkg.version);
  });

  it('verifies extension bundle does not bundle ACP or MCP SDKs', () => {
    const extBundlePath = resolve(root, 'dist/src/extension.js');
    expect(existsSync(extBundlePath)).toBe(true);
    const bundleContent = readFileSync(extBundlePath, 'utf8');

    expect(bundleContent).not.toContain('AgentClientProtocol');
    expect(bundleContent).not.toContain('@agentclientprotocol');
    expect(bundleContent).not.toContain('@modelcontextprotocol');
  });

  it('contributes the 9routerCopilot.setupAcpAgent command in package.json', () => {
    const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      contributes?: { commands?: Array<{ command: string }> };
    };
    const commands = rootPkg.contributes?.commands?.map((c) => c.command) ?? [];
    expect(commands).toContain('9routerCopilot.setupAcpAgent');
  });

  it('has package README and shebang on compiled CLI executable', () => {
    const readmePath = resolve(root, 'packages/acp-agent/README.md');
    expect(existsSync(readmePath)).toBe(true);

    const distPath = resolve(root, 'packages/acp-agent/dist/index.cjs');
    expect(existsSync(distPath)).toBe(true);
    const content = readFileSync(distPath, 'utf8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});
