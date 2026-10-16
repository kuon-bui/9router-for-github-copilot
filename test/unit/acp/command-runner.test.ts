import { describe, expect, it } from 'vitest';
import { runLocalCommand } from '@/acp/tools/local-process-runner';
import { executeRunCommand } from '@/acp/tools/run-command';

describe('command-runner', () => {
  it('strips NINEROUTER_* environment variables from child process', async () => {
    process.env['NINEROUTER_API_KEY'] = 'sk-super-secret-key';
    process.env['NINEROUTER_BASE_URL'] = 'http://127.0.0.1:20128';

    const cmd = "node -e 'console.log(process.env.NINEROUTER_API_KEY ? 1 : 0)'";

    const res = await runLocalCommand({
      command: cmd,
      cwd: process.cwd()
    });

    expect(res.exitCode).toBe(0);
    expect(res.output.trim()).toBe('0');
  });

  it('runs command successfully and captures stdout', async () => {
    const cmd = process.platform === 'win32'
      ? 'node -e "console.log(40 + 2)"'
      : 'node -e \'console.log(40 + 2)\'';

    const res = await executeRunCommand({ command: cmd }, { cwd: process.cwd() });
    expect(res.ok).toBe(true);
    expect(res.output.trim()).toContain('42');
  });

  it('handles command failure with non-zero exit code', async () => {
    const cmd = process.platform === 'win32'
      ? 'node -e "process.exit(5)"'
      : 'node -e \'process.exit(5)\'';

    const res = await executeRunCommand({ command: cmd }, { cwd: process.cwd() });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('exit code 5');
  });

  it('kills process when abort signal fires', async () => {
    const controller = new AbortController();
    const sleepCmd = process.platform === 'win32'
      ? 'node -e "setTimeout(() => {}, 10000)"'
      : 'node -e "setTimeout(() => {}, 10000)"';

    const promise = runLocalCommand({
      command: sleepCmd,
      cwd: process.cwd(),
      signal: controller.signal
    });

    setTimeout(() => {
      controller.abort('timeout');
    }, 100);

    const res = await promise;
    expect(res.exitCode).not.toBe(0);
    expect(res.output).toContain('aborted');
  });
});
