import { build } from 'vite';
import { cp, watch as watchDir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  WEBVIEW_VIEWS,
  createExtensionConfig,
  createReactVendorConfig,
  createWebviewConfig
} from './vite-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const counter = { pending: 0 };

async function copyShell(view) {
  await cp(
    resolve(root, `src/webview/${view}/index.html`),
    resolve(root, `dist/webview/${view}/index.html`)
  );
}

await build(createExtensionConfig({ watch: true, counter }));
await build(createReactVendorConfig({ watch: true, counter }));

for (const view of WEBVIEW_VIEWS) {
  await copyShell(view);
  await build(createWebviewConfig(view, { watch: true, counter }));

  // Vite watches the module graph, and index.html is not in it.
  void (async () => {
    for await (const _event of watchDir(resolve(root, `src/webview/${view}`))) {
      await copyShell(view);
    }
  })();
}
