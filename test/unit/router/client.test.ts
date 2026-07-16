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
});
