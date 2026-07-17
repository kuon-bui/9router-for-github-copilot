import { NineRouterError } from '../router/errors';
import {
  countImageParts,
  createRouterImagePart,
  hasImageParts,
  isHostImageDataPart
} from './image-input-adapter';
import type { RouterClient } from '../router/client';
import type { ConfiguredModel } from '../types/product-model';
import type {
  RouterChatCompletionRequest,
  RouterContentPart
} from '../types/router-contract';

export interface HostChatRequestMessage {
  role: unknown;
  content: string | readonly unknown[];
  name?: string;
}

export type VisionCompatibilityOutcome =
  | 'text-only'
  | 'native-vision'
  | 'vision-proxied'
  | 'vision-blocked';

export interface VisionCompatibilityResult {
  messages: readonly HostChatRequestMessage[];
  outcome: VisionCompatibilityOutcome;
  hasVisionInput: boolean;
  imageCount: number;
  imageMessageCount: number;
  requestIds: string[];
  blockReason?: string;
}

export interface VisionProxyInput {
  selectedModel: ConfiguredModel;
  messages: readonly HostChatRequestMessage[];
  visionProxyModelId: string;
  baseUrl: string;
  apiKey: string;
  maxTokens?: number;
  requestTimeoutMs: number;
  signal: AbortSignal;
}

interface VisionInputCounts {
  imageCount: number;
  imageMessageCount: number;
}

const VISION_PROXY_INSTRUCTION =
  'Describe the supplied images faithfully for another language model. Include visible text, code, tables, diagrams, layout, and uncertainty. Do not answer the user request; provide only image context.';

export function buildVisionProxyRequest(
  message: HostChatRequestMessage,
  modelId: string,
  maxTokens?: number
): RouterChatCompletionRequest {
  const userContent: RouterContentPart[] = [];
  const parts = typeof message.content === 'string' ? [message.content] : message.content;

  for (const part of parts) {
    if (typeof part === 'string') {
      userContent.push({ type: 'text', text: part });
    } else if (isHostImageDataPart(part)) {
      userContent.push(createRouterImagePart(part));
    } else if (
      typeof part === 'object' &&
      part !== null &&
      'value' in part &&
      typeof part.value === 'string'
    ) {
      userContent.push({ type: 'text', text: part.value });
    }
  }

  const request: RouterChatCompletionRequest = {
    model: modelId,
    stream: true,
    messages: [
      { role: 'system', content: VISION_PROXY_INSTRUCTION },
      { role: 'user', content: userContent }
    ]
  };

  if (typeof maxTokens === 'number') {
    request.max_tokens = maxTokens;
  }

  return request;
}

function inspectVisionInput(messages: readonly HostChatRequestMessage[]): VisionInputCounts {
  return {
    imageCount: messages.reduce(
      (total, message) => total + countImageParts(message.content),
      0
    ),
    imageMessageCount: messages.filter((message) => hasImageParts(message.content)).length
  };
}

function resolveNonProxyResult(
  selectedModel: ConfiguredModel,
  messages: readonly HostChatRequestMessage[],
  counts: VisionInputCounts
): VisionCompatibilityResult | undefined {
  if (counts.imageCount === 0) {
    return {
      messages,
      outcome: 'text-only',
      hasVisionInput: false,
      imageCount: 0,
      imageMessageCount: 0,
      requestIds: []
    };
  }

  if (selectedModel.visionMode === 'native') {
    return {
      messages,
      outcome: 'native-vision',
      hasVisionInput: true,
      imageCount: counts.imageCount,
      imageMessageCount: counts.imageMessageCount,
      requestIds: []
    };
  }

  if (selectedModel.visionMode === 'off') {
    return {
      messages,
      outcome: 'vision-blocked',
      hasVisionInput: true,
      imageCount: counts.imageCount,
      imageMessageCount: counts.imageMessageCount,
      requestIds: [],
      blockReason: `Display model "${selectedModel.id}" cannot accept image inputs because visionMode is off.`
    };
  }

  return undefined;
}

function replaceImagesWithSummary(
  message: HostChatRequestMessage,
  summary: string
): HostChatRequestMessage {
  const retained =
    typeof message.content === 'string'
      ? [{ value: message.content }]
      : message.content.filter((part) => !isHostImageDataPart(part));

  return {
    ...message,
    content: [...retained, { value: `[Vision proxy summary]\n${summary}` }]
  };
}

function mapVisionProxyError(error: unknown): NineRouterError {
  if (!(error instanceof NineRouterError)) {
    return new NineRouterError(
      'UPSTREAM_UNAVAILABLE',
      '9router Vision analysis failed',
      { details: { phase: 'vision-proxy' } }
    );
  }

  const details: Record<string, unknown> = { phase: 'vision-proxy' };
  if (typeof error.details?.status === 'number') {
    details.status = error.details.status;
  }

  const options: { requestId?: string; details: Record<string, unknown> } = { details };
  if (error.requestId) {
    options.requestId = error.requestId;
  }

  if (error.code === 'MODEL_MAPPING_ERROR') {
    details.settingsKey = '9router-copilot.visionProxyModelId';
    return new NineRouterError(
      'CONFIGURATION_ERROR',
      'The configured 9router Vision proxy model was not found. Update 9router-copilot.visionProxyModelId to a valid model id.',
      options
    );
  }

  return new NineRouterError(error.code, error.message, options);
}

export class VisionProxyService {
  public constructor(private readonly routerClient: RouterClient) {}

  public async prepare(input: VisionProxyInput): Promise<VisionCompatibilityResult> {
    const counts = inspectVisionInput(input.messages);
    const nonProxyResult = resolveNonProxyResult(
      input.selectedModel,
      input.messages,
      counts
    );
    if (nonProxyResult) {
      return nonProxyResult;
    }

    const modelId = input.visionProxyModelId.trim();
    if (modelId.length === 0) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        'Proxy Vision requires 9router-copilot.visionProxyModelId to reference an existing 9router model.',
        {
          details: {
            phase: 'vision-proxy',
            settingsKey: '9router-copilot.visionProxyModelId'
          }
        }
      );
    }

    const messages: HostChatRequestMessage[] = [];
    const requestIds: string[] = [];
    for (const message of input.messages) {
      if (!hasImageParts(message.content)) {
        messages.push(message);
        continue;
      }

      if (input.signal.aborted) {
        throw new NineRouterError(
          'CANCELLATION_ERROR',
          '9router request was cancelled',
          { details: { phase: 'vision-proxy' } }
        );
      }

      const result = await this.summarizeMessage(message, modelId, input);
      messages.push(replaceImagesWithSummary(message, result.summary));
      if (result.requestId) {
        requestIds.push(result.requestId);
      }
    }

    return {
      messages,
      outcome: 'vision-proxied',
      hasVisionInput: true,
      imageCount: counts.imageCount,
      imageMessageCount: counts.imageMessageCount,
      requestIds
    };
  }

  private async summarizeMessage(
    message: HostChatRequestMessage,
    modelId: string,
    input: VisionProxyInput
  ): Promise<{ summary: string; requestId?: string }> {
    let summary = '';
    let requestId: string | undefined;
    let responseCompleted = false;

    try {
      const stream = this.routerClient.streamChatCompletion({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        request: buildVisionProxyRequest(message, modelId, input.maxTokens),
        timeoutMs: input.requestTimeoutMs,
        signal: input.signal
      });

      for await (const event of stream) {
        if (event.type === 'text-delta') {
          summary += event.text;
        }

        if (event.type === 'response-complete') {
          responseCompleted = true;
          if (event.requestId) {
            requestId = event.requestId;
          }
        }

        if (event.type === 'router-error') {
          throw new NineRouterError(
            'UPSTREAM_UNAVAILABLE',
            '9router Vision analysis failed',
            {
              ...(event.requestId ? { requestId: event.requestId } : {}),
              details: { phase: 'vision-proxy' }
            }
          );
        }
      }
    } catch (error) {
      throw mapVisionProxyError(error);
    }

    if (!responseCompleted) {
      throw new NineRouterError(
        'MALFORMED_STREAM_ERROR',
        '9router Vision analysis stream ended before response completion',
        {
          ...(requestId ? { requestId } : {}),
          details: { phase: 'vision-proxy' }
        }
      );
    }

    const trimmed = summary.trim();
    if (trimmed.length === 0) {
      throw new NineRouterError(
        'MALFORMED_STREAM_ERROR',
        '9router Vision analysis returned an empty summary',
        {
          ...(requestId ? { requestId } : {}),
          details: { phase: 'vision-proxy' }
        }
      );
    }

    return requestId ? { summary: trimmed, requestId } : { summary: trimmed };
  }
}
