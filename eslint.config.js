const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

const sharedGlobals = {
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Headers: 'readonly',
  ReadableStream: 'readonly',
  ReadableStreamDefaultReader: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  URL: 'readonly',
  __dirname: 'readonly',
  clearTimeout: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  setTimeout: 'readonly'
};

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'scripts/**',
      '*.vsix',
      // Vendored from microsoft/vscode; keep it in sync with upstream rather than reformatting it.
      'src/types/vscode.proposed.*.d.ts'
    ]
  },
  {
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: sharedGlobals
    }
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: sharedGlobals
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_'
        }
      ],
      'no-console': 'error',
      'no-unused-vars': 'off',
      'require-yield': 'off'
    }
  },
  {
    files: ['src/webview/**/*.ts', 'src/webview/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      },
      globals: {
        document: 'readonly',
        window: 'readonly',
        Element: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        Event: 'readonly',
        MessageEvent: 'readonly',
        acquireVsCodeApi: 'readonly'
      }
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'vscode', message: 'Webview code runs in the browser sandbox.' }],
          patterns: [{ group: ['node:*'], message: 'Webview code runs in the browser sandbox.' }]
        }
      ]
    }
  }
];
