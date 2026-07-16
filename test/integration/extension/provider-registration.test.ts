import manifest from '../../../package.json';
import { describe, expect, it } from 'vitest';

describe('extension manifest', () => {
  it('declares the 9router language model provider contribution', () => {
    expect(manifest.contributes.languageModelChatProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vendor: '9router',
          displayName: '9router'
        })
      ])
    );
  });
});
