import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { adaptMessagesToRouterRequest } from '@/provider/request-adapter';
import type { ConfiguredModel } from '@/types/product-model';

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
      store: false,
      max_output_tokens: 256,
      input: [{ role: 'user', content: 'Say hello' }]
    });
    expect(request).not.toHaveProperty('reasoning');
    expect(request).not.toHaveProperty('serviceTier');
  });

  it('forwards the configured fast service tier', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel({ serviceTier: 'fast' }),
      messages: [{ role: 1, content: 'Say hello' }]
    });

    expect(request.service_tier).toBe('fast');
  });

  it('keeps the model id bare and forwards thinking through Responses reasoning', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: selectedModel({ thinkingMode: 'high' }),
      messages: [{ role: 1, content: 'Solve this carefully' }]
    });

    expect(request).toMatchObject({
      model: '123',
      reasoning: {
        effort: 'high',
        summary: 'auto'
      }
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

    expect(request.input).toEqual([
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'lookupUser',
        arguments: '{"id":"42"}'
      },
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'result text'
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

    expect(request.input[0]).toEqual({
      type: 'function_call',
      call_id: 'call-1',
      name: 'lookupUser',
      arguments: '{"alpha":"first","zebra":"last"}'
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

    expect(request.input).toEqual([
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'lookupUser',
        arguments: '{"id":"42"}'
      },
      {
        type: 'function_call',
        call_id: 'call-2',
        name: 'lookupTeam',
        arguments: '{"slug":"core"}'
      },
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'user result'
      },
      {
        type: 'function_call_output',
        call_id: 'call-2',
        output: 'team result'
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

    expect(request.input).toEqual([
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

    expect(request.input).toEqual([
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

    expect(request.input[0]).toMatchObject({
      role: 'user'
    });
    expect(request.input[0]).not.toHaveProperty('call_id');
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

    expect(request.input).toEqual([
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

    expect(request.input[2]).toEqual({
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

    expect(request.input.slice(1)).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'result text'
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
        name: 'lookupUser',
        strict: false
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

    expect(request.input[0]).toMatchObject({
      content: [
        { type: 'input_text', text: 'What is in this image?' },
        { type: 'input_image', image_url: 'data:image/png;base64,YWJj' }
      ]
    });
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

    expect(request.input[0]).toMatchObject({
      content: [{ type: 'input_image', image_url: 'data:image/png;base64,YWJj' }]
    });
  });
});
