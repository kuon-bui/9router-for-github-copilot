import { describe, expect, it } from 'vitest';
import { generateAcpSnippet } from '@/runtime/acp-client-snippets';

describe('generateAcpSnippet', () => {
  it('generates valid Zed agent configuration', () => {
    const json = generateAcpSnippet({
      target: 'zed',
      version: '0.15.0',
      baseUrl: 'http://127.0.0.1:20128/v1',
      modelId: 'gh/gpt-5',
      apiKey: '<your-9router-api-key>'
    });

    const parsed = JSON.parse(json) as {
      agent_servers: {
        '9router': {
          type: string;
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      };
    };

    expect(parsed.agent_servers['9router'].type).toBe('custom');
    expect(parsed.agent_servers['9router'].command).toBe('npx');
    expect(parsed.agent_servers['9router'].args).toEqual(['-y', '9router-acp@0.15.0']);
    expect(parsed.agent_servers['9router'].env['NINEROUTER_API_KEY']).toBe('<your-9router-api-key>');
    expect(parsed.agent_servers['9router'].env['NINEROUTER_BASE_URL']).toBe('http://127.0.0.1:20128/v1');
    expect(parsed.agent_servers['9router'].env['NINEROUTER_MODEL']).toBe('gh/gpt-5');
  });

  it('generates valid JetBrains agent configuration', () => {
    const json = generateAcpSnippet({
      target: 'jetbrains',
      version: '0.15.0',
      baseUrl: 'http://127.0.0.1:20128/v1',
      modelId: 'anthropic/claude-3-7-sonnet',
      apiKey: 'sk-real-secret'
    });

    const parsed = JSON.parse(json) as {
      agent_servers: {
        '9router': {
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      };
    };

    expect(parsed.agent_servers['9router'].command).toBe('npx');
    expect(parsed.agent_servers['9router'].args).toEqual(['-y', '9router-acp@0.15.0']);
    expect(parsed.agent_servers['9router'].env['NINEROUTER_API_KEY']).toBe('sk-real-secret');
    expect(parsed.agent_servers['9router'].env['NINEROUTER_MODEL']).toBe('anthropic/claude-3-7-sonnet');
  });

  it('generates valid VS Code ACP Client extension configuration', () => {
    const json = generateAcpSnippet({
      target: 'vscode',
      version: '0.15.0',
      baseUrl: 'http://127.0.0.1:20128/v1',
      apiKey: '<your-9router-api-key>'
    });

    const parsed = JSON.parse(json) as {
      'acp.agents': {
        '9router': {
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      };
    };

    expect(parsed['acp.agents']['9router'].command).toBe('npx');
    expect(parsed['acp.agents']['9router'].env['NINEROUTER_API_KEY']).toBe('<your-9router-api-key>');
    expect(parsed['acp.agents']['9router'].env['NINEROUTER_MODEL']).toBeUndefined();
  });
});
