import { build } from 'vite';
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
const counter = { pending: 0 };

await build(createExtensionConfig({ watch: true, counter }));
await build(createPreactVendorConfig({ watch: true, counter }));
await build(createSharedStylesConfig({ watch: true, counter }));
await unlink(resolve(root, 'dist/webview/shared/ui.js')).catch(() => undefined);

for (const view of WEBVIEW_VIEWS) {
  await build(createWebviewConfig(view, { watch: true, counter }));
}
