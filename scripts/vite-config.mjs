import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Prints the markers `.vscode/tasks.json` gates the F5 launch on. */
export function watchMarkerPlugin(counter) {
  return {
    name: '9router-watch-markers',
    buildStart() {
      if (counter.pending === 0) {
        console.log('[watch] build started');
      }
      counter.pending += 1;
    },
    writeBundle() {
      counter.pending -= 1;
      if (counter.pending === 0) {
        console.log('[watch] build finished');
      }
    }
  };
}

export function createExtensionConfig({ watch = false, counter } = {}) {
  return {
    root,
    configFile: false,
    logLevel: 'info',
    plugins: counter ? [watchMarkerPlugin(counter)] : [],
    resolve: { alias: { '@': resolve(root, 'src') } },
    build: {
      target: 'node20',
      outDir: resolve(root, 'dist/src'),
      emptyOutDir: false,
      minify: !watch,
      sourcemap: watch,
      lib: {
        entry: resolve(root, 'src/extension.ts'),
        formats: ['cjs'],
        fileName: () => 'extension.js'
      },
      rollupOptions: {
        external: ['vscode', /^node:/]
      },
      watch: watch ? {} : null
    }
  };
}

export function createWebviewConfig(view, { watch = false, counter, plugins = [] } = {}) {
  return {
    root,
    configFile: false,
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    plugins: [tailwindcss(), ...plugins, ...(counter ? [watchMarkerPlugin(counter)] : [])],
    resolve: { alias: { '@': resolve(root, 'src') } },
    build: {
      target: 'es2022',
      outDir: resolve(root, `dist/webview/${view}`),
      emptyOutDir: true,
      minify: !watch,
      sourcemap: watch,
      lib: {
        entry: resolve(root, `src/webview/${view}/main.tsx`),
        formats: ['iife'],
        name: 'NineRouterWebview',
        fileName: () => 'client.js'
      },
      rollupOptions: {
        output: { assetFileNames: 'client.[ext]' }
      },
      watch: watch ? {} : null
    }
  };
}

export const WEBVIEW_VIEWS = ['usage', 'model-editor'];
