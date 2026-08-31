import { build } from 'vite';
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WEBVIEW_VIEWS, createExtensionConfig, createWebviewConfig } from './vite-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build(createExtensionConfig({}));

for (const view of WEBVIEW_VIEWS) {
  await build(createWebviewConfig(view, {}));
  await cp(
    resolve(root, `src/webview/${view}/index.html`),
    resolve(root, `dist/webview/${view}/index.html`)
  );
}
