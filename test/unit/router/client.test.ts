import { describe, expect, it, vi } from 'vitest';
import { createRouterClient } from '../../../src/router/client';

describe('createRouterClient', () => {
  it('posts to /v1/chat/completions with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }
      }),
      headers: new Headers()
    });

    const client = createRouterClient({ fetch: fetchMock as never });

    const events: unknown[] = [];
    for await (const event of client.streamChatCompletion({
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret-token',
      request: { model: 'combo/daily', messages: [], stream: true },
      timeoutMs: 1000,
      signal: new AbortController().signal
    })) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'https://router.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret-token'
        })
      })
    );
    expect(events).toEqual([{ type: 'response-complete' }]);
  });

  it('does not create an extension timeout when timeoutMs is zero', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { signal?: AbortSignal }) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (init.signal?.aborted) {
        throw new Error('request was aborted');
      }

      return {
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          }
        }),
        headers: new Headers()
      };
    });
    const client = createRouterClient({ fetch: fetchMock as never });

    const events: unknown[] = [];
    for await (const event of client.streamChatCompletion({
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret-token',
      request: { model: 'combo/daily', messages: [], stream: true },
      timeoutMs: 0,
      signal: new AbortController().signal
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: 'response-complete' }]);
  });

  it('classifies an explicit missing model 404 as a model mapping error', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'x-request-id': 'req-missing-model' }),
        text: async () => '{"error":{"message":"Model router/missing not found"}}'
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamChatCompletion({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'router/missing', messages: [], stream: true },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: 'MODEL_MAPPING_ERROR',
      requestId: 'req-missing-model'
    });
  });

  it('preserves an unrelated 404 as a transport error', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => '{"error":{"message":"No active credentials for provider: openai"}}'
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamChatCompletion({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: '123', messages: [], stream: true },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      message: '9router request failed with status 404'
    });
  });

  it('does not treat an invalid downstream model response as a missing combo', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => '{"error":{"message":"Invalid model response from provider"}}'
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamChatCompletion({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: '123', messages: [], stream: true },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      message: '9router request failed with status 404'
    });
  });

  it('makes an upstream 5xx actionable without exposing the raw response body', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({ 'x-request-id': 'req-upstream-503' }),
        text: async () => '{"error":{"message":"private provider failure details"}}'
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamChatCompletion({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'combo/daily', messages: [], stream: true },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      requestId: 'req-upstream-503',
      message:
        "9router could not complete upstream execution (HTTP 503). Check the mapped model's upstream credentials, quota, and provider availability. Request ID: req-upstream-503.",
      details: {
        status: 503
      }
    });
    await expect(consume()).rejects.not.toMatchObject({
      details: expect.objectContaining({ responseText: expect.anything() })
    });
  });
});
