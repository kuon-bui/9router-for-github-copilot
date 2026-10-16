import type { CommandExecutionResult } from './local-process-runner';

export interface ClientTerminalDelegate {
  createTerminal: (params: { command: string; cwd: string }) => Promise<{ terminalId: string }>;
  waitForExit: (params: { terminalId: string }) => Promise<{ exitCode: number }>;
  getOutput: (params: { terminalId: string }) => Promise<{ output: string }>;
  killTerminal: (params: { terminalId: string }) => Promise<void>;
  releaseTerminal: (params: { terminalId: string }) => Promise<void>;
}

export interface ClientTerminalOptions {
  command: string;
  cwd: string;
  terminalDelegate: ClientTerminalDelegate;
  signal?: AbortSignal | undefined;
}

export async function runClientTerminal(options: ClientTerminalOptions): Promise<CommandExecutionResult> {
  const { command, cwd, terminalDelegate, signal } = options;

  let terminalId: string;
  try {
    const created = await terminalDelegate.createTerminal({ command, cwd });
    terminalId = created.terminalId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      output: `Failed to create client terminal: ${message}`,
      timedOut: false,
      aborted: false
    };
  }

  let aborted = false;
  const onAbort = async (): Promise<void> => {
    aborted = true;
    try {
      await terminalDelegate.killTerminal({ terminalId });
    } catch {
      // ignore
    }
  };

  if (signal) {
    if (signal.aborted) {
      await onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    const exitResult = await terminalDelegate.waitForExit({ terminalId });
    const outputResult = await terminalDelegate.getOutput({ terminalId });

    return {
      exitCode: aborted ? 1 : exitResult.exitCode,
      output: outputResult.output,
      timedOut: false,
      aborted
    };
  } finally {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
    try {
      await terminalDelegate.releaseTerminal({ terminalId });
    } catch {
      // ignore
    }
  }
}
