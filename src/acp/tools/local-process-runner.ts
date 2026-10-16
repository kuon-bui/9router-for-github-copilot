import { spawn } from 'node:child_process';
import { truncateOutput } from './output-limits';

export interface LocalCommandOptions {
  command: string;
  cwd: string;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface CommandExecutionResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
  aborted: boolean;
}

export function sanitizeEnvironment(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase().startsWith('NINEROUTER_')) {
      continue;
    }
    if (typeof value === 'string') {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function runLocalCommand(options: LocalCommandOptions): Promise<CommandExecutionResult> {
  return new Promise<CommandExecutionResult>((resolve) => {
    const { command, cwd, timeoutMs = 120000, signal } = options;
    const isWindows = process.platform === 'win32';

    const shell = isWindows ? 'powershell.exe' : '/bin/sh';
    const shellArgs = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', `& { ${command} }; exit $LASTEXITCODE`]
      : ['-c', command];

    const env = sanitizeEnvironment();
    let timedOut = false;
    let aborted = false;
    let output = '';

    const proc = spawn(shell, shellArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    const killProcessTree = (): void => {
      if (!proc.pid) {
        return;
      }
      if (isWindows) {
        try {
          spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {
          // ignore
        }
      }
      try {
        proc.kill();
      } catch {
        // ignore
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTree();
      }, timeoutMs);
    }

    const onAbort = (): void => {
      aborted = true;
      killProcessTree();
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    proc.on('close', (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }

      let finalOutput = output;
      if (timedOut) {
        finalOutput += `\n[Command timed out after ${timeoutMs} ms]`;
      } else if (aborted) {
        finalOutput += '\n[Command aborted by user]';
      }

      resolve({
        exitCode: timedOut || aborted ? 1 : (code ?? 0),
        output: truncateOutput(finalOutput),
        timedOut,
        aborted
      });
    });

    proc.on('error', (err) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }

      resolve({
        exitCode: 1,
        output: truncateOutput(`Failed to spawn command process: ${err.message}`),
        timedOut,
        aborted
      });
    });
  });
}
