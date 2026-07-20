import { describe, expect, it } from 'vitest';
import { parseVisionModels } from '../../../src/router/model-catalog';

describe('parseVisionModels', () => {
  it('keeps only explicit boolean Vision capability, deduplicated and sorted', () => {
    expect(
      parseVisionModels({
        object: 'list',
        data: [
          { id: 'z/model', owned_by: 'z', capabilities: { vision: true } },
          { id: 'a/model', owned_by: 'a', capabilities: { vision: true } },
          { id: 'z/model', owned_by: 'z', capabilities: { vision: true } },
          { id: 'no/caps' },
          { id: 'false/vision', capabilities: { vision: false } },
          { id: 'truthy/vision', capabilities: { vision: 1 } },
          { id: '', capabilities: { vision: true } }
        ]
      })
    ).toEqual([
      { id: 'a/model', ownedBy: 'a' },
      { id: 'z/model', ownedBy: 'z' }
    ]);
  });

  it.each([null, {}, { data: null }, { data: {} }])('rejects malformed root %j', (payload) => {
    expect(() => parseVisionModels(payload)).toThrowError(
      expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' })
    );
  });
});