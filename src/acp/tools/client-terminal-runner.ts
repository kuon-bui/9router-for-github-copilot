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
  const { terminalId } = await terminalDelegate.createTerminal({ command, cwd });

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
