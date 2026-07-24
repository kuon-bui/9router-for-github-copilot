import { describe, expect, it } from 'vitest';
import {
  adaptToolOptionsForRouter,
  adaptToolsToRouterDefinitions,
  shouldExposeTools
} from '../../../src/provider/tool-adapter';
import type { ConfiguredModel } from '../../../src/types/product-model';

function selectedModel(overrides: Partial<ConfiguredModel> = {}): ConfiguredModel {
  return {
    sourceIndex: 0,
    id: 'agent',
    name: 'Agent',
    modelId: 'combo/agent',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off',
    thinkingEfforts: [],
    maxInputTokens: 128_000,
    maxOutputTokens: 8_192,
    ...overrides
  };
}

describe('shouldExposeTools', () => {
  it('enables tools only when the display model is explicitly configured for them', () => {
    expect(shouldExposeTools(selectedModel())).toBe(true);
  });
});

describe('adaptToolsToRouterDefinitions', () => {
  it('converts host tools into OpenAI-compatible function definitions', () => {
    expect(
      adaptToolsToRouterDefinitions([
        {
          name: 'lookupUser',
          description: 'Look up a user',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' }
            }
          }
        }
      ])
    ).toEqual([
      {
        type: 'function',
        function: {
          name: 'lookupUser',
          description: 'Look up a user',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string' }
            }
          }
        }
      }
    ]);
  });

  it('uses an empty object schema when a VS Code tool omits inputSchema', () => {
    expect(
      adaptToolsToRouterDefinitions([
        {
          name: 'listFiles',
          description: 'List files'
        }
      ])
    ).toEqual([
      {
        type: 'function',
        function: {
          name: 'listFiles',
          description: 'List files',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      }
    ]);
  });
});

describe('adaptToolOptionsForRouter', () => {
  it('drops malformed tools while preserving valid tools', () => {
    const result = adaptToolOptionsForRouter({
      selectedModel: selectedModel(),
      tools: [
        {
          name: 'lookupUser',
          description: 'Look up a user',
          inputSchema: { type: 'object' }
        },
        {
          name: '',
          description: 'Broken',
          inputSchema: { type: 'object' }
        }
      ],
      hostToolMode: 2
    });

    expect(result.definitions).toHaveLength(1);
    expect(result.toolChoice).toBe('required');
    expect(result.rejectedTools).toEqual([
      expect.objectContaining({ code: 'INVALID_TOOL_NAME' })
    ]);
  });

  it('does not expose tools when the selected display model has toolMode off', () => {
    const result = adaptToolOptionsForRouter({
      selectedModel: selectedModel({
        id: 'daily',
        name: 'Daily',
        modelId: 'combo/daily',
        toolMode: 'off'
      }),
      tools: [
        {
          name: 'lookupUser',
          description: 'Look up a user',
          inputSchema: { type: 'object' }
        }
      ],
      hostToolMode: 1
    });

    expect(result.definitions).toEqual([]);
    expect(result.toolChoice).toBeUndefined();
    expect(result.rejectedTools).toEqual([
      expect.objectContaining({ code: 'MODEL_TOOLS_DISABLED' })
    ]);
  });
});
