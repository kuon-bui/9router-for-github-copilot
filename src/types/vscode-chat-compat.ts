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

/**
 * `LanguageModelThinkingPart` ships as the `languageModelThinkingPart` proposed API, so it is absent
 * on hosts that run the extension without that proposal enabled. Treating the host namespace as an
 * explicit dependency keeps the capability check testable and lets the emitter degrade safely.
 */
export interface ThinkingPartHost {
  readonly LanguageModelThinkingPart?: new (value: string | string[]) => unknown;
}
