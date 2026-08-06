import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { adaptMessagesToRouterRequest } from '../../../src/provider/request-adapter';
import type { ConfiguredModel } from '../../../src/types/product-model';

function selectedModel(overrides: Partial<ConfiguredModel> = {}): ConfiguredModel {
  return {
    sourceIndex: 0,
    id: 'agent',
    name: 'Agent',
    modelId: '123',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off',
    thinkingEfforts: [],
    maxInputTokens: 128_000,
    maxOutputTokens: 8_192,
    ...overrides
  };
}

describe('adaptMessagesToRouterRequest', () => {
  it('maps the selected display model to the configured model id', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel({
        id: 'daily',
        name: 'Daily',
        modelId: 'combo/daily',
        toolMode: 'off'
      }),
      messages: [{ role: 1, content: 'Say hello' }],
      maxTokens: 256
    });

    expect(request).toMatchObject({
      model: 'combo/daily',
      stream: true,
      stream_options: {
        include_usage: true
      },
      max_tokens: 256,
      messages: [{ role: 'user', content: 'Say hello' }]
    });
    expect(request).not.toHaveProperty('reasoning_effort');
    expect(request).not.toHaveProperty('service_tier');
  });

  it('forwards the configured fast service tier', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel({ service_tier: 'fast' }),
      messages: [{ role: 1, content: 'Say hello' }]
    });

    expect(request.service_tier).toBe('fast');
  });

  it('keeps the model id bare and forwards thinking as reasoning_effort', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel({ thinkingMode: 'high' }),
      messages: [{ role: 1, content: 'Solve this carefully' }]
    });

    expect(request).toMatchObject({
      model: '123',
      reasoning_effort: 'high'
    });
  });

  it('preserves matching assistant tool calls and tool results', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel(),
      messages: [
        {
          role: 2,
          content: [
            new vscode.LanguageModelToolCallPart('call-1', 'lookupUser', {
              id: '42'
            })
          ]
        },
        {
          role: 1,
          content: [
            new vscode.LanguageModelToolResultPart('call-1', [
              new vscode.LanguageModelTextPart('result text')
            ])
          ]
        }
      ]
    });

    expect(request.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'lookupUser',
              arguments: '{"id":"42"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        content: 'result text',
        tool_call_id: 'call-1'
      }
    ]);
  });

  it('serializes tool-call arguments with deterministic key ordering', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel(),
      messages: [
        {
          role: 2,
          content: [
            new vscode.LanguageModelToolCallPart('call-1', 'lookupUser', {
              zebra: 'last',
              alpha: 'first'
            })
          ]
        }
      ]
    });

    expect(request.messages[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'lookupUser',
            arguments: '{"alpha":"first","zebra":"last"}'
          }
        }
      ]
    });
  });

  it('preserves multiple tool calls and results in order', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel(),
      messages: [
        {
          role: 2,
          content: [
            new vscode.LanguageModelToolCallPart('call-1', 'lookupUser', {
              id: '42'
            }),
            new vscode.LanguageModelToolCallPart('call-2', 'lookupTeam', {
              slug: 'core'
            })
          ]
        },
        {
          role: 1,
          content: [
            new vscode.LanguageModelToolResultPart('call-1', [
              new vscode.LanguageModelTextPart('user result')
            ]),
            new vscode.LanguageModelToolResultPart('call-2', [
              new vscode.LanguageModelTextPart('team result')
            ])
          ]
        }
      ]
    });

    expect(request.messages).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'lookupUser',
              arguments: '{"id":"42"}'
            }
          },
          {
            id: 'call-2',
            type: 'function',
            function: {
              name: 'lookupTeam',
              arguments: '{"slug":"core"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        content: 'user result',
        tool_call_id: 'call-1'
      },
      {
        role: 'tool',
        content: 'team result',
        tool_call_id: 'call-2'
      }
    ]);
  });

  it('degrades undocumented numeric roles without tool results to user messages', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel(),
      messages: [
        {
          role: 3,
          content: 'Internal progress-message instructions'
        }
      ]
    });

    expect(request.messages).toEqual([
      {
        role: 'user',
        content: 'Internal progress-message instructions'
      }
    ]);
  });

  it('degrades string tool roles without tool results to user messages', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel(),
      messages: [
        {
          role: 'tool',
          content: 'Internal tool-like instructions'
        }
      ]
    });

    expect(request.messages).toEqual([
      {
        role: 'user',
        content: 'Internal tool-like instructions'
      }
    ]);
  });

  it('does not promote tool result parts with empty call ids', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel(),
      messages: [
        {
          role: 1,
          content: [
            new vscode.LanguageModelToolResultPart('', [
              new vscode.LanguageModelTextPart('orphaned result')
            ])
          ]
        }
      ]
    });

    expect(request.messages[0]).toMatchObject({
      role: 'user'
    });
    expect(request.messages[0]).not.toHaveProperty('tool_call_id');
  });

  it('degrades orphaned tool results to user content', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel(),
      messages: [
        {
          role: 1,
          content: [
            new vscode.LanguageModelToolResultPart('missing-call', [
              new vscode.LanguageModelTextPart('orphaned result')
            ])
          ]
        }
      ]
    });

    expect(request.messages).toEqual([
      {
        role: 'user',
        content: 'orphaned result'
      }
    ]);
  });

  it('does not match tool results across an intervening ordinary message', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel(),
      messages: [
        {
          role: 2,
          content: [
            new vscode.LanguageModelToolCallPart('call-1', 'lookupUser', {
              id: '42'
            })
          ]
        },
        {
          role: 1,
          content: 'Intervening user message'
        },
        {
          role: 1,
          content: [
            new vscode.LanguageModelToolResultPart('call-1', [
              new vscode.LanguageModelTextPart('late result')
            ])
          ]
        }
      ]
    });

    expect(request.messages[2]).toEqual({
      role: 'user',
      content: 'late result'
    });
  });

  it('places ordinary result-message text after matching tool responses', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel(),
      messages: [
        {
          role: 2,
          content: [
            new vscode.LanguageModelToolCallPart('call-1', 'lookupUser', {
              id: '42'
            })
          ]
        },
        {
          role: 1,
          content: [
            new vscode.LanguageModelTextPart('Continue after tool result'),
            new vscode.LanguageModelToolResultPart('call-1', [
              new vscode.LanguageModelTextPart('result text')
            ])
          ]
        }
      ]
    });

    expect(request.messages.slice(1)).toEqual([
      {
        role: 'tool',
        content: 'result text',
        tool_call_id: 'call-1'
      },
      {
        role: 'user',
        content: 'Continue after tool result'
      }
    ]);
  });

  it('adds tools and required tool choice only when the selected model exposes tools', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel({ modelId: 'combo/agent' }),
      messages: [{ role: 1, content: 'Use a tool' }],
      tools: [
        {
          name: 'lookupUser',
          description: 'Look up a user',
          inputSchema: { type: 'object' }
        }
      ],
      hostToolMode: 2
    });

    expect(request.tools).toEqual([
      expect.objectContaining({
        function: expect.objectContaining({ name: 'lookupUser' })
      })
    ]);
    expect(request.tool_choice).toBe('required');
  });

  it('preserves structured multimodal content when the selected model supports native vision', () => {
    const imagePart = {
      mimeType: 'image/png',
      data: new Uint8Array([97, 98, 99])
    };

    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel({
        name: 'Agent Vision',
        modelId: 'combo/agent-vision',
        toolMode: 'off',
        visionMode: 'native'
      }),
      messages: [{ role: 1, content: ['What is in this image?', imagePart] }]
    });

    expect(request.messages[0]?.content).toEqual([
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } }
    ]);
  });

  it('treats hybrid native image parts as images before generic value text', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel({
        name: 'Agent Vision',
        modelId: 'combo/agent-vision',
        toolMode: 'off',
        visionMode: 'native'
      }),
      messages: [
        {
          role: 1,
          content: [
            {
              mimeType: 'image/png',
              data: new Uint8Array([97, 98, 99]),
              value: 'must-not-replace-image'
            }
          ]
        }
      ]
    });

    expect(request.messages[0]?.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } }
    ]);
  });
});
