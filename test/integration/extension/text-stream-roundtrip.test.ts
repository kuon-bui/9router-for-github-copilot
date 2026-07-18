import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { NineRouterChatProvider } from '../../../src/provider/provider';
import { NineRouterError } from '../../../src/router/errors';
import type { RouterChatCompletionRequest } from '../../../src/types/router-contract';
import {
  __createCancellationToken,
  __getOutputLines,
  __resetVscodeState,
  __setConfigurationValues
} from '../../support/vscode';

describe('NineRouterChatProvider', () => {
  beforeEach(() => {
    __resetVscodeState();
    __setConfigurationValues({
      models: [{ id: 'daily', name: 'Daily', modelId: 'combo/daily' }],
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });
  });

  it('streams text deltas from 9router into VS Code response parts', async () => {
    const progressCalls: string[] = [];
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'text-delta', text: 'Hello' };
          yield { type: 'text-delta', text: ' world' };
          yield { type: 'response-complete' };
        }
      } as never
    );

    await provider.provideLanguageModelChatResponse(
      {
        id: 'daily',
        name: 'Daily',
        vendor: '9router',
        family: 'daily',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: {}
      },
      [{ role: 1, content: 'Say hello' }] as never,
      {} as never,
      {
        report: (part: vscode.LanguageModelResponsePart) => {
          if (part instanceof vscode.LanguageModelTextPart) {
            progressCalls.push(part.value);
          }
        }
      } as vscode.Progress<vscode.LanguageModelResponsePart>,
      __createCancellationToken().value as never
    );

    expect(progressCalls.join('')).toBe('Hello world');
  });

  it('lets the Copilot picker override the selected model thinking default', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'daily',
          name: 'Daily',
          modelId: 'combo/daily',
          thinkingMode: 'xhigh'
        }
      ],
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });

    let submittedRequest:
      | { model: string; reasoning_effort?: string }
      | undefined;
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion(input: {
          request: { model: string; reasoning_effort?: string };
        }) {
          submittedRequest = input.request;
          yield { type: 'response-complete' };
        }
      } as never
    );

    await provider.provideLanguageModelChatResponse(
      {
        id: 'daily',
        name: 'Daily',
        vendor: '9router',
        family: 'daily',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: {}
      },
      [{ role: 1, content: 'Think deeply' }] as never,
      {
        modelConfiguration: {
          reasoningEffort: 'max'
        }
      } as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    expect(submittedRequest).toMatchObject({
      model: 'combo/daily',
      reasoning_effort: 'max'
    });
  });

  it('sends the base model id when the Copilot picker selects None', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'daily',
          name: 'Daily',
          modelId: 'combo/daily',
          thinkingMode: 'high'
        }
      ],
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });

    let submittedModel: string | undefined;
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion(input: { request: { model: string } }) {
          submittedModel = input.request.model;
          yield { type: 'response-complete' };
        }
      } as never
    );

    await provider.provideLanguageModelChatResponse(
      {
        id: 'daily',
        name: 'Daily',
        vendor: '9router',
        family: 'daily',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: {}
      },
      [{ role: 1, content: 'Answer quickly' }] as never,
      {
        modelConfiguration: {
          reasoningEffort: 'none'
        }
      } as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    expect(submittedModel).toBe('combo/daily');
  });

  it('logs configured and effective thinking metadata without dumping host configuration', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'daily',
          name: 'Daily',
          modelId: 'combo/daily',
          thinkingMode: 'low'
        }
      ],
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'metadata'
    });

    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'response-complete' };
        }
      } as never
    );

    await provider.provideLanguageModelChatResponse(
      {
        id: 'daily',
        name: 'Daily',
        vendor: '9router',
        family: 'daily',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: {}
      },
      [{ role: 1, content: 'Think' }] as never,
      {
        modelConfiguration: {
          reasoningEffort: 'high',
          unrelatedSensitiveValue: 'do-not-log'
        }
      } as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    const submissionLine = __getOutputLines().find((line) =>
      line.startsWith('Submitting request to 9router')
    );

    expect(submissionLine).toContain('"configuredThinkingMode":"low"');
    expect(submissionLine).toContain('"effectiveThinkingMode":"high"');
    expect(submissionLine).toContain('"thinkingModeSource":"modelConfiguration"');
    expect(submissionLine).not.toContain('do-not-log');
  });

  it('blocks image inputs when the selected model is configured as vision off', async () => {
    let streamCalled = false;
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          streamCalled = true;
          yield { type: 'response-complete' };
        }
      } as never
    );

    await expect(
      provider.provideLanguageModelChatResponse(
        {
          id: 'daily',
          name: 'Daily',
          vendor: '9router',
          family: 'daily',
          version: '1',
          maxInputTokens: 128000,
          maxOutputTokens: 8192,
          capabilities: {}
        },
        [
          {
            role: 1,
            content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }]
          }
        ] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      )
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      details: expect.objectContaining({
        visionOutcome: 'vision-blocked'
      })
    });

    expect(streamCalled).toBe(false);
  });

  it('summarizes images before calling the selected model', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'combo/agent',
          toolMode: 'auto',
          visionMode: 'proxy',
          thinkingMode: 'high'
        }
      ],
      visionProxyModelId: 'combo/vision',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'metadata'
    });

    const calls: Array<{
      request: RouterChatCompletionRequest;
      signal: AbortSignal;
    }> = [];
    const visible: string[] = [];
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion(input: {
          request: RouterChatCompletionRequest;
          signal: AbortSignal;
        }) {
          calls.push(input);
          if (input.request.model === 'combo/vision') {
            yield { type: 'text-delta', text: 'A diagram with A pointing to B.' };
            yield { type: 'response-complete', requestId: 'vision-req' };
            return;
          }
          yield { type: 'text-delta', text: 'Primary answer' };
          yield { type: 'response-complete', requestId: 'primary-req' };
        }
      } as never
    );

    await provider.provideLanguageModelChatResponse(
      {
        id: 'agent',
        name: 'Agent',
        vendor: '9router',
        family: 'agent',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: { imageInput: true }
      },
      [
        {
          role: 1,
          content: [
            new vscode.LanguageModelTextPart('Explain this'),
            { mimeType: 'image/png', data: new Uint8Array([97]) }
          ]
        }
      ] as never,
      {
        modelConfiguration: { reasoningEffort: 'max' },
        tools: [{
          name: 'inspectDiagram',
          description: 'Inspect a diagram element',
          inputSchema: {
            type: 'object',
            properties: { element: { type: 'string' } },
            required: ['element']
          }
        }],
        toolMode: 2
      } as never,
      {
        report: (part: vscode.LanguageModelResponsePart) => {
          if (part instanceof vscode.LanguageModelTextPart) visible.push(part.value);
        }
      } as never,
      __createCancellationToken().value as never
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.request.max_tokens).toBe(128);
    expect(calls[1]?.request.max_tokens).toBe(128);
    expect(calls[0]?.request.model).toBe('combo/vision');
    expect(calls[0]?.request).not.toHaveProperty('reasoning_effort');
    expect(calls[0]?.request).not.toHaveProperty('tools');
    expect(calls[0]?.request).not.toHaveProperty('tool_choice');
    expect(calls[1]?.request).toMatchObject({
      model: 'combo/agent',
      reasoning_effort: 'max',
      tools: [{
        type: 'function',
        function: {
          name: 'inspectDiagram',
          description: 'Inspect a diagram element',
          parameters: {
            type: 'object',
            properties: { element: { type: 'string' } },
            required: ['element']
          }
        }
      }],
      tool_choice: 'required'
    });
    expect(calls[0]?.signal).toBe(calls[1]?.signal);
    expect(JSON.stringify(calls[1]?.request.messages)).toContain('[Vision proxy summary]');
    expect(JSON.stringify(calls[1]?.request.messages)).not.toContain('data:image/png');
    expect(visible).toEqual(['Primary answer']);
  });

  it('omits max_tokens from Vision and primary requests when maxTokens is zero', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'router/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxyModelId: 'router/vision',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 0,
      requestTimeoutMs: 5_000,
      debugMode: 'minimal'
    });

    const requests: RouterChatCompletionRequest[] = [];
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
          requests.push(input.request);
          if (input.request.model === 'router/vision') {
            yield { type: 'text-delta', text: 'safe image summary' };
          }
          yield { type: 'response-complete' };
        }
      } as never
    );

    await provider.provideLanguageModelChatResponse(
      {
        id: 'agent',
        name: 'Agent',
        vendor: '9router',
        family: 'agent',
        version: '1',
        maxInputTokens: 128_000,
        maxOutputTokens: 8_192,
        capabilities: { imageInput: true }
      },
      [
        {
          role: 1,
          content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }]
        }
      ] as never,
      {} as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    expect(requests.map((request) => request.model)).toEqual([
      'router/vision',
      'router/agent'
    ]);
    expect(requests[0]).not.toHaveProperty('max_tokens');
    expect(requests[1]).not.toHaveProperty('max_tokens');
  });

  it('fails closed before the primary call when the Vision stream is truncated', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'combo/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxyModelId: 'combo/vision',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });
    const modelsCalled: string[] = [];
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
          modelsCalled.push(input.request.model);
          yield { type: 'text-delta', text: 'partial-summary-secret' };
        }
      } as never
    );

    const promise = provider.provideLanguageModelChatResponse(
      {
        id: 'agent',
        name: 'Agent',
        vendor: '9router',
        family: 'agent',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: { imageInput: true }
      },
      [{ role: 1, content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }] }] as never,
      {} as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    await expect(promise).rejects.toMatchObject({
      code: 'MALFORMED_STREAM_ERROR',
      details: { phase: 'vision-proxy' }
    });
    expect(modelsCalled).toEqual(['combo/vision']);
  });

  it('fails before any router call when the shared Vision model is empty', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'combo/agent',
          visionMode: 'proxy'
        }
      ],
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });
    let calls = 0;
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion() {
          calls += 1;
          yield { type: 'response-complete' };
        }
      } as never
    );

    await expect(
      provider.provideLanguageModelChatResponse(
        {
          id: 'agent',
          name: 'Agent',
          vendor: '9router',
          family: 'agent',
          version: '1',
          maxInputTokens: 128000,
          maxOutputTokens: 8192,
          capabilities: {}
        },
        [{ role: 1, content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }] }] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      )
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      details: expect.objectContaining({
        settingsKey: '9router-copilot.visionProxyModelId'
      })
    });
    expect(calls).toBe(0);
  });

  it('fails closed when the shared Vision model mapping is missing', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'combo/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxyModelId: 'combo/vision',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });
    const modelsCalled: string[] = [];
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
          modelsCalled.push(input.request.model);
          throw new NineRouterError('MODEL_MAPPING_ERROR', 'missing', {
            requestId: 'vision-404',
            details: { status: 404, responseText: 'must-not-leak' }
          });
        }
      } as never
    );

    const responsePromise = provider.provideLanguageModelChatResponse(
      {
        id: 'agent',
        name: 'Agent',
        vendor: '9router',
        family: 'agent',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: {}
      },
      [{ role: 1, content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }] }] as never,
      {} as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    await expect(responsePromise).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      requestId: 'vision-404',
      message: expect.stringContaining('9router-copilot.visionProxyModelId'),
      details: {
        phase: 'vision-proxy',
        status: 404,
        settingsKey: '9router-copilot.visionProxyModelId'
      }
    });
    expect(modelsCalled).toEqual(['combo/vision']);
  });

  it('logs only safe Vision metadata', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'combo/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxyModelId: 'combo/vision',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'metadata'
    });
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'api-key-secret' } } as never,
      {
        async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
          if (input.request.model === 'combo/vision') {
            yield { type: 'text-delta', text: 'vision-summary-secret' };
            yield { type: 'response-complete', requestId: 'vision-safe-id' };
            return;
          }
          yield { type: 'response-complete', requestId: 'primary-safe-id' };
        }
      } as never
    );

    await provider.provideLanguageModelChatResponse(
      {
        id: 'agent',
        name: 'Agent',
        vendor: '9router',
        family: 'agent',
        version: '1',
        maxInputTokens: 128000,
        maxOutputTokens: 8192,
        capabilities: {}
      },
      [
        {
          role: 1,
          content: [
            new vscode.LanguageModelTextPart('source-text-secret'),
            { mimeType: 'image/png', data: new Uint8Array([1]) }
          ]
        }
      ] as never,
      {} as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    const output = __getOutputLines().join('\n');
    expect(output).toContain('"imageCount":1');
    expect(output).toContain('"imageMessageCount":1');
    expect(output).toContain('"visionOutcome":"vision-proxied"');
    for (const secret of [
      'source-text-secret',
      'vision-summary-secret',
      'api-key-secret',
      'data:image/png;base64'
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('reclassifies missing model mappings as actionable configuration errors', async () => {
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          throw new NineRouterError('MODEL_MAPPING_ERROR', '9router model mapping was not found', {
            requestId: 'req-404',
            details: {
              status: 404,
              responseText: '{"error":"missing model"}'
            }
          });
        }
      } as never
    );

    await expect(
      provider.provideLanguageModelChatResponse(
        {
          id: 'daily',
          name: 'Daily',
          vendor: '9router',
          family: 'daily',
          version: '1',
          maxInputTokens: 128000,
          maxOutputTokens: 8192,
          capabilities: {}
        },
        [{ role: 1, content: 'Say hello' }] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      )
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      requestId: 'req-404',
      message:
        '9router model mapping for display model "daily" was not found. Update 9router-copilot.models[0].modelId.',
      details: expect.objectContaining({
        displayModel: 'daily',
        modelId: 'combo/daily',
        settingsKey: '9router-copilot.models[0].modelId',
        status: 404
      })
    });
    await expect(
      provider.provideLanguageModelChatResponse(
        {
          id: 'daily',
          name: 'Daily',
          vendor: '9router',
          family: 'daily',
          version: '1',
          maxInputTokens: 128000,
          maxOutputTokens: 8192,
          capabilities: {}
        },
        [{ role: 1, content: 'Say hello' }] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      )
    ).rejects.not.toMatchObject({
      details: expect.objectContaining({ responseText: expect.anything() })
    });
  });

  it('logs safe failure status in minimal mode without model metadata or raw response text', async () => {
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          throw new NineRouterError(
            'UPSTREAM_UNAVAILABLE',
            '9router could not complete upstream execution (HTTP 503).',
            {
              requestId: 'req-private-id',
              details: {
                status: 503,
                responseText: 'private provider failure details'
              }
            }
          );
        }
      } as never
    );

    await expect(
      provider.provideLanguageModelChatResponse(
        {
          id: 'daily',
          name: 'Daily',
          vendor: '9router',
          family: 'daily',
          version: '1',
          maxInputTokens: 128000,
          maxOutputTokens: 8192,
          capabilities: {}
        },
        [{ role: 1, content: 'Say hello' }] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      )
    ).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE'
    });

    const output = __getOutputLines().join('\n');
    expect(output).toContain('9router request failed');
    expect(output).toContain('"errorCode":"UPSTREAM_UNAVAILABLE"');
    expect(output).toContain('"status":503');
    expect(output).not.toContain('combo/daily');
    expect(output).not.toContain('req-private-id');
    expect(output).not.toContain('private provider failure details');
  });
});
