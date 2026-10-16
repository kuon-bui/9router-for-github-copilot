import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ACP Agent Bundle Spike', () => {
  it('has package manifest and bundled executable with shebang', () => {
    const pkgPath = resolve(__dirname, '../../../packages/acp-agent/package.json');
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(pkg.name).toBe('9router-acp');
    expect(pkg.bin['9router-acp']).toBe('./dist/index.cjs');

    const distPath = resolve(__dirname, '../../../packages/acp-agent/dist/index.cjs');
    expect(existsSync(distPath)).toBe(true);
    const distContent = readFileSync(distPath, 'utf8');
    expect(distContent.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('responds to initialize request over stdio', async () => {
    const { spawn } = await import('node:child_process');
    const distPath = resolve(__dirname, '../../../packages/acp-agent/dist/index.cjs');

    const proc = spawn(process.execPath, [distPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    }) + '\n';

    let stdoutData = '';
    proc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf8');
    });

    proc.stdin.write(initRequest);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error(`Timeout waiting for response. Output so far: ${stdoutData}`));
      }, 5000);

      proc.stdout.on('data', () => {
        if (stdoutData.includes('\n')) {
          clearTimeout(timeout);
          proc.kill();
          resolve();
        }
      });
    });

    const line = stdoutData.trim().split('\n')[0];
    expect(line).toBeDefined();
    const response = JSON.parse(line!);
    expect(response.id).toBe(1);
    expect(response.result.protocolVersion).toBe(1);
    expect(response.result.agentInfo.name).toBe('9router-acp');
  });
});
