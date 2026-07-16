import type * as vscode from 'vscode';

export function createAbortSignalFromToken(token: vscode.CancellationToken): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();

  if (token.isCancellationRequested) {
    controller.abort(new Error('VS Code request was cancelled'));

    return {
      signal: controller.signal,
      cleanup: () => undefined
    };
  }

  const subscription = token.onCancellationRequested(() => {
    controller.abort(new Error('VS Code request was cancelled'));
  });

  return {
    signal: controller.signal,
    cleanup: () => {
      subscription.dispose();
    }
  };
}
