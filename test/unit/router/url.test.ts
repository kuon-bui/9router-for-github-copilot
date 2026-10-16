import { describe, expect, it } from 'vitest';
import {
  buildModelsUrl,
  buildResponsesUrl,
  buildUsageUrl,
  isHttpBaseUrl,
  normalizeBaseUrl
} from '@/router/url';

describe('router/url', () => {
  it('builds endpoint URLs from base URL', () => {
    expect(buildResponsesUrl('http://127.0.0.1:20128')).toBe('http://127.0.0.1:20128/v1/responses');
    expect(buildModelsUrl('http://127.0.0.1:20128')).toBe('http://127.0.0.1:20128/v1/models');
    expect(buildUsageUrl('http://127.0.0.1:20128')).toBe('http://127.0.0.1:20128/tools/quotas');
  });

  it('normalizes the router base url to an unversioned root', () => {
    expect(normalizeBaseUrl('https://router.example.com/v1/')).toBe('https://router.example.com');
    expect(normalizeBaseUrl('https://router.example.com/v1')).toBe('https://router.example.com');
    expect(normalizeBaseUrl('http://127.0.0.1:20128/')).toBe('http://127.0.0.1:20128');
    expect(normalizeBaseUrl('  http://127.0.0.1:20128  ')).toBe('http://127.0.0.1:20128');
  });

  it('checks for valid http/https URLs', () => {
    expect(isHttpBaseUrl('http://127.0.0.1:20128')).toBe(true);
    expect(isHttpBaseUrl('https://router.example.com')).toBe(true);
    expect(isHttpBaseUrl('ftp://router.example.com')).toBe(false);
    expect(isHttpBaseUrl('not-a-url')).toBe(false);
    expect(isHttpBaseUrl('')).toBe(false);
  });
});
