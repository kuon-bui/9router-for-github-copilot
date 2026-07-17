import { describe, expect, it } from 'vitest';
import { NineRouterError } from '../../../src/router/errors';
import type { RouterChatCompletionRequest } from '../../../src/types/router-contract';
import {
  buildVisionProxyRequest,
  VisionProxyService
} from '../../../src/provider/vision-proxy';

const proxyModel = {
  key: 'agent',
  label: 'Agent',
  comboId: 'combo/agent',
  enabled: true,
  toolMode: 'auto',
  visionMode: 'proxy',
  thinkingMode: 'max'
} as const;

const image = (mimeType: string, byte: number): { mimeType: string; data: Uint8Array } => ({
  mimeType,
  data: new Uint8Array([byte])
});

describe('VisionProxyService', () => {
  it('summarizes each image-bearing message sequentially', async () => {
    const requests: RouterChatCompletionRequest[] = [];
    let active = 0;
    let maxActive = 0;
    const service = new VisionProxyService({
      async *streamChatCompletion(input) {
        requests.push(input.request);
        active += 1;
        maxActive = Math.max(maxActive, active);
        yield { type: 'text-delta', text: `summary-${requests.length}` };
        yield { type: 'response-complete', requestId: `req-${requests.length}` };
        active -= 1;
      }
    });

    const result = await service.prepare({
      selectedModel: proxyModel,
      messages: [
        { role: 1, content: [{ value: 'first' }, image('image/png', 1)] },
        { role: 2, content: [{ callId: 'call-1', name: 'tool', input: {} }] },
        {
          role: 1,
          content: [
            { value: 'second' },
            image('image/jpeg', 2),
            image('image/png', 3)
          ]
        }
      ],
      visionProxyComboId: 'combo/vision',
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      signal: new AbortController().signal
    });

    expect(requests.map((request) => request.model)).toEqual([
      'combo/vision',
      'combo/vision'
    ]);
    expect(maxActive).toBe(1);
    expect(result).toMatchObject({
      outcome: 'vision-proxied',
      imageCount: 3,
      imageMessageCount: 2,
      requestIds: ['req-1', 'req-2']
    });
    expect(JSON.stringify(result.messages)).toContain('summary-1');
    expect(JSON.stringify(result.messages)).toContain('summary-2');
    expect(JSON.stringify(result.messages)).not.toContain('mimeType');
    expect(result.messages[1]?.content).toEqual([
      { callId: 'call-1', name: 'tool', input: {} }
    ]);
  });

  it('rejects a missing shared combo before calling 9router', async () => {
    let called = false;
    const service = new VisionProxyService({
      async *streamChatCompletion() {
        called = true;
        yield { type: 'response-complete' };
      }
    });

    await expect(
      service.prepare({
        selectedModel: proxyModel,
        messages: [{ role: 1, content: [image('image/png', 1)] }],
        visionProxyComboId: '',
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret',
        maxTokens: 128,
        requestTimeoutMs: 5_000,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      details: expect.objectContaining({
        phase: 'vision-proxy',
        settingsKey: '9router-copilot.visionProxyComboId'
      })
    });
    expect(called).toBe(false);
  });

  it.each([
    ['native', 'native-vision'],
    ['off', 'vision-blocked']
  ] as const)('returns %s mode without proxying', async (visionMode, outcome) => {
    let called = false;
    const service = new VisionProxyService({
      async *streamChatCompletion() {
        called = true;
        yield { type: 'response-complete' };
      }
    });
    const messages = [{ role: 1, content: [image('image/png', 1)] }];
    const result = await service.prepare({
      selectedModel: { ...proxyModel, visionMode },
      messages,
      visionProxyComboId: 'combo/vision',
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      signal: new AbortController().signal
    });

    expect(result.outcome).toBe(outcome);
    expect(result.messages).toBe(messages);
    expect(called).toBe(false);
  });

  it('does not classify tool parts as images', async () => {
    const service = new VisionProxyService({
      async *streamChatCompletion() {
        throw new Error('must not be called');
      }
    });
    const result = await service.prepare({
      selectedModel: proxyModel,
      messages: [{ role: 2, content: [{ callId: 'call-1', name: 'tool', input: {} }] }],
      visionProxyComboId: 'combo/vision',
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      signal: new AbortController().signal
    });

    expect(result.outcome).toBe('text-only');
  });

  it('rejects an empty Vision stream', async () => {
    const service = new VisionProxyService({
      async *streamChatCompletion() {
        yield { type: 'response-complete' };
      }
    });

    await expect(
      service.prepare({
        selectedModel: proxyModel,
        messages: [{ role: 1, content: [image('image/png', 1)] }],
        visionProxyComboId: 'combo/vision',
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret',
        maxTokens: 128,
        requestTimeoutMs: 5_000,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({
      code: 'MALFORMED_STREAM_ERROR',
      details: { phase: 'vision-proxy' }
    });
  });

  it('rejects a truncated Vision stream after text deltas without leaking the summary', async () => {
    const service = new VisionProxyService({
      async *streamChatCompletion() {
        yield { type: 'text-delta', text: 'partial-summary-secret' };
      }
    });

    const promise = service.prepare({
      selectedModel: proxyModel,
      messages: [{ role: 1, content: [image('image/png', 1)] }],
      visionProxyComboId: 'combo/vision',
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      signal: new AbortController().signal
    });

    await expect(promise).rejects.toMatchObject({
      code: 'MALFORMED_STREAM_ERROR',
      details: { phase: 'vision-proxy' }
    });
    await expect(promise).rejects.not.toMatchObject({
      details: expect.objectContaining({
        summary: expect.anything()
      })
    });
    await expect(promise).rejects.not.toThrow('partial-summary-secret');
  });

  it('maps a missing Vision combo to the shared setting without raw response text', async () => {
    const service = new VisionProxyService({
      async *streamChatCompletion() {
        throw new NineRouterError('COMBO_MAPPING_ERROR', 'missing', {
          requestId: 'req-404',
          details: { status: 404, responseText: 'raw-secret' }
        });
      }
    });
    const promise = service.prepare({
      selectedModel: proxyModel,
      messages: [{ role: 1, content: [image('image/png', 1)] }],
      visionProxyComboId: 'combo/missing',
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret',
      maxTokens: 128,
      requestTimeoutMs: 5_000,
      signal: new AbortController().signal
    });

    await expect(promise).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      requestId: 'req-404',
      details: {
        phase: 'vision-proxy',
        status: 404,
        settingsKey: '9router-copilot.visionProxyComboId'
      }
    });
    await expect(promise).rejects.not.toMatchObject({
      details: expect.objectContaining({ responseText: expect.anything() })
    });
  });

  it.each([
    'AUTHENTICATION_ERROR',
    'TIMEOUT_ERROR',
    'CANCELLATION_ERROR',
    'TRANSPORT_ERROR',
    'UPSTREAM_UNAVAILABLE'
  ] as const)('preserves %s with safe phase details', async (code) => {
    const service = new VisionProxyService({
      async *streamChatCompletion() {
        throw new NineRouterError(code, 'safe message', {
          details: { responseText: 'must-not-survive' }
        });
      }
    });

    await expect(
      service.prepare({
        selectedModel: proxyModel,
        messages: [{ role: 1, content: [image('image/png', 1)] }],
        visionProxyComboId: 'combo/vision',
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret',
        maxTokens: 128,
        requestTimeoutMs: 5_000,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code, details: { phase: 'vision-proxy' } });
  });

  it('converts router-error events to upstream unavailable', async () => {
    const service = new VisionProxyService({
      async *streamChatCompletion() {
        yield { type: 'router-error', error: 'upstream failed', requestId: 'req-up' };
      }
    });

    await expect(
      service.prepare({
        selectedModel: proxyModel,
        messages: [{ role: 1, content: [image('image/png', 1)] }],
        visionProxyComboId: 'combo/vision',
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret',
        maxTokens: 128,
        requestTimeoutMs: 5_000,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      requestId: 'req-up',
      details: { phase: 'vision-proxy' }
    });
  });
});

describe('buildVisionProxyRequest', () => {
  it('builds a bare-combo multimodal request without tools or reasoning', () => {
    const request = buildVisionProxyRequest(
      { role: 1, content: [{ value: 'read this' }, image('image/png', 97)] },
      'combo/vision',
      256
    );

    expect(request).toMatchObject({
      model: 'combo/vision',
      stream: true,
      max_tokens: 256
    });
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('tool_choice');
    expect(request).not.toHaveProperty('reasoning_effort');
    expect(JSON.stringify(request.messages)).toContain('data:image/png;base64,YQ==');
  });

  it('treats hybrid image parts as images before generic value text', () => {
    const request = buildVisionProxyRequest(
      {
        role: 1,
        content: [
          {
            mimeType: 'image/png',
            data: new Uint8Array([97]),
            value: 'must-not-replace-image'
          }
        ]
      },
      'combo/vision'
    );

    expect(JSON.stringify(request.messages)).toContain('data:image/png;base64,YQ==');
    expect(JSON.stringify(request.messages)).not.toContain('must-not-replace-image');
  });
});
