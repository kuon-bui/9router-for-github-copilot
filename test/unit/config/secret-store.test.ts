import { describe, expect, it } from 'vitest';
import { isApiKeyChange } from '@/config/secret-store';

describe('isApiKeyChange', () => {
  it('matches the 9router API key secret', () => {
    expect(isApiKeyChange({ key: '9router.apiKey' })).toBe(true);
  });

  it('ignores other secrets', () => {
    expect(isApiKeyChange({ key: 'other.secret' })).toBe(false);
  });
});
