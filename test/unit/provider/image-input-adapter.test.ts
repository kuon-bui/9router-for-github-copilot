import { describe, expect, it } from 'vitest';
import {
  countImageParts,
  createRouterImagePart,
  hasImageParts,
  isHostImageDataPart
} from '@/provider/image-input-adapter';

describe('image-input-adapter', () => {
  const png = { mimeType: 'image/png', data: new Uint8Array([0, 1, 2, 255]) };

  it('recognizes only complete image data parts', () => {
    expect(isHostImageDataPart(png)).toBe(true);
    expect(isHostImageDataPart({ mimeType: 'image/png' })).toBe(false);
    expect(
      isHostImageDataPart({
        mimeType: 'application/json',
        data: new Uint8Array([1])
      })
    ).toBe(false);
    expect(isHostImageDataPart({ callId: 'call-1', name: 'tool', input: {} })).toBe(false);
  });

  it('creates an OpenAI-compatible image_url part', () => {
    expect(createRouterImagePart(png)).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAEC/w==' }
    });
  });

  it('counts images without misclassifying text or tools', () => {
    const content = [
      { value: 'inspect this' },
      png,
      { mimeType: 'image/jpeg', data: new Uint8Array([3]) },
      { callId: 'call-1', name: 'tool', input: {} }
    ];
    expect(hasImageParts(content)).toBe(true);
    expect(countImageParts(content)).toBe(2);
    expect(hasImageParts('plain text')).toBe(false);
  });
});
