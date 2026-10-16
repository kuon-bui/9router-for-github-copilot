const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

const sharedGlobals = {
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Event: 'readonly',
  Headers: 'readonly',
  ReadableStream: 'readonly',
  ReadableStreamDefaultReader: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  TransformStream: 'readonly',
  URL: 'readonly',
  WritableStream: 'readonly',
  __dirname: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly'
};

module.exports = [
  {
    ignores: [
      'dist/**',
      'packages/*/dist/**',
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
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
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
          patterns: [
            { group: ['node:*'], message: 'Webview code runs in the browser sandbox.' },
            {
              group: ['@/runtime', '@/runtime/*'],
              message:
                'Webview code must consume browser-safe contracts, not extension runtime modules.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/acp/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/acp', '@/acp/**', '@agentclientprotocol/*', '@modelcontextprotocol/*'],
              message: 'Extension code must not import ACP agent modules or protocol SDKs.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/acp/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message: 'ACP agent code runs as a standalone CLI and must not import vscode.'
            },
            {
              name: '@/debug/output-channel',
              message: 'ACP agent code must not import extension output-channel.'
            }
          ],
          patterns: [
            {
              group: [
                '@/runtime',
                '@/runtime/**',
                '@/provider',
                '@/provider/**',
                '@/webview',
                '@/webview/**'
              ],
              message:
                'ACP agent code must not import extension runtime, provider, or webview modules.'
            },
            {
              group: [
                '@/config/model-*',
                '@/config/secret-store',
                '@/config/settings',
                '@/config/vision-proxy-prompt'
              ],
              message:
                'ACP agent code must not import extension settings or config modules other than defaults.'
            }
          ]
        }
      ]
    }
  }
];
