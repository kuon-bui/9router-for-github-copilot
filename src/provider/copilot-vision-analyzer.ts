import * as vscode from 'vscode';
import { NineRouterError } from '../router/errors';
import { isHostImageDataPart } from './image-input-adapter';
import type { HostChatRequestMessage } from './vision-proxy';

interface Dependencies {
  selectChatModels: typeof vscode.lm.selectChatModels;
}

interface CopilotVisionSummaryInput {
  message: HostChatRequestMessage;
  modelId: string;
  prompt: string;
  token: vscode.CancellationToken;
}

function createPhaseDetails(): Record<string, unknown> {
  return {
    phase: 'vision-proxy',
    source: 'copilot'
  };
}

function isCancellationError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const code = error.code;
  return code === 'Canceled' || code === 'Cancelled';
}

function getLanguageModelErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function mapCopilotVisionError(error: unknown): NineRouterError {
  if (error instanceof NineRouterError) {
    return error;
  }

  const details = createPhaseDetails();

  if (isCancellationError(error)) {
    return new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled', {
      details
    });
  }

  const code = getLanguageModelErrorCode(error);
  if (code === 'NoPermissions') {
    return new NineRouterError(
      'AUTHENTICATION_ERROR',
      'GitHub Copilot Vision analysis requires permission.',
      { details }
    );
  }

  if (code === 'NotFound') {
    return new NineRouterError(
      'CONFIGURATION_ERROR',
      'Configured GitHub Copilot Vision model is unavailable. Run 9router: Configure Vision Proxy.',
      { details }
    );
  }

  if (code === 'Blocked') {
    return new NineRouterError(
      'UPSTREAM_UNAVAILABLE',
      'GitHub Copilot Vision analysis is currently unavailable.',
      { details }
    );
  }

  return new NineRouterError('UPSTREAM_UNAVAILABLE', 'GitHub Copilot Vision analysis failed', {
    details
  });
}

function createCancellationError(): NineRouterError {
  return new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled', {
    details: createPhaseDetails()
  });
}

function appendTextPart(
  content: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart>,
  value: string
): void {
  if (value.length > 0) {
    content.push(new vscode.LanguageModelTextPart(value));
  }
}

export class CopilotVisionAnalyzer {
  public constructor(
    private readonly dependencies: Dependencies = {
      selectChatModels: vscode.lm.selectChatModels
    }
  ) {}

  public async summarize(input: CopilotVisionSummaryInput): Promise<{ summary: string }> {
    if (input.token.isCancellationRequested) {
      throw createCancellationError();
    }

    let model: vscode.LanguageModelChat | undefined;
    try {
      const models = await this.dependencies.selectChatModels({
        vendor: 'copilot',
        id: input.modelId
      });
      model = models.find((candidate) => candidate.id === input.modelId);

      if (!model) {
        throw new NineRouterError(
          'CONFIGURATION_ERROR',
          'Configured GitHub Copilot Vision model is unavailable. Run 9router: Configure Vision Proxy.',
          {
            details: createPhaseDetails()
          }
        );
      }
    } catch (error) {
      throw mapCopilotVisionError(error);
    }

    if (input.token.isCancellationRequested) {
      throw createCancellationError();
    }

    const content: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [
      new vscode.LanguageModelTextPart(input.prompt)
    ];
    const parts = typeof input.message.content === 'string' ? [input.message.content] : input.message.content;

    for (const part of parts) {
      if (typeof part === 'string') {
        appendTextPart(content, part);
      } else if (isHostImageDataPart(part)) {
        content.push(new vscode.LanguageModelDataPart(part.data, part.mimeType));
      } else if (
        typeof part === 'object' &&
        part !== null &&
        'value' in part &&
        typeof part.value === 'string'
      ) {
        appendTextPart(content, part.value);
      }
    }

    try {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(content)],
        {
          justification:
            'Describe attached images for the selected 9router chat model.'
        },
        input.token
      );

      let summary = '';
      for await (const text of response.text) {
        summary += text;
      }

      const trimmed = summary.trim();
      if (trimmed.length === 0) {
        throw new NineRouterError(
          'MALFORMED_STREAM_ERROR',
          'GitHub Copilot Vision analysis returned an empty summary',
          {
            details: createPhaseDetails()
          }
        );
      }

      return { summary: trimmed };
    } catch (error) {
      throw mapCopilotVisionError(error);
    }
  }
}
