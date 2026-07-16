import * as vscode from 'vscode';
import {
  DEFAULT_BASE_URL,
  DEFAULT_DEBUG_MODE,
  DEFAULT_DISPLAY_MODELS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL_LABELS,
  DEFAULT_MODEL_MAPPINGS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TOOL_MODES,
  DEFAULT_VISION_MODES
} from './defaults';
import { PRODUCT_MODEL_KEYS } from '../types/product-model';
import type { DisplayModelSetting, ProductModelKey, PublishedModel } from '../types/product-model';

const SECTION = '9router-copilot';
const PRODUCT_MODEL_KEY_SET = new Set<ProductModelKey>(PRODUCT_MODEL_KEYS);

export interface RuntimeSettings {
  baseUrl: string;
  maxTokens?: number;
  requestTimeoutMs: number;
  debugMode: 'minimal' | 'metadata' | 'verbose';
}

export interface SettingsIssue {
  scope: 'runtime' | 'model';
  code:
    | 'INVALID_BASE_URL'
    | 'INVALID_REQUEST_TIMEOUT'
    | 'INVALID_MAX_TOKENS'
    | 'INVALID_DISPLAY_MODEL_KEY'
    | 'INVALID_COMBO_MAPPING';
  message: string;
  modelKey?: string;
}

export interface RejectedModelSetting {
  key: string;
  code: 'INVALID_COMBO_MAPPING';
  message: string;
}

export interface SettingsSnapshot {
  state: 'valid' | 'degraded' | 'empty' | 'invalid-runtime';
  runtime: RuntimeSettings | undefined;
  displayModels: DisplayModelSetting[];
  publishedModels: PublishedModel[];
  rejectedModels: RejectedModelSetting[];
  issues: SettingsIssue[];
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function normalizeDisplayModelKeys(input: unknown): ProductModelKey[] {
  if (!Array.isArray(input)) {
    return DEFAULT_DISPLAY_MODELS;
  }

  const keys = input.filter((value): value is ProductModelKey => {
    return typeof value === 'string' && PRODUCT_MODEL_KEY_SET.has(value as ProductModelKey);
  });

  return Array.from(new Set(keys));
}

function collectConfiguredDisplayModelKeys(input: unknown): { validKeys: ProductModelKey[]; invalidKeys: string[] } {
  if (!Array.isArray(input)) {
    return {
      validKeys: DEFAULT_DISPLAY_MODELS,
      invalidKeys: []
    };
  }

  const validKeys: ProductModelKey[] = [];
  const invalidKeys: string[] = [];

  for (const value of input) {
    if (typeof value === 'string' && PRODUCT_MODEL_KEY_SET.has(value as ProductModelKey)) {
      validKeys.push(value as ProductModelKey);
      continue;
    }

    invalidKeys.push(String(value));
  }

  return {
    validKeys: Array.from(new Set(validKeys)),
    invalidKeys
  };
}

export function loadDisplayModelSettings(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>
): DisplayModelSetting[] {
  const configuredKeys = normalizeDisplayModelKeys(configuration.get<unknown>('displayModels'));

  return configuredKeys.map((key) => ({
    key,
    label: configuration.get<string>(`labels.${key}`)?.trim() || DEFAULT_MODEL_LABELS[key],
    comboId: configuration.get<string>(`modelMappings.${key}`)?.trim() || DEFAULT_MODEL_MAPPINGS[key],
    enabled: true,
    toolMode: configuration.get<'auto' | 'off'>(`toolMode.${key}`) ?? DEFAULT_TOOL_MODES[key],
    visionMode: configuration.get<'native' | 'proxy' | 'off'>(`visionMode.${key}`) ?? DEFAULT_VISION_MODES[key]
  }));
}

export function loadRuntimeSettings(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>
): RuntimeSettings {
  const baseUrl = normalizeBaseUrl(configuration.get<string>('baseUrl') ?? DEFAULT_BASE_URL);
  const maxTokens = configuration.get<number>('maxTokens') ?? DEFAULT_MAX_TOKENS;
  const requestTimeoutMs = configuration.get<number>('requestTimeoutMs') ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const debugMode = configuration.get<'minimal' | 'metadata' | 'verbose'>('debugMode') ?? DEFAULT_DEBUG_MODE;

  return {
    baseUrl,
    maxTokens,
    requestTimeoutMs,
    debugMode
  };
}

export function getExtensionConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export function buildSettingsSnapshot(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>
): SettingsSnapshot {
  const issues: SettingsIssue[] = [];
  const rejectedModels: RejectedModelSetting[] = [];
  const rawDisplayModels = configuration.get<unknown>('displayModels');
  const { validKeys, invalidKeys } = collectConfiguredDisplayModelKeys(rawDisplayModels);

  for (const invalidKey of invalidKeys) {
    issues.push({
      scope: 'model',
      code: 'INVALID_DISPLAY_MODEL_KEY',
      message: `Unsupported display model key: ${invalidKey}`,
      modelKey: invalidKey
    });
  }

  const runtime = validateRuntimeSettings(configuration, issues);
  const displayModels: DisplayModelSetting[] = [];
  const publishedModels: PublishedModel[] = [];

  for (const key of validKeys) {
    const setting: DisplayModelSetting = {
      key,
      label: configuration.get<string>(`labels.${key}`)?.trim() || DEFAULT_MODEL_LABELS[key],
      comboId: configuration.get<string>(`modelMappings.${key}`)?.trim() || '',
      enabled: true,
      toolMode: configuration.get<'auto' | 'off'>(`toolMode.${key}`) ?? DEFAULT_TOOL_MODES[key],
      visionMode: configuration.get<'native' | 'proxy' | 'off'>(`visionMode.${key}`) ?? DEFAULT_VISION_MODES[key]
    };

    if (setting.comboId.length === 0) {
      const message = `Display model "${key}" is missing a valid 9router combo mapping.`;
      issues.push({
        scope: 'model',
        code: 'INVALID_COMBO_MAPPING',
        message,
        modelKey: key
      });
      rejectedModels.push({
        key,
        code: 'INVALID_COMBO_MAPPING',
        message
      });
      continue;
    }

    displayModels.push(setting);
    publishedModels.push(createPublishedModel(setting));
  }

  if (!runtime) {
    return {
      state: 'invalid-runtime',
      runtime: undefined,
      displayModels,
      publishedModels: [],
      rejectedModels,
      issues
    };
  }

  if (publishedModels.length === 0) {
    return {
      state: 'empty',
      runtime,
      displayModels,
      publishedModels,
      rejectedModels,
      issues
    };
  }

  return {
    state: rejectedModels.length > 0 || invalidKeys.length > 0 ? 'degraded' : 'valid',
    runtime,
    displayModels,
    publishedModels,
    rejectedModels,
    issues
  };
}

function validateRuntimeSettings(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
  issues: SettingsIssue[]
): RuntimeSettings | undefined {
  const baseUrlInput = configuration.get<string>('baseUrl') ?? DEFAULT_BASE_URL;
  const normalizedBaseUrl = baseUrlInput.trim().length > 0 ? normalizeBaseUrl(baseUrlInput) : '';

  if (!isValidBaseUrl(normalizedBaseUrl)) {
    issues.push({
      scope: 'runtime',
      code: 'INVALID_BASE_URL',
      message: 'The configured 9router base URL must be a valid http or https URL.'
    });
  }

  const requestTimeoutMs = configuration.get<number>('requestTimeoutMs') ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    issues.push({
      scope: 'runtime',
      code: 'INVALID_REQUEST_TIMEOUT',
      message: 'The request timeout must be a positive number of milliseconds.'
    });
  }

  const maxTokens = configuration.get<number>('maxTokens') ?? DEFAULT_MAX_TOKENS;
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    issues.push({
      scope: 'runtime',
      code: 'INVALID_MAX_TOKENS',
      message: 'The maxTokens setting must be a positive number.'
    });
  }

  const debugMode = configuration.get<'minimal' | 'metadata' | 'verbose'>('debugMode') ?? DEFAULT_DEBUG_MODE;

  if (issues.some((issue) => issue.scope === 'runtime')) {
    return undefined;
  }

  return {
    baseUrl: normalizedBaseUrl,
    maxTokens,
    requestTimeoutMs,
    debugMode
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

function createPublishedModel(setting: DisplayModelSetting): PublishedModel {
  const capabilities: PublishedModel['capabilities'] = {
    ...(setting.toolMode === 'auto' ? { toolCalling: 32 } : {}),
    ...(setting.visionMode === 'native' ? { imageInput: true } : {})
  };

  return {
    id: setting.key,
    name: setting.label,
    vendor: '9router',
    family: setting.key,
    version: '1',
    maxInputTokens: 128_000,
    maxOutputTokens: 8_192,
    capabilities
  };
}
