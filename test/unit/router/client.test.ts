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

  it('gets and validates the full /v1/models catalog with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        object: 'list',
        data: [
          {
            id: 'router/vision',
            owned_by: 'router',
            capabilities: {
              vision: true,
              contextWindow: 400_000,
              maxOutput: 128_000
            }
          },
          { id: 'router/text', capabilities: { vision: false } }
        ]
      })
    });

    const client = createRouterClient({ fetch: fetchMock as never });

    await expect(
      client.listModels({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        timeoutMs: 1000,
        signal: new AbortController().signal
      })
    ).resolves.toEqual([
      { id: 'router/text' },
      {
        id: 'router/vision',
        ownedBy: 'router',
        vision: true,
        contextWindow: 400_000,
        maxOutput: 128_000
      }
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://router.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer secret-token' })
      })
    );
  });

  it('maps unauthorized discovery status to AUTHENTICATION_ERROR', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers()
      }) as never
    });

    await expect(
      client.listModels({
        baseUrl: 'https://router.example.com',
        apiKey: 'secret-token',
        timeoutMs: 1000,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_ERROR' });
  });

  it('maps discovery JSON parsing failures to UPSTREAM_UNAVAILABLE without raw body details', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'x-request-id': 'req-json-parse' }),
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        }
      }) as never
    });

    const result = client.listModels({
      baseUrl: 'https://router.example.com',
      apiKey: 'secret-token',
      timeoutMs: 1000,
      signal: new AbortController().signal
    });

    await expect(result).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      requestId: 'req-json-parse',
      details: { phase: 'model-catalog-discovery' }
    });

    const error = await result.catch(
      (caught: unknown) => caught as { details?: Record<string, unknown> }
    );
    expect(error.details).not.toHaveProperty('responseText');
    expect(error.details).not.toHaveProperty('rawBody');
  });

  it('maps malformed discovery payload roots to UPSTREAM_UNAVAILABLE without raw body details', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ data: null })
      }) as never
    });

    const result = client.listModels({
      baseUrl: 'https://router.example.com',
      apiKey: 'secret-token',
      timeoutMs: 1000,
      signal: new AbortController().signal
    });

    await expect(result).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      details: { phase: 'model-catalog-discovery' }
    });

    const error = await result.catch(
      (caught: unknown) => caught as { details?: Record<string, unknown> }
    );
    expect(error.details).not.toHaveProperty('responseText');
    expect(error.details).not.toHaveProperty('rawBody');
  });

  it('maps model discovery timeout to TIMEOUT_ERROR', async () => {
    vi.useFakeTimers();

    try {
      const fetchMock = vi.fn().mockImplementation(
        (_url: string, options: { signal?: AbortSignal } | undefined) =>
          new Promise((_resolve, reject) => {
            const signal = options?.signal;
            if (!signal) {
              reject(new Error('Missing abort signal'));
              return;
            }

            if (signal.aborted) {
              reject(signal.reason ?? new Error('aborted'));
              return;
            }

            signal.addEventListener(
              'abort',
              () => {
                reject(signal.reason ?? new Error('aborted'));
              },
              { once: true }
            );
          })
      );

      const client = createRouterClient({ fetch: fetchMock as never });
      const result = client.listModels({
        baseUrl: 'https://router.example.com',
        apiKey: 'secret-token',
        timeoutMs: 1000,
        signal: new AbortController().signal
      });

      const rejection = expect(result).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });

      await vi.advanceTimersByTimeAsync(1000);
      await rejection;
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('maps caller cancellation during discovery to CANCELLATION_ERROR', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled by caller'));

    const fetchMock = vi.fn().mockImplementation(
      (_url: string, options: { signal?: AbortSignal } | undefined) =>
        Promise.reject(options?.signal?.reason ?? new Error('aborted'))
    );

    const client = createRouterClient({ fetch: fetchMock as never });

    await expect(
      client.listModels({
        baseUrl: 'https://router.example.com',
        apiKey: 'secret-token',
        timeoutMs: 1000,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'CANCELLATION_ERROR' });
  });
});
