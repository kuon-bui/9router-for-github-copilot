import { describe, expect, it } from 'vitest';
import {
  createLanguageModelThinkingResponsePart,
  isLanguageModelThinkingPart,
  isLanguageModelThinkingPartAvailable
} from '../../../src/provider/reasoning-part-compat';

describe('reasoning part compatibility', () => {
  it('creates a native thinking part when the runtime supports it', () => {
    const part = createLanguageModelThinkingResponsePart('Inspecting the request');

    expect(part).toMatchObject({ value: 'Inspecting the request' });
    expect(isLanguageModelThinkingPart(part)).toBe(true);
    expect(isLanguageModelThinkingPartAvailable()).toBe(true);
  });

  it('drops reasoning safely when the runtime does not support thinking parts', () => {
    const unsupportedApi = {};

    expect(
      createLanguageModelThinkingResponsePart('must not become visible text', unsupportedApi)
    ).toBeUndefined();
    expect(isLanguageModelThinkingPart({ value: 'must not become visible text' }, unsupportedApi)).toBe(
      false
    );
    expect(isLanguageModelThinkingPartAvailable(unsupportedApi)).toBe(false);
  });
});
