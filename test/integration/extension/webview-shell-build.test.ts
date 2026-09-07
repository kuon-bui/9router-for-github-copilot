import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM build helpers, no type declarations.
import { WEBVIEW_VIEWS, createWebviewConfig } from '@root/scripts/vite-config.mjs';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * `index.html` is not in the module graph, so the build has to place it beside the bundle
 * itself. Watch mode must do this the same way production does, or panels open against a
 * missing shell and every command fails with an unrelated file-not-found error.
 */
async function buildViewOnce(view: string, watch: boolean): Promise<string> {
  const outDir = await mkdtemp(resolve(tmpdir(), `9router-${view}-`));
  tempRoots.push(outDir);

  const config = createWebviewConfig(view, { watch });
  config.build.outDir = outDir;

  const result = await build(config);
  if (watch) {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      result.on('event', (event: { code: string; error?: unknown }) => {
        if (event.code === 'END') {
          resolvePromise();
        } else if (event.code === 'ERROR') {
          rejectPromise(event.error);
        }
      });
    });
    await result.close();
  }

  return outDir;
}

describe('webview shell build', () => {
  const views = WEBVIEW_VIEWS as string[];

  for (const watch of [false, true]) {
    it.each(views)(
      `emits the %s panel shell beside the bundle (watch: ${watch})`,
      async (view) => {
        const outDir = await buildViewOnce(view, watch);

        await expect(readFile(resolve(outDir, 'client.js'), 'utf8')).resolves.toContain('function');
        await expect(readFile(resolve(outDir, 'index.html'), 'utf8')).resolves.toBe(
          await readFile(resolve(__dirname, `../../../src/webview/${view}/index.html`), 'utf8')
        );
      },
      30_000
    );
  }
});
