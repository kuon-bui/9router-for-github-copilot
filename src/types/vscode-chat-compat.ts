import type * as vscode from 'vscode';

export interface LanguageModelConfigurationProperty {
  readonly type: 'string';
  readonly title: string;
  readonly enum: readonly string[];
  readonly enumItemLabels: readonly string[];
  readonly enumDescriptions?: readonly string[];
  readonly default: string;
  readonly group: 'navigation';
}

export interface LanguageModelConfigurationSchema {
  readonly properties: {
    readonly reasoningEffort: LanguageModelConfigurationProperty;
  };
}

export interface ModelConfigurationResponseOptions
  extends vscode.ProvideLanguageModelChatResponseOptions {
  readonly modelConfiguration?: Readonly<Record<string, unknown>>;
  readonly configuration?: Readonly<Record<string, unknown>>;
}
