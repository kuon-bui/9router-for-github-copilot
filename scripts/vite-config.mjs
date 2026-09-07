import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Copies a panel's `index.html` shell next to its bundle.
 *
 * The shell is not in the module graph, so Vite neither emits it nor rebuilds on it, and
 * `emptyOutDir` deletes anything staged before the build. Copying from `writeBundle` runs
 * after the out dir is emptied and the bundle is written, so production and watch restore
 * the shell through the exact same step; `addWatchFile` covers edits to the shell itself.
 */
export function webviewShellPlugin(view) {
  const shell = resolve(root, `src/webview/${view}/index.html`);
  let outDir;

  return {
    name: '9router-webview-shell',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    buildStart() {
      this.addWatchFile(shell);
    },
    async writeBundle() {
      await cp(shell, resolve(root, outDir, 'index.html'));
    }
  };
}

/** Prints the markers `.vscode/tasks.json` gates the F5 launch on. */
export function watchMarkerPlugin(name, counter) {
  return {
    name: '9router-watch-markers',
    buildStart() {
      if (counter.pending === 0) {
        console.log(`[watch ${name}] build started`);
      }
      counter.pending += 1;
    },
    writeBundle() {
      counter.pending -= 1;
      if (counter.pending === 0) {
        console.log(`[watch ${name}] build finished`);
      }
    }
  };
}

export function createExtensionConfig({ watch = false, counter } = {}) {
  return {
    root,
    configFile: false,
    logLevel: 'info',
    plugins: counter ? [watchMarkerPlugin('Extension', counter)] : [],
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

const PREACT_ALIASES = {
  react: 'preact/compat',
  'react-dom': 'preact/compat',
  'react-dom/client': 'preact/compat/client',
  'react/jsx-runtime': 'preact/jsx-runtime',
  'react/jsx-dev-runtime': 'preact/jsx-dev-runtime'
};

const PANEL_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime'
];

const PANEL_GLOBALS = {
  react: 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOMClient',
  'react/jsx-runtime': 'JSXRuntime',
  'react/jsx-dev-runtime': 'JSXDevRuntime'
};

/** Shared Preact runtime for every webview panel IIFE. */
export function createPreactVendorConfig({ watch = false, counter } = {}) {
  return {
    root,
    configFile: false,
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    plugins: counter ? [watchMarkerPlugin('Preact Vendor', counter)] : [],
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
        ...PREACT_ALIASES
      }
    },
    build: {
      target: 'es2022',
      outDir: resolve(root, 'dist/webview/shared'),
      emptyOutDir: true,
      minify: true,
      sourcemap: watch,
      lib: {
        entry: resolve(root, 'src/webview/shared/preact-runtime.ts'),
        formats: ['iife'],
        name: 'NineRouterPreactVendor',
        fileName: () => 'preact.js'
      },
      watch: watch ? {} : null
    }
  };
}

/** Shared Tailwind + SCSS styles for every webview panel. */
export function createSharedStylesConfig({ watch = false, counter } = {}) {
  return {
    root,
    configFile: false,
    logLevel: 'info',
    plugins: [tailwindcss(), ...(counter ? [watchMarkerPlugin('Shared Styles', counter)] : [])],
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler'
        }
      }
    },
    build: {
      target: 'es2022',
      outDir: resolve(root, 'dist/webview/shared'),
      emptyOutDir: false,
      minify: true,
      sourcemap: watch,
      lib: {
        entry: resolve(root, 'src/webview/shared/ui.ts'),
        formats: ['es'],
        fileName: () => 'ui.js'
      },
      rollupOptions: {
        output: {
          assetFileNames: 'ui.[ext]'
        }
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
    plugins: [...plugins, webviewShellPlugin(view), ...(counter ? [watchMarkerPlugin(view, counter)] : [])],
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
        ...PREACT_ALIASES
      }
    },
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
        external: PANEL_EXTERNALS,
        output: {
          globals: PANEL_GLOBALS
        }
      },
      watch: watch ? {} : null
    }
  };
}

export const WEBVIEW_VIEWS = ['usage', 'model-editor'];
