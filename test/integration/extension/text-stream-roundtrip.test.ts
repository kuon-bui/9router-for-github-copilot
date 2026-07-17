import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { NineRouterChatProvider } from '../../../src/provider/provider';
import { NineRouterError } from '../../../src/router/errors';
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
      displayModels: ['daily'],
      'modelMappings.daily': 'combo/daily',
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
      displayModels: ['daily'],
      'modelMappings.daily': 'combo/daily',
      'thinkingMode.daily': 'xhigh',
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

  it('sends the base combo id when the Copilot picker selects None', async () => {
    __setConfigurationValues({
      displayModels: ['daily'],
      'modelMappings.daily': 'combo/daily',
      'thinkingMode.daily': 'high',
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
      displayModels: ['daily'],
      'modelMappings.daily': 'combo/daily',
      'thinkingMode.daily': 'low',
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

  it('reclassifies missing combo mappings as actionable configuration errors', async () => {
    const provider = new NineRouterChatProvider(
      {
        secrets: {
          get: async () => 'token'
        }
      } as never,
      {
        async *streamChatCompletion() {
          throw new NineRouterError('COMBO_MAPPING_ERROR', '9router combo mapping was not found', {
            requestId: 'req-404',
            details: {
              status: 404,
              responseText: '{"error":"missing combo"}'
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
        '9router combo mapping for display model "daily" was not found. Update 9router-copilot.modelMappings.daily to a valid combo id.',
      details: expect.objectContaining({
        displayModel: 'daily',
        comboId: 'combo/daily',
        settingsKey: '9router-copilot.modelMappings.daily',
        status: 404
      })
    });
  });
});
