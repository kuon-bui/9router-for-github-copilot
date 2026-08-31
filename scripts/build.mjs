import { build } from 'vite';
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { unlink } from 'node:fs/promises';
import {
  WEBVIEW_VIEWS,
  createExtensionConfig,
  createPreactVendorConfig,
  createSharedStylesConfig,
  createWebviewConfig
} from './vite-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build(createExtensionConfig({}));
await build(createPreactVendorConfig({}));
await build(createSharedStylesConfig({}));
await unlink(resolve(root, 'dist/webview/shared/ui.js')).catch(() => undefined);

for (const view of WEBVIEW_VIEWS) {
  await build(createWebviewConfig(view, {}));
  await cp(
    resolve(root, `src/webview/${view}/index.html`),
    resolve(root, `dist/webview/${view}/index.html`)
  );
}
