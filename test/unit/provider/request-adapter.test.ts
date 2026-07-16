import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { adaptMessagesToRouterRequest } from '../../../src/provider/request-adapter';

describe('adaptMessagesToRouterRequest', () => {
  it('maps the selected display model to the configured combo id', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: {
        key: 'daily',
        label: 'Daily',
        comboId: 'combo/daily',
        enabled: true,
        toolMode: 'off',
        visionMode: 'off'
      },
      messages: [{ role: 1, content: 'Say hello' }],
      maxTokens: 256
    });

    expect(request).toMatchObject({
      model: 'combo/daily',
      stream: true,
      max_tokens: 256,
      messages: [{ role: 'user', content: 'Say hello' }]
    });
  });

  it('converts VS Code tool result parts into OpenAI-compatible tool messages', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: {
        key: 'agent',
        label: 'Agent',
        comboId: 'combo/agent',
        enabled: true,
        toolMode: 'auto',
        visionMode: 'off'
      },
      messages: [
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
        role: 'tool',
        content: 'result text',
        tool_call_id: 'call-1'
      }
    ]);
  });

  it('adds tools and required tool choice only when the selected model exposes tools', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: {
        key: 'agent',
        label: 'Agent',
        comboId: 'combo/agent',
        enabled: true,
        toolMode: 'auto',
        visionMode: 'off'
      },
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
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,abc123'
      }
    };

    const request = adaptMessagesToRouterRequest({
      selectedModel: {
        key: 'agent',
        label: 'Agent Vision',
        comboId: 'combo/agent-vision',
        enabled: true,
        toolMode: 'off',
        visionMode: 'native'
      },
      messages: [{ role: 1, content: ['What is in this image?', imagePart] }]
    });

    expect(request.messages[0]?.content).toEqual([
      { type: 'text', text: 'What is in this image?' },
      imagePart
    ]);
  });
});
