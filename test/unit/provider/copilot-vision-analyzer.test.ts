import { describe, expect, it } from 'vitest';
import { CopilotVisionAnalyzer } from '../../../src/provider/copilot-vision-analyzer';
import type { HostChatRequestMessage } from '../../../src/provider/vision-proxy';
import { __createCancellationToken } from '../../support/vscode';

const image = (mimeType: string, byte: number): { mimeType: string; data: Uint8Array } => ({
  mimeType,
  data: new Uint8Array([byte])
});

function createMessage(): HostChatRequestMessage {
  return {
    role: 1,
    content: [{ value: 'local context secret' }, image('image/png', 97)]
  };
}

function createToken() {
  return __createCancellationToken().value as never;
}

async function* chunks(...parts: string[]): AsyncIterable<string> {
  for (const part of parts) {
    yield part;
  }
}

async function expectNoSecretLeak(
  promise: Promise<unknown>,
  secrets: readonly string[]
): Promise<void> {
  const error = await promise.catch((failure) => failure);
  const serialized = JSON.stringify(error);

  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
    if (error instanceof Error) {
      expect(error.message).not.toContain(secret);
    }
  }
}

describe('CopilotVisionAnalyzer', () => {
  it('resolves exact model and sends prompt, text context, and image', async () => {
    const sent: unknown[] = [];
    let selectedToken: unknown;

    const analyzer = new CopilotVisionAnalyzer({
      selectChatModels: async (selector) => {
        expect(selector).toEqual({ vendor: 'copilot', id: 'copilot/vision' });
        return [
          {
            id: 'copilot/vision',
            name: 'Vision',
            family: 'gpt',
            async sendRequest(messages: unknown[], _options: unknown, token: unknown) {
              sent.push(...messages);
              selectedToken = token;
              return { text: chunks('visible text', ' and layout') };
            }
          } as never
        ];
      }
    });

    await expect(
      analyzer.summarize({
        message: createMessage(),
        modelId: 'copilot/vision',
        prompt: 'Describe image.',
        token: createToken()
      })
    ).resolves.toEqual({ summary: 'visible text and layout' });

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent)).toContain('Describe image.');
    expect(JSON.stringify(sent)).toContain('local context secret');
    expect(JSON.stringify(sent)).toContain('image/png');
    expect(selectedToken).toBeDefined();
  });

  it('fails closed when no exact model id match is available', async () => {
    let sendRequestCalled = false;
    const analyzer = new CopilotVisionAnalyzer({
      selectChatModels: async () => [
        {
          id: 'copilot/vision-alt',
          async sendRequest() {
            sendRequestCalled = true;
            return { text: chunks('should never be used') };
          }
        } as never
      ]
    });

    await expect(
      analyzer.summarize({
        message: createMessage(),
        modelId: 'copilot/vision',
        prompt: 'Describe image.',
        token: createToken()
      })
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      details: {
        phase: 'vision-proxy',
        source: 'copilot'
      }
    });
    expect(sendRequestCalled).toBe(false);
  });

  it('rejects an empty native response summary', async () => {
    const analyzer = new CopilotVisionAnalyzer({
      selectChatModels: async () => [
        {
          id: 'copilot/vision',
          async sendRequest() {
            return { text: chunks('   ', '\n') };
          }
        } as never
      ]
    });

    await expect(
      analyzer.summarize({
        message: createMessage(),
        modelId: 'copilot/vision',
        prompt: 'Describe image.',
        token: createToken()
      })
    ).rejects.toMatchObject({
      code: 'MALFORMED_STREAM_ERROR',
      details: {
        phase: 'vision-proxy',
        source: 'copilot'
      }
    });
  });

  it('maps NoPermissions to AUTHENTICATION_ERROR without prompt leakage', async () => {
    const promptSecret = 'prompt-secret';
    const sourceSecret = 'local context secret';
    const analyzer = new CopilotVisionAnalyzer({
      selectChatModels: async () => [
        {
          id: 'copilot/vision',
          async sendRequest() {
            throw Object.assign(new Error(`${promptSecret} ${sourceSecret}`), {
              code: 'NoPermissions'
            });
          }
        } as never
      ]
    });

    const promise = analyzer.summarize({
      message: createMessage(),
      modelId: 'copilot/vision',
      prompt: promptSecret,
      token: createToken()
    });

    await expect(promise).rejects.toMatchObject({
      code: 'AUTHENTICATION_ERROR',
      details: { phase: 'vision-proxy', source: 'copilot' }
    });
    await expectNoSecretLeak(promise, [promptSecret, sourceSecret, 'image/png']);
  });

  it('maps NotFound to CONFIGURATION_ERROR', async () => {
    const analyzer = new CopilotVisionAnalyzer({
      selectChatModels: async () => [
        {
          id: 'copilot/vision',
          async sendRequest() {
            throw Object.assign(new Error('missing'), { code: 'NotFound' });
          }
        } as never
      ]
    });

    await expect(
      analyzer.summarize({
        message: createMessage(),
        modelId: 'copilot/vision',
        prompt: 'Describe image.',
        token: createToken()
      })
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      details: { phase: 'vision-proxy', source: 'copilot' }
    });
  });

  it('maps Blocked to UPSTREAM_UNAVAILABLE', async () => {
    const analyzer = new CopilotVisionAnalyzer({
      selectChatModels: async () => [
        {
          id: 'copilot/vision',
          async sendRequest() {
            throw Object.assign(new Error('blocked'), { code: 'Blocked' });
          }
        } as never
      ]
    });

    await expect(
      analyzer.summarize({
        message: createMessage(),
        modelId: 'copilot/vision',
        prompt: 'Describe image.',
        token: createToken()
      })
    ).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { phase: 'vision-proxy', source: 'copilot' }
    });
  });

  it('maps cancellation to CANCELLATION_ERROR without selecting models', async () => {
    const cancellation = __createCancellationToken();
    cancellation.cancel();
    let selectedModels = false;

    const analyzer = new CopilotVisionAnalyzer({
      selectChatModels: async () => {
        selectedModels = true;
        return [];
      }
    });

    await expect(
      analyzer.summarize({
        message: createMessage(),
        modelId: 'copilot/vision',
        prompt: 'Describe image.',
        token: cancellation.value as never
      })
    ).rejects.toMatchObject({
      code: 'CANCELLATION_ERROR',
      details: { phase: 'vision-proxy', source: 'copilot' }
    });
    expect(selectedModels).toBe(false);
  });

  it('maps stream failures to UPSTREAM_UNAVAILABLE without leaking partial summaries', async () => {
    const promptSecret = 'prompt-secret';
    const partialSummary = 'partial-summary-secret';
    const analyzer = new CopilotVisionAnalyzer({
      selectChatModels: async () => [
        {
          id: 'copilot/vision',
          async sendRequest() {
            return {
              text: (async function* streamWithError(): AsyncIterable<string> {
                yield partialSummary;
                throw new Error('stream-secret');
              })()
            };
          }
        } as never
      ]
    });

    const promise = analyzer.summarize({
      message: createMessage(),
      modelId: 'copilot/vision',
      prompt: promptSecret,
      token: createToken()
    });

    await expect(promise).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { phase: 'vision-proxy', source: 'copilot' }
    });
    await expectNoSecretLeak(promise, [promptSecret, partialSummary, 'stream-secret']);
  });
});
