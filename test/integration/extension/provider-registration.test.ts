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

  it('declares inline suggestion configuration', () => {
    expect(manifest.contributes.configuration.properties).toMatchObject({
      '9router-copilot.inline.enabled': expect.objectContaining({ default: false }),
      '9router-copilot.inline.modelId': expect.objectContaining({ default: '' }),
      '9router-copilot.inline.maxTokens': expect.objectContaining({ default: 128 }),
      '9router-copilot.inline.languages': expect.objectContaining({
        default: expect.arrayContaining(['typescript', 'python'])
      })
    });
  });
});
