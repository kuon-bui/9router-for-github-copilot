import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeRouterServer {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
  setModels: (models: unknown[]) => void;
  setStreamResponseText: (text: string) => void;
}

export async function createFake9routerServer(): Promise<FakeRouterServer> {
  let models: unknown[] = [
    {
      id: 'gh/gpt-5',
      owned_by: 'github',
      capabilities: {
        vision: true,
        contextWindow: 128000,
        maxOutput: 8192
      }
    }
  ];

  let streamResponseText = 'Hello from fake 9router!';

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';

    if (req.method === 'GET' && url.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: models }));
      return;
    }

    if (req.method === 'POST' && url.startsWith('/v1/responses')) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: streamResponseText })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp-fake-1' } })}\n\n`);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
    setModels: (newModels: unknown[]) => {
      models = newModels;
    },
    setStreamResponseText: (text: string) => {
      streamResponseText = text;
    }
  };
}
