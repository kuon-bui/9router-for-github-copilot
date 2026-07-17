import type * as vscode from 'vscode';
import type { LanguageModelConfigurationSchema } from './vscode-chat-compat';

export const THINKING_MODES = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const;

export type ThinkingMode = (typeof THINKING_MODES)[number];
export type ToolMode = 'auto' | 'off';
export type VisionMode = 'native' | 'proxy' | 'off';

export interface ConfiguredModel {
  sourceIndex: number;
  id: string;
  name: string;
  modelId: string;
  toolMode: ToolMode;
  visionMode: VisionMode;
  thinkingMode: ThinkingMode;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface PublishedModel extends vscode.LanguageModelChatInformation {
  vendor: '9router';
  family: string;
  configurationSchema?: LanguageModelConfigurationSchema;
}
