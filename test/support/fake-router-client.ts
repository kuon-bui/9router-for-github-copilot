import type { RouterClient } from '@/router/client';
import type { RouterModelMetadata } from '@/router/model-catalog';
import type { RouterUsageSnapshot } from '@/router/usage';
import type { RouterResponseRequest, RouterStreamEvent } from '@/types/router-contract';

export interface FakeRouterClientOptions {
  events?: RouterStreamEvent[];
  responseText?: string;
  models?: RouterModelMetadata[];
  delayMs?: number;
}

export class FakeRouterClient implements RouterClient {
  public recordedRequests: RouterResponseRequest[] = [];
  private events: RouterStreamEvent[];
  private models: RouterModelMetadata[];
  private delayMs: number;

  constructor(options: FakeRouterClientOptions = {}) {
    this.models = options.models ?? [
      {
        id: 'gh/gpt-5',
        ownedBy: 'github',
        vision: true,
        contextWindow: 128000,
        maxOutput: 8192
      }
    ];
    this.delayMs = options.delayMs ?? 0;

    if (options.events) {
      this.events = options.events;
    } else if (options.responseText !== undefined) {
      this.events = [
        { type: 'text-delta', text: options.responseText },
        { type: 'response-complete' }
      ];
    } else {
      this.events = [
        { type: 'text-delta', text: 'Default response' },
        { type: 'response-complete' }
      ];
    }
  }

  setEvents(events: RouterStreamEvent[]): void {
    this.events = events;
  }

  async *streamResponse(input: {
    baseUrl: string;
    apiKey: string;
    request: RouterResponseRequest;
    timeoutMs: number;
    signal: AbortSignal;
  }): AsyncIterable<RouterStreamEvent> {
    this.recordedRequests.push(input.request);

    for (const event of this.events) {
      if (input.signal.aborted) {
        throw new Error('Aborted');
      }
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      if (input.signal.aborted) {
        throw new Error('Aborted');
      }
      yield event;
    }
  }

  async listModels(_input: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<RouterModelMetadata[]> {
    return this.models;
  }

  async getUsage(_input: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<RouterUsageSnapshot> {
    return {
      updatedAt: Date.now(),
      quotas: []
    };
  }
}
