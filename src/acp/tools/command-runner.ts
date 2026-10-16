import { runLocalCommand } from './local-process-runner';
import { runClientTerminal } from './client-terminal-runner';
import type { ClientTerminalDelegate } from './client-terminal-runner';
import type { CommandExecutionResult } from './local-process-runner';

export interface CommandRunnerOptions {
  command: string;
  cwd: string;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  clientTerminal?: ClientTerminalDelegate | undefined;
}

export function runCommand(options: CommandRunnerOptions): Promise<CommandExecutionResult> {
  if (options.clientTerminal) {
    return runClientTerminal({
      command: options.command,
      cwd: options.cwd,
      terminalDelegate: options.clientTerminal,
      signal: options.signal
    });
  }

  return runLocalCommand({
    command: options.command,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
    signal: options.signal
  });
}
