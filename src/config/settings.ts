import * as vscode from 'vscode';
import {
  DEFAULT_BASE_URL,
  DEFAULT_DEBUG_MODE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODELS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_VISION_PROXY_MODEL_ID,
  DEFAULT_VISION_PROXY_PROMPT,
  DEFAULT_VISION_PROXY_SOURCE
} from './defaults';
import { parseModelSettings } from './model-settings';
import { createPublishedModel } from '@/provider/model-catalog';
import type {
  ModelSettingsIssue,
  RejectedModelSetting
} from './model-settings';
import type { ConfiguredModel, PublishedModel } from '@/types/product-model';

const SECTION = '9router-copilot';

export type VisionProxySource = '9router' | 'copilot';

export interface RuntimeSettings {
  baseUrl: string;
  maxTokens?: number;
  requestTimeoutMs: number;
  debugMode: 'minimal' | 'metadata' | 'verbose';
  visionProxySource: VisionProxySource | undefined;
  visionProxyModelId: string;
  visionProxyPrompt: string;
}

interface RuntimeSettingsIssue {
  scope: 'runtime';
  code: 'INVALID_BASE_URL' | 'INVALID_REQUEST_TIMEOUT';
  message: string;
  path: string;
}

interface CapabilitySettingsIssue {
  scope: 'capability';
  code:
    | 'MISSING_VISION_PROXY_MODEL'
    | 'INVALID_VISION_PROXY_SOURCE'
    | 'MISSING_VISION_PROXY_PROMPT';
  message: string;
  path: string;
}

export type SettingsIssue =
  | ModelSettingsIssue
  | RuntimeSettingsIssue
  | CapabilitySettingsIssue;

export interface SettingsSnapshot {
  state: 'valid' | 'degraded' | 'empty' | 'invalid-runtime';
  runtime: RuntimeSettings | undefined;
  models: ConfiguredModel[];
  publishedModels: PublishedModel[];
  rejectedModels: RejectedModelSetting[];
  issues: SettingsIssue[];
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export function normalizeMaxTokens(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0
    ? input
    : undefined;
}

export function normalizeVisionProxySource(
  source: unknown,
  modelId: string
): VisionProxySource | undefined {
  if (source === '9router' || source === 'copilot') {
    return source;
  }

  return (source === undefined || source === DEFAULT_VISION_PROXY_SOURCE) && modelId.length > 0
    ? '9router'
    : undefined;
}

export function isVisionProxyConfigured(runtime: RuntimeSettings): boolean {
  return (
    runtime.visionProxySource !== undefined &&
    runtime.visionProxyModelId.length > 0 &&
    runtime.visionProxyPrompt.length > 0
  );
}

export function loadRuntimeSettings(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>
): RuntimeSettings {
  const baseUrl = normalizeBaseUrl(configuration.get<string>('baseUrl') ?? DEFAULT_BASE_URL);
  const maxTokens = normalizeMaxTokens(
    configuration.get<unknown>('maxTokens') ?? DEFAULT_MAX_TOKENS
  );
  const requestTimeoutMs =
    configuration.get<number>('requestTimeoutMs') ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const debugMode =
    configuration.get<'minimal' | 'metadata' | 'verbose'>('debugMode') ?? DEFAULT_DEBUG_MODE;
  const visionProxyModelId =
    configuration.get<string>('visionProxyModelId')?.trim() ??
    DEFAULT_VISION_PROXY_MODEL_ID;
  const visionProxySource = normalizeVisionProxySource(
    configuration.get<unknown>('visionProxySource'),
    visionProxyModelId
  );
  const visionProxyPrompt =
    configuration.get<string>('visionProxyPrompt')?.trim() ?? DEFAULT_VISION_PROXY_PROMPT;

  return {
    baseUrl,
    ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
    requestTimeoutMs,
    debugMode,
    visionProxySource,
    visionProxyModelId,
    visionProxyPrompt
  };
}

export function getExtensionConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export function buildSettingsSnapshot(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>
): SettingsSnapshot {
  const rawModels = configuration.get<unknown>('models');
  const parsedModels = parseModelSettings(
    rawModels === undefined ? DEFAULT_MODELS : rawModels
  );
  const issues: SettingsIssue[] = [...parsedModels.issues];
  const runtime = validateRuntimeSettings(configuration, issues);
  const hasProxyModel = parsedModels.models.some((model) => model.visionMode === 'proxy');
  const configuredVisionProxySource = configuration.get<unknown>('visionProxySource');

  const publishedModels = parsedModels.models.map((model) =>
    createPublishedModel(model, {
      visionProxyAvailable: runtime ? runtime.visionProxyPrompt.length > 0 : false
    })
  );

  if (hasProxyModel && runtime) {
    if (
      configuredVisionProxySource !== undefined &&
      configuredVisionProxySource !== DEFAULT_VISION_PROXY_SOURCE &&
      configuredVisionProxySource !== '9router' &&
      configuredVisionProxySource !== 'copilot'
    ) {
      issues.push({
        scope: 'capability',
        code: 'INVALID_VISION_PROXY_SOURCE',
        message:
          'Proxy Vision source must be one of: 9router, copilot, or an empty value to disable proxy publication.',
        path: '9router-copilot.visionProxySource'
      });
    }

    if (runtime.visionProxyModelId.length === 0) {
      issues.push({
        scope: 'capability',
        code: 'MISSING_VISION_PROXY_MODEL',
        message:
          'Proxy Vision is disabled until 9router-copilot.visionProxyModelId references an existing model id for the selected Vision proxy source.',
        path: '9router-copilot.visionProxyModelId'
      });
    }

    if (runtime.visionProxySource !== undefined && runtime.visionProxyPrompt.length === 0) {
      issues.push({
        scope: 'capability',
        code: 'MISSING_VISION_PROXY_PROMPT',
        message:
          'Proxy Vision is disabled until 9router-copilot.visionProxyPrompt contains a non-empty prompt.',
        path: '9router-copilot.visionProxyPrompt'
      });
    }
  }

  if (!runtime) {
    return {
      state: 'invalid-runtime',
      runtime: undefined,
      models: parsedModels.models,
      publishedModels: [],
      rejectedModels: parsedModels.rejectedModels,
      issues
    };
  }

  if (publishedModels.length === 0) {
    return {
      state: 'empty',
      runtime,
      models: parsedModels.models,
      publishedModels,
      rejectedModels: parsedModels.rejectedModels,
      issues
    };
  }

  return {
    state: issues.length > 0 ? 'degraded' : 'valid',
    runtime,
    models: parsedModels.models,
    publishedModels,
    rejectedModels: parsedModels.rejectedModels,
    issues
  };
}

function validateRuntimeSettings(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  issues: SettingsIssue[]
): RuntimeSettings | undefined {
  const runtime = loadRuntimeSettings(configuration);
  const baseUrlInput = configuration.get<string>('baseUrl') ?? DEFAULT_BASE_URL;
  const normalizedBaseUrl = baseUrlInput.trim().length > 0 ? normalizeBaseUrl(baseUrlInput) : '';

  if (!isValidBaseUrl(normalizedBaseUrl)) {
    issues.push({
      scope: 'runtime',
      code: 'INVALID_BASE_URL',
      message: 'The configured 9router base URL must be a valid http or https URL.',
      path: '9router-copilot.baseUrl'
    });
  }

  if (!Number.isFinite(runtime.requestTimeoutMs) || runtime.requestTimeoutMs <= 0) {
    issues.push({
      scope: 'runtime',
      code: 'INVALID_REQUEST_TIMEOUT',
      message: 'The request timeout must be a positive number of milliseconds.',
      path: '9router-copilot.requestTimeoutMs'
    });
  }

  if (issues.some((issue) => issue.scope === 'runtime')) {
    return undefined;
  }

  return {
    ...runtime,
    baseUrl: normalizedBaseUrl
  };
}

function isValidBaseUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
