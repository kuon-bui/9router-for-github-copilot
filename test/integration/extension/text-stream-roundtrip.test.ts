import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { NineRouterChatProvider } from '@/provider/provider';
import { NineRouterError } from '@/router/errors';
import { createVisionProxyConfigurator } from '@/runtime/vision-configuration';
import type { RouterChatCompletionRequest } from '@/types/router-contract';
import {
  __createCancellationToken,
  __getOutputLines,
  __resetVscodeState,
  __setConfigurationValues,
  __setQuickPickValues,
  __setSelectedChatModels
} from '@test/support/vscode';

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

  it('surfaces primary router-error stream events as upstream failures', async () => {
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'router-error', error: 'upstream failed', requestId: 'req-up' };
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
      code: 'UPSTREAM_UNAVAILABLE',
      requestId: 'req-up',
      details: { phase: 'chat-completion' }
    });
  });

  it('fails when the primary response stream ends before completion', async () => {
    const progressCalls: string[] = [];
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'text-delta', text: 'partial' };
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
        {
          report: (part: vscode.LanguageModelResponsePart) => {
            if (part instanceof vscode.LanguageModelTextPart) {
              progressCalls.push(part.value);
            }
          }
        } as vscode.Progress<vscode.LanguageModelResponsePart>,
        __createCancellationToken().value as never
      )
    ).rejects.toMatchObject({
      code: 'MALFORMED_STREAM_ERROR',
      details: { phase: 'chat-completion' }
    });
    expect(progressCalls).toEqual(['partial']);
  });

  it('surfaces malformed primary tool-call arguments as stream failures', async () => {
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          yield {
            type: 'tool-call-delta',
            toolCallIndex: 0,
            toolCallId: 'call-1',
            toolName: 'lookupUser',
            delta: '12'
          };
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
        [{ role: 1, content: 'Call tool' }] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      )
    ).rejects.toMatchObject({
      code: 'MALFORMED_STREAM_ERROR',
      details: { phase: 'tool-call-streaming' }
    });
  });

  it('lets the Copilot picker override the selected model thinking default', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'daily',
          name: 'Daily',
          modelId: 'combo/daily',
          thinkingMode: 'xhigh',
          thinkingEfforts: ['xhigh', 'max']
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
          thinkingMode: 'high',
          thinkingEfforts: ['high']
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

  it('falls back to the model default when the host sends a stale thinking effort', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'daily',
          name: 'Daily',
          modelId: 'combo/daily',
          thinkingMode: 'low',
          thinkingEfforts: ['low', 'medium']
        }
      ],
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5000,
      debugMode: 'minimal'
    });

    let submittedRequest: RouterChatCompletionRequest | undefined;
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
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
      [{ role: 1, content: 'Think' }] as never,
      { modelConfiguration: { reasoningEffort: 'max' } } as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    expect(submittedRequest).toMatchObject({
      model: 'combo/daily',
      reasoning_effort: 'low'
    });
  });

  it('logs configured and effective thinking metadata without dumping host configuration', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'daily',
          name: 'Daily',
          modelId: 'combo/daily',
          thinkingMode: 'low',
          thinkingEfforts: ['low', 'high']
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
          thinkingMode: 'high',
          thinkingEfforts: ['high', 'max']
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

  it('configures missing Vision analyzer and continues the current request', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'router/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxyPrompt: 'Describe image.',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      debugMode: 'minimal'
    });

    const configureVisionProxy = vi.fn().mockResolvedValue({
      source: '9router' as const,
      modelId: 'router/vision'
    });
    const modelsCalled: string[] = [];
    let primaryPayload = '';
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
          modelsCalled.push(input.request.model);
          if (input.request.model === 'router/vision') {
            yield { type: 'text-delta', text: 'configured summary' };
          } else {
            primaryPayload = JSON.stringify(input.request.messages);
            yield { type: 'text-delta', text: 'primary answer' };
          }
          yield { type: 'response-complete' };
        }
      } as never,
      undefined,
      { configureVisionProxy }
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

    expect(configureVisionProxy).toHaveBeenCalledTimes(1);
    expect(modelsCalled).toEqual(['router/vision', 'router/agent']);
    expect(primaryPayload).toContain('configured summary');
    expect(primaryPayload).not.toContain('data:image/png');
  });

  it('blocks the request when guided Vision setup is cancelled', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'router/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxyPrompt: 'Describe image.',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      debugMode: 'minimal'
    });

    const configureVisionProxy = vi.fn().mockResolvedValue(undefined);
    let calls = 0;
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion() {
          calls += 1;
          yield { type: 'response-complete' };
        }
      } as never,
      undefined,
      { configureVisionProxy }
    );

    await expect(
      provider.provideLanguageModelChatResponse(
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
        [{ role: 1, content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }] }] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      )
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      details: expect.objectContaining({ phase: 'vision-configuration' })
    });
    expect(configureVisionProxy).toHaveBeenCalledTimes(1);
    expect(calls).toBe(0);
  });

  it('blocks the request when guided Vision setup fails', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'router/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxyPrompt: 'Describe image.',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      debugMode: 'minimal'
    });

    const configureVisionProxy = vi.fn(async () => {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        'vision setup failed',
        { details: { phase: 'vision-configuration' } }
      );
    });
    let calls = 0;
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion() {
          calls += 1;
          yield { type: 'response-complete' };
        }
      } as never,
      undefined,
      { configureVisionProxy }
    );

    await expect(
      provider.provideLanguageModelChatResponse(
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
        [{ role: 1, content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }] }] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      )
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      details: expect.objectContaining({ phase: 'vision-configuration' })
    });
    expect(configureVisionProxy).toHaveBeenCalledTimes(1);
    expect(calls).toBe(0);
  });

  it('surfaces guided setup discovery failures as safe NineRouterError values', async () => {
    const promptSecret = 'prompt-secret';
    const rawCauseSecret = 'raw-cause-secret';
    const sourceSecret = 'source-secret';

    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'router/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxyPrompt: promptSecret,
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      debugMode: 'minimal'
    });
    __setQuickPickValues([{ label: 'GitHub Copilot', source: 'copilot' }]);

    const originalSelectChatModels = vscode.lm.selectChatModels;
    (
      vscode.lm as unknown as {
        selectChatModels: typeof vscode.lm.selectChatModels;
      }
    ).selectChatModels = async () => {
      throw Object.assign(vscode.LanguageModelError.Blocked(`${rawCauseSecret} ${promptSecret}`), {
        cause: {
          source: sourceSecret
        }
      });
    };

    try {
      const configureVisionProxy = createVisionProxyConfigurator({
        secrets: {
          get: async () => 'token'
        } as never,
        routerClient: {
          listModels: async () => [{ id: 'router/vision', vision: true }]
        } as never,
        getRuntimeSettings: () =>
          ({
            baseUrl: 'https://router.example.com/v1',
            requestTimeoutMs: 5_000,
            debugMode: 'minimal',
            visionProxySource: undefined,
            visionProxyModelId: '',
            visionProxyPrompt: promptSecret
          }) as never
      });

      let calls = 0;
      const provider = new NineRouterChatProvider(
        { secrets: { get: async () => 'token' } } as never,
        {
          async *streamChatCompletion() {
            calls += 1;
            yield { type: 'response-complete' };
          }
        } as never,
        undefined,
        { configureVisionProxy }
      );

      const promise = provider.provideLanguageModelChatResponse(
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
        [{ role: 1, content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }] }] as never,
        {} as never,
        { report: () => undefined } as never,
        __createCancellationToken().value as never
      );

      const failure = await promise.catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(NineRouterError);
      expect(failure).toMatchObject({
        code: 'UPSTREAM_UNAVAILABLE',
        details: {
          phase: 'vision-configuration',
          source: 'copilot'
        }
      });

      const error = failure as NineRouterError;
      const exposed = JSON.stringify({
        message: error.message,
        details: error.details,
        requestId: error.requestId
      });

      for (const forbidden of [promptSecret, rawCauseSecret, sourceSecret]) {
        expect(exposed).not.toContain(forbidden);
      }

      expect(calls).toBe(0);
    } finally {
      (
        vscode.lm as unknown as {
          selectChatModels: typeof vscode.lm.selectChatModels;
        }
      ).selectChatModels = originalSelectChatModels;
    }
  });

  it('uses Copilot Vision source without issuing a secondary 9router Vision request', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'combo/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxySource: 'copilot',
      visionProxyModelId: 'copilot/vision',
      visionProxyPrompt: 'Describe image.',
      baseUrl: 'https://router.example.com/v1',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      debugMode: 'minimal'
    });

    __setSelectedChatModels([
      {
        id: 'copilot/vision',
        name: 'Copilot Vision',
        family: 'gpt-4.1',
        async sendRequest() {
          return {
            text: (async function* () {
              yield 'native summary';
            })()
          };
        }
      }
    ]);

    const modelsCalled: string[] = [];
    let primaryPayload = '';
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
          modelsCalled.push(input.request.model);
          if (input.request.model !== 'combo/agent') {
            throw new Error(`unexpected model: ${input.request.model}`);
          }
          primaryPayload = JSON.stringify(input.request.messages);
          yield { type: 'text-delta', text: 'primary answer' };
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
          content: [
            new vscode.LanguageModelTextPart('Explain this'),
            { mimeType: 'image/png', data: new Uint8Array([1]) }
          ]
        }
      ] as never,
      {} as never,
      { report: () => undefined } as never,
      __createCancellationToken().value as never
    );

    expect(modelsCalled).toEqual(['combo/agent']);
    expect(primaryPayload).toContain('[Vision proxy summary]');
    expect(primaryPayload).toContain('native summary');
    expect(primaryPayload).not.toContain('data:image/png');
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

  it('fails before any router call when Vision setup cannot complete', async () => {
    __setConfigurationValues({
      models: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: 'combo/agent',
          visionMode: 'proxy'
        }
      ],
      visionProxySource: '9router',
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
        phase: 'vision-configuration'
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
    const configureVisionProxy = vi.fn().mockResolvedValue({
      source: '9router' as const,
      modelId: 'combo/fallback'
    });
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
      } as never,
      undefined,
      { configureVisionProxy }
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
    expect(configureVisionProxy).not.toHaveBeenCalled();
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
});
