import { describe, expect, it } from 'vitest';
import {
  parseRouterModels,
  parseVisionModels,
  toVisionModels
} from '@/router/model-catalog';

describe('parseRouterModels', () => {
  it('validates context metadata while retaining catalog models without capabilities', () => {
    expect(
      parseRouterModels({
        object: 'list',
        data: [
          {
            id: 'cx/gpt-5.6-sol',
            owned_by: 'cx',
            capabilities: {
              vision: true,
              contextWindow: 400_000,
              maxOutput: 128_000
            }
          },
          { id: 'router/combo' },
          {
            id: 'partial/model',
            capabilities: {
              contextWindow: 64_000,
              maxOutput: 0
            }
          },
          {
            id: 'invalid/model',
            capabilities: {
              contextWindow: 1.5,
              maxOutput: '8192'
            }
          },
          { id: '', capabilities: { contextWindow: 32_000 } },
          null
        ]
      })
    ).toEqual([
      {
        id: 'cx/gpt-5.6-sol',
        ownedBy: 'cx',
        vision: true,
        contextWindow: 400_000,
        maxOutput: 128_000
      },
      { id: 'invalid/model' },
      { id: 'partial/model', contextWindow: 64_000 },
      { id: 'router/combo' }
    ]);
  });

  it('merges duplicate ids without replacing earlier valid metadata', () => {
    expect(
      parseRouterModels({
        data: [
          { id: 'router/model', capabilities: { contextWindow: 128_000 } },
          {
            id: 'router/model',
            owned_by: 'router',
            capabilities: { vision: true, contextWindow: 64_000, maxOutput: 8_192 }
          }
        ]
      })
    ).toEqual([
      {
        id: 'router/model',
        ownedBy: 'router',
        vision: true,
        contextWindow: 128_000,
        maxOutput: 8_192
      }
    ]);
  });

  it('preserves model ids exactly for exact configured model matching', () => {
    expect(
      parseRouterModels({
        data: [
          {
            id: ' router/model ',
            capabilities: { contextWindow: 128_000, maxOutput: 8_192 }
          }
        ]
      })
    ).toEqual([
      {
        id: ' router/model ',
        contextWindow: 128_000,
        maxOutput: 8_192
      }
    ]);
  });

  it.each([null, {}, { data: null }, { data: {} }])(
    'rejects malformed general catalog root %j',
    (payload) => {
      expect(() => parseRouterModels(payload)).toThrowError(
        expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' })
      );
    }
  );

  it('derives the Vision view from validated general metadata', () => {
    expect(
      toVisionModels([
        { id: 'router/text' },
        { id: 'router/vision', ownedBy: 'router', vision: true }
      ])
    ).toEqual([{ id: 'router/vision', ownedBy: 'router' }]);
  });
});

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

  it('preserves ownedBy metadata across duplicate ids', () => {
    expect(
      parseVisionModels({
        object: 'list',
        data: [
          { id: 'router/first', owned_by: 'team-first', capabilities: { vision: true } },
          { id: 'router/first', capabilities: { vision: true } },
          { id: 'router/second', capabilities: { vision: true } },
          { id: 'router/second', owned_by: 'team-second', capabilities: { vision: true } }
        ]
      })
    ).toEqual([
      { id: 'router/first', ownedBy: 'team-first' },
      { id: 'router/second', ownedBy: 'team-second' }
    ]);
  });

  it.each([null, {}, { data: null }, { data: {} }])('rejects malformed root %j', (payload) => {
    expect(() => parseVisionModels(payload)).toThrowError(
      expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' })
    );
  });
});
