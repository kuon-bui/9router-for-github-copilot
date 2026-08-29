import { describe, expect, it, vi } from 'vitest';
import { createRouterClient } from '@/router/client';

function responseBody(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}

describe('createRouterClient', () => {
  it('posts to /v1/responses with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"response.completed","response":{}}\n\n'
            )
          );
          controller.close();
        }
      }),
      headers: new Headers()
    });

    const client = createRouterClient({ fetch: fetchMock as never });

    const events: unknown[] = [];
    for await (const event of client.streamResponse({
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret-token',
      request: { model: 'combo/daily', input: [], stream: true, store: false },
      timeoutMs: 1000,
      signal: new AbortController().signal
    })) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'https://router.example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          accept: 'text/event-stream',
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
        body: responseBody('{"error":{"message":"Model router/missing not found"}}')
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'router/missing', input: [], stream: true, store: false },
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
        body: responseBody('{"error":{"message":"No active credentials for provider: openai"}}')
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: '123', input: [], stream: true, store: false },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      message: '9router request failed with status 404: No active credentials for provider: openai'
    });
  });

  it('does not treat an invalid downstream model response as a missing combo', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        body: responseBody('{"error":{"message":"Invalid model response from provider"}}')
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: '123', input: [], stream: true, store: false },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      message: '9router request failed with status 404: Invalid model response from provider'
    });
  });

  it('surfaces the 9router error message for an unhandled status', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'x-request-id': 'req-invalid-value' }),
        body: responseBody(
          JSON.stringify({
            error: {
              message: "Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'.",
              param: 'input[1].content[0].type'
            }
          })
        )
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'combo/daily', input: [], stream: true, store: false },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: 'TRANSPORT_ERROR',
      requestId: 'req-invalid-value',
      message:
        "9router request failed with status 400: Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'.",
      details: { status: 400 }
    });
  });

  it('keeps the raw error body on the error for diagnostics but out of details', async () => {
    const rawBody = JSON.stringify({
      error: { message: 'Unsupported content part', param: 'input[1].content[0].type' }
    });
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers(),
        body: responseBody(rawBody)
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'combo/daily', input: [], stream: true, store: false },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    const error = (await consume().catch((caught: unknown) => caught)) as {
      responseBody?: string;
      details?: Record<string, unknown>;
    };

    expect(error.responseBody).toBe(rawBody);
    expect(error.details).not.toHaveProperty('responseText');
    expect(error.details).not.toHaveProperty('responseBody');
  });

  it('collapses a multi-line error body into a single-line message', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: new Headers(),
        body: responseBody('<html>\n  <body>Bad Gateway</body>\n</html>')
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'combo/daily', input: [], stream: true, store: false },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    const error = (await consume().catch((caught: unknown) => caught)) as { message: string };

    expect(error.message).toBe(
      '9router upstream execution is unavailable: <html> <body>Bad Gateway</body> </html>'
    );
    expect(error.message).not.toContain('\n');
  });

  it('bounds the surfaced error message and never echoes an auth body', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        body: responseBody('{"error":{"message":"Invalid API key: sk-live-do-not-echo"}}')
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'combo/daily', input: [], stream: true, store: false },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    const error = (await consume().catch((caught: unknown) => caught)) as {
      code: string;
      message: string;
      responseBody?: string;
    };

    expect(error.code).toBe('AUTHENTICATION_ERROR');
    expect(error.message).toBe('9router authentication failed');
    expect(error.responseBody).toBeUndefined();
  });

  it('truncates an oversized error message', async () => {
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers(),
        body: responseBody(JSON.stringify({ error: { message: 'x'.repeat(1200) } }))
      }) as never
    });

    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'combo/daily', input: [], stream: true, store: false },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    const error = (await consume().catch((caught: unknown) => caught)) as { message: string };

    expect(error.message).toHaveLength('9router request failed with status 400: '.length + 512);
    expect(error.message.endsWith('...')).toBe(true);
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

  it('gets and validates /v1/usage with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-request-id': 'req-usage' }),
      json: async () => ({
        count: 1,
        lastSweepAt: '2026-08-29T02:15:29.747Z',
        entries: [
          {
            connectionId: 'conn-1',
            provider: 'codex',
            name: 'test@gmail.com',
            authType: 'oauth',
            status: 'ok',
            plan: 'plus',
            quotas: {
              session: {
                used: 95,
                total: 100,
                remaining: 5,
                resetAt: '2026-08-29T05:50:05.000Z',
                unlimited: false
              }
            },
            message: null,
            fetchedAt: '2026-08-29T02:15:28.016Z',
            stale: false
          }
        ]
      })
    });

    const client = createRouterClient({ fetch: fetchMock as never });

    await expect(
      client.getUsage({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        timeoutMs: 1000,
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      count: 1,
      entries: [expect.objectContaining({ provider: 'codex' })]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://router.example.com/v1/usage',
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

  it('keeps raw Responses API error bodies out of details and bounds the message', async () => {
    const marker = 'prompt-echo';
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        body: responseBody(`${marker} ${'x'.repeat(20_000)}`)
      }) as never
    });
    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'combo/daily', input: [], stream: true, store: false },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    const error = (await consume().catch((caught: unknown) => caught)) as {
      message: string;
      details?: Record<string, unknown>;
      responseBody?: string;
    };

    expect(error.details).toEqual({ status: 500 });
    expect(JSON.stringify(error.details)).not.toContain(marker);
    expect(error.message.length).toBeLessThanOrEqual(
      '9router upstream execution is unavailable: '.length + 512
    );
    expect(error.responseBody).toContain(marker);
  });

  it('decodes only the bounded error prefix and cancels the remaining body', async () => {
    let cancelled = false;
    const client = createRouterClient({
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `{"error":{"message":"Model router/missing not found"}}${'x'.repeat(100_000)}`
              )
            );
          },
          cancel() {
            cancelled = true;
          }
        })
      }) as never
    });
    const consume = async (): Promise<void> => {
      for await (const event of client.streamResponse({
        baseUrl: 'https://router.example.com/v1',
        apiKey: 'secret-token',
        request: { model: 'router/missing', input: [], stream: true, store: false },
        timeoutMs: 1000,
        signal: new AbortController().signal
      })) {
        void event;
      }
    };

    await expect(consume()).rejects.toMatchObject({ code: 'MODEL_MAPPING_ERROR' });
    expect(cancelled).toBe(true);
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

  it('does not install a timeout when timeoutMs is zero', async () => {
    vi.useFakeTimers();

    try {
      let requestSignal: AbortSignal | undefined;
      const client = createRouterClient({
        fetch: vi.fn().mockImplementation(
          (_url: string, options: { signal?: AbortSignal } | undefined) => {
            requestSignal = options?.signal;
            return new Promise(() => undefined);
          }
        ) as never
      });

      void client.listModels({
        baseUrl: 'https://router.example.com',
        apiKey: 'secret-token',
        timeoutMs: 0,
        signal: new AbortController().signal
      });

      await vi.runAllTimersAsync();
      expect(requestSignal?.aborted).toBe(false);
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

  it('preserves caller cancellation after the timeout deadline passes', async () => {
    vi.useFakeTimers();

    try {
      let rejectFetch: ((reason: unknown) => void) | undefined;
      const fetchMock = vi.fn().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectFetch = reject;
          })
      );
      const controller = new AbortController();
      const client = createRouterClient({ fetch: fetchMock as never });
      const result = client.listModels({
        baseUrl: 'https://router.example.com',
        apiKey: 'secret-token',
        timeoutMs: 1_000,
        signal: controller.signal
      });
      const rejection = expect(result).rejects.toMatchObject({ code: 'CANCELLATION_ERROR' });

      controller.abort(new Error('cancelled by caller'));
      await vi.advanceTimersByTimeAsync(1_000);
      rejectFetch?.(new Error('delayed fetch cancellation'));
      await rejection;
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
