import { describe, expect, it } from 'vitest';
import { loadAgentSettings } from '@/acp/agent-settings';

describe('loadAgentSettings', () => {
  it('treats missing, empty, or placeholder API keys as undefined', () => {
    expect(loadAgentSettings({}).apiKey).toBeUndefined();
    expect(loadAgentSettings({ NINEROUTER_API_KEY: '' }).apiKey).toBeUndefined();
    expect(loadAgentSettings({ NINEROUTER_API_KEY: '<your-key-here>' }).apiKey).toBeUndefined();
    expect(loadAgentSettings({ NINEROUTER_API_KEY: '  <placeholder>  ' }).apiKey).toBeUndefined();
  });

  it('parses valid API key and trims whitespace', () => {
    expect(loadAgentSettings({ NINEROUTER_API_KEY: '  sk-secret-123  ' }).apiKey).toBe('sk-secret-123');
  });

  it('normalizes base URL and applies default', () => {
    expect(loadAgentSettings({}).baseUrl).toBe('http://127.0.0.1:20128');
    expect(loadAgentSettings({ NINEROUTER_BASE_URL: 'http://localhost:3456/v1/' }).baseUrl).toBe('http://localhost:3456');
    // If invalid url, fall back to default
    expect(loadAgentSettings({ NINEROUTER_BASE_URL: 'not-a-url' }).baseUrl).toBe('http://127.0.0.1:20128');
  });

  it('parses reasoning effort, mode, timeout, debug, and max turn requests', () => {
    const settings = loadAgentSettings({
      NINEROUTER_MODEL: 'gh/gpt-5',
      NINEROUTER_REASONING_EFFORT: 'high',
      NINEROUTER_MODE: 'auto-edit',
      NINEROUTER_TIMEOUT_MS: '60000',
      NINEROUTER_DEBUG: 'verbose',
      NINEROUTER_MAX_TURN_REQUESTS: '100'
    });

    expect(settings.defaultModel).toBe('gh/gpt-5');
    expect(settings.reasoningEffort).toBe('high');
    expect(settings.mode).toBe('auto-edit');
    expect(settings.timeoutMs).toBe(60000);
    expect(settings.debugMode).toBe('verbose');
    expect(settings.maxTurnRequests).toBe(100);
  });

  it('falls back to safe defaults when optional env vars are invalid', () => {
    const settings = loadAgentSettings({
      NINEROUTER_REASONING_EFFORT: 'invalid',
      NINEROUTER_MODE: 'destroy-everything',
      NINEROUTER_TIMEOUT_MS: '-500',
      NINEROUTER_DEBUG: 'ultra',
      NINEROUTER_MAX_TURN_REQUESTS: '999999'
    });

    expect(settings.reasoningEffort).toBe('off');
    expect(settings.mode).toBe('ask');
    expect(settings.timeoutMs).toBe(300000);
    expect(settings.debugMode).toBe('minimal');
    expect(settings.maxTurnRequests).toBe(500); // capped at MAX_ACP_TURN_REQUESTS
  });
});
