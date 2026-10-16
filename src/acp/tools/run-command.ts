import { runCommand } from './command-runner';
import type { ClientTerminalDelegate } from './client-terminal-runner';
import type { ToolResult } from './read-file';

export interface RunCommandInput {
  command: string;
  timeout_ms?: number | undefined;
}

export interface RunCommandContext {
  cwd: string;
  signal?: AbortSignal | undefined;
  clientTerminal?: ClientTerminalDelegate | undefined;
}

export async function executeRunCommand(
  input: RunCommandInput,
  context: RunCommandContext
): Promise<ToolResult> {
  const timeoutMs = Math.min(Math.max(1000, input.timeout_ms ?? 120000), 600000);

  const result = await runCommand({
    command: input.command,
    cwd: context.cwd,
    timeoutMs,
    signal: context.signal,
    clientTerminal: context.clientTerminal
  });

  if (result.exitCode === 0) {
    return {
      ok: true,
      output: result.output.length > 0 ? result.output : '(command completed with no output)'
    };
  }

  return {
    ok: false,
    output: `Command failed with exit code ${result.exitCode}:\n${result.output}`
  };
}
