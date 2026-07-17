import type * as vscode from 'vscode';
import type { LanguageModelConfigurationSchema } from './vscode-chat-compat';

export const PRODUCT_MODEL_KEYS = ['daily', 'agent', 'fallback'] as const;
export const THINKING_MODES = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const;

export type ProductModelKey = (typeof PRODUCT_MODEL_KEYS)[number];
export type ThinkingMode = (typeof THINKING_MODES)[number];

export interface DisplayModelSetting {
  key: ProductModelKey;
  label: string;
  comboId: string;
  enabled: boolean;
  toolMode: 'auto' | 'off';
  visionMode: 'native' | 'proxy' | 'off';
  thinkingMode: ThinkingMode;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface PublishedModel extends vscode.LanguageModelChatInformation {
  vendor: '9router';
  family: 'daily' | 'agent' | 'fallback';
  configurationSchema?: LanguageModelConfigurationSchema;
}
