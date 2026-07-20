import * as vscode from 'vscode';
import { redactObject } from './redaction';
import { isVisionProxyConfigured } from '../config/settings';
import type { SettingsSnapshot } from '../config/settings';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';

const DEBUG_RANK: Record<DebugMode, number> = {
  minimal: 0,
  metadata: 1,
  verbose: 2
};

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('9router Copilot');
  return outputChannel;
}

export function logDebugEvent(
  debugMode: DebugMode,
  message: string,
  metadata?: Record<string, unknown>,
  threshold: DebugMode = 'metadata'
): void {
  if (DEBUG_RANK[debugMode] < DEBUG_RANK[threshold]) {
    return;
  }

  const serializedMetadata = metadata ? ` ${JSON.stringify(redactObject(metadata))}` : '';
  getOutputChannel().appendLine(`${message}${serializedMetadata}`);
}

export function showDiagnostics(): void {
  getOutputChannel().show(true);
}

export function formatSettingsSnapshotDiagnostics(snapshot: SettingsSnapshot): string[] {
  const publishedModels = snapshot.publishedModels.map((model) => model.id).join(', ') || 'none';
  const rejectedModels =
    snapshot.rejectedModels
      .map((model) => `${model.id ?? `entry-${model.sourceIndex ?? 'unknown'}`} (${model.code})`)
      .join(', ') || 'none';
  const issues =
    snapshot.issues
      .map((issue) => {
        const displayModelId = 'displayModelId' in issue ? issue.displayModelId : undefined;
        return `${issue.code}${displayModelId ? `:${displayModelId}` : ''}`;
      })
      .join(', ') || 'none';
  const thinkingModes =
    snapshot.models.map((model) => `${model.id}=${model.thinkingMode}`).join(', ') || 'none';
  const runtimeLine = snapshot.runtime
    ? `Runtime: ${JSON.stringify(
        redactObject({
          baseUrl: snapshot.runtime.baseUrl,
          requestTimeoutMs: snapshot.runtime.requestTimeoutMs,
          maxTokens: snapshot.runtime.maxTokens,
          debugMode: snapshot.runtime.debugMode,
          visionProxySource: snapshot.runtime.visionProxySource ?? 'none',
          visionProxyConfigured: isVisionProxyConfigured(snapshot.runtime)
        })
      )}`
    : 'Runtime: invalid';

  return [
    `Snapshot state: ${snapshot.state}`,
    runtimeLine,
    `Published models: ${publishedModels}`,
    `Thinking modes: ${thinkingModes}`,
    `Rejected models: ${rejectedModels}`,
    `Issues: ${issues}`
  ];
}

export function showSettingsSnapshotDiagnostics(snapshot: SettingsSnapshot): void {
  const channel = getOutputChannel();
  for (const line of formatSettingsSnapshotDiagnostics(snapshot)) {
    channel.appendLine(line);
  }
  channel.show(true);
}

export function disposeOutputChannel(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
