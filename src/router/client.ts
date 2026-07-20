import { NineRouterError } from './errors';
import { parseVisionModels } from './model-catalog';
import { parseRouterEventStream } from './sse-parser';
import { buildChatCompletionsUrl, buildModelsUrl } from './url';
import type { RouterVisionModel } from './model-catalog';
import type { RouterChatCompletionRequest, RouterStreamEvent } from '../types/router-contract';

export interface RouterClient {
  streamChatCompletion(input: {
    baseUrl: string;
    apiKey: string;
    request: RouterChatCompletionRequest;
    timeoutMs: number;
    signal: AbortSignal;
  }): AsyncIterable<RouterStreamEvent>;
  listVisionModels(input: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<RouterVisionModel[]>;
}

function createCompositeAbortSignal(signal: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;

  const forwardAbort = (): void => {
    controller.abort(signal.reason);
  };

  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener('abort', forwardAbort, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Timed out'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutHandle);
      signal.removeEventListener('abort', forwardAbort);
    },
    didTimeout: () => timedOut
  };
}

export function createRouterClient(deps: { fetch: typeof globalThis.fetch }): RouterClient {
  return {
    async *streamChatCompletion(input) {
      const composite = createCompositeAbortSignal(input.signal, input.timeoutMs);

      try {
        const response = await deps.fetch(buildChatCompletionsUrl(input.baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${input.apiKey}`
          },
          body: JSON.stringify(input.request),
          signal: composite.signal
        });

        const requestId = response.headers.get('x-request-id') ?? undefined;
        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw classifyStatusError(response.status, requestId, errorBody);
        }

        if (!response.body) {
          const options = requestId ? { requestId } : undefined;
          throw new NineRouterError(
            'MALFORMED_STREAM_ERROR',
            '9router response stream body is empty',
            options
          );
        }

        for await (const event of parseRouterEventStream(response.body)) {
          if (event.type === 'response-complete' && !event.requestId && requestId) {
            yield {
              ...event,
              requestId
            };
            continue;
          }

          yield event;
        }
      } catch (error) {
        if (composite.didTimeout()) {
          throw new NineRouterError('TIMEOUT_ERROR', '9router request timed out');
        }

        if (input.signal.aborted) {
          throw new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled');
        }

        if (error instanceof NineRouterError) {
          throw error;
        }

        if (error instanceof Error) {
          throw new NineRouterError('TRANSPORT_ERROR', error.message);
        }

        throw new NineRouterError('TRANSPORT_ERROR', 'Unknown transport error');
      } finally {
        composite.cleanup();
      }
    },

    async listVisionModels(input) {
      const composite = createCompositeAbortSignal(input.signal, input.timeoutMs);

      try {
        const response = await deps.fetch(buildModelsUrl(input.baseUrl), {
          method: 'GET',
          headers: {
            authorization: `Bearer ${input.apiKey}`
          },
          signal: composite.signal
        });

        const requestId = response.headers.get('x-request-id') ?? undefined;
        if (!response.ok) {
          throw classifyDiscoveryStatusError(response.status, requestId);
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw createMalformedCatalogError(requestId);
        }

        try {
          return parseVisionModels(payload);
        } catch (error) {
          if (error instanceof NineRouterError) {
            throw withRequestId(error, requestId);
          }

          throw createMalformedCatalogError(requestId);
        }
      } catch (error) {
        if (composite.didTimeout()) {
          throw new NineRouterError('TIMEOUT_ERROR', '9router request timed out');
        }

        if (input.signal.aborted) {
          throw new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled');
        }

        if (error instanceof NineRouterError) {
          throw error;
        }

        if (error instanceof Error) {
          throw new NineRouterError('TRANSPORT_ERROR', error.message);
        }

        throw new NineRouterError('TRANSPORT_ERROR', 'Unknown transport error');
      } finally {
        composite.cleanup();
      }
    }
  };
}

function createMalformedCatalogError(requestId: string | undefined): NineRouterError {
  return new NineRouterError(
    'UPSTREAM_UNAVAILABLE',
    '9router model catalog response is malformed',
    buildErrorOptions(requestId, { phase: 'vision-model-discovery' })
  );
}

function withRequestId(error: NineRouterError, requestId: string | undefined): NineRouterError {
  if (!requestId || error.requestId) {
    return error;
  }

  return new NineRouterError(
    error.code,
    error.message,
    error.details ? { requestId, details: error.details } : { requestId }
  );
}

function extractRouterErrorMessage(responseText: string): string {
  try {
    const payload: unknown = JSON.parse(responseText);
    if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
      return responseText;
    }

    const error = payload.error;
    if (typeof error === 'string') {
      return error;
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof error.message === 'string'
    ) {
      return error.message;
    }
  } catch {
    return responseText;
  }

  return responseText;
}

function isExplicitMissingModelError(responseText: string): boolean {
  const normalized = extractRouterErrorMessage(responseText).trim().toLowerCase();
  return (
    /\b(?:model|combo)\s+(?:(?:"[^"]+"|'[^']+'|[^\s:]+)\s+)?(?:was\s+)?not\s+found\b/.test(
      normalized
    ) ||
    /\bunknown\s+(?:model|combo)(?=\s|:|$)/.test(normalized) ||
    /\binvalid\s+(?:model|combo)\s+(?:id|name|format)(?=\s|:|$)/.test(normalized)
  );
}

function classifyStatusError(status: number, requestId: string | undefined, responseText: string): NineRouterError {
  const details = {
    status,
    responseText
  };

  if (status === 401 || status === 403) {
    return new NineRouterError(
      'AUTHENTICATION_ERROR',
      '9router authentication failed',
      buildErrorOptions(requestId, details)
    );
  }

  if (status === 404 && isExplicitMissingModelError(responseText)) {
    return new NineRouterError(
      'MODEL_MAPPING_ERROR',
      '9router model mapping was not found',
      buildErrorOptions(requestId, details)
    );
  }

  if (status >= 500) {
    return new NineRouterError(
      'UPSTREAM_UNAVAILABLE',
      '9router upstream execution is unavailable',
      buildErrorOptions(requestId, details)
    );
  }

  return new NineRouterError(
    'TRANSPORT_ERROR',
    `9router request failed with status ${status}`,
    buildErrorOptions(requestId, details)
  );
}

function classifyDiscoveryStatusError(status: number, requestId: string | undefined): NineRouterError {
  const details = {
    status,
    phase: 'vision-model-discovery'
  };

  if (status === 401 || status === 403) {
    return new NineRouterError(
      'AUTHENTICATION_ERROR',
      '9router authentication failed',
      buildErrorOptions(requestId, details)
    );
  }

  return new NineRouterError(
    'TRANSPORT_ERROR',
    `9router request failed with status ${status}`,
    buildErrorOptions(requestId, details)
  );
}

function buildErrorOptions(
  requestId: string | undefined,
  details: Record<string, unknown>
): { requestId?: string; details: Record<string, unknown> } {
  if (requestId) {
    return {
      requestId,
      details
    };
  }

  return {
    details
  };
}
