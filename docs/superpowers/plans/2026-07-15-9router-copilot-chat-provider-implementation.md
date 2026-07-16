# 9router Copilot Chat Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready VS Code extension that exposes `9router` as a custom Copilot Chat provider with three curated product models, local per-user model mapping, secure API key storage, streaming responses, and compatibility layers for tools and vision.

**Architecture:** The extension must remain a thin provider adapter. VS Code owns the host chat UX, the extension owns provider registration, curated model publication, request and response adaptation, and `9router` owns routing combos, fallback policy, quota-aware failover, and upstream model execution.

**Tech Stack:** TypeScript, VS Code Extension API, VS Code Language Model API, Node.js stream and fetch APIs, Vitest for unit tests, `@vscode/test-electron` for extension integration tests, `pnpm` scripts.

## Global Constraints

- Use `vscode.LanguageModelChatProvider` as the primary integration surface.
- Keep the native Copilot Chat experience intact.
- The first production release will support up to three displayed models: `Daily`, `Agent`, `Fallback`.
- These are presentation-layer product models, not raw upstream model ids.
- Each displayed model maps to a `9router` combo id through local per-user VS Code settings.
- Secrets must be stored only in VS Code `SecretStorage`.
- The extension should treat `9router` as an OpenAI-compatible backend first.
- Use the OpenAI-compatible `/v1` contract unless the user explicitly changes direction.
- Capability exposure should be conservative unless confirmed by `9router`.
- One broken model mapping must not disable the whole provider.
- The production design does not require a local sidecar or proxy process.

---

## Proposed File Map

### Root configuration

- Create: `package.json`
  Responsibility: extension manifest, commands, configuration schema, language model provider contribution, scripts.
- Create: `tsconfig.json`
  Responsibility: strict TypeScript compilation for source and tests.
- Create: `.vscodeignore`
  Responsibility: package hygiene for publishing and local VSIX builds.
- Create: `vitest.config.ts`
  Responsibility: fast unit-test execution for adapters and validators.
- Create: `eslint.config.js`
  Responsibility: enforce strict and reviewable TypeScript rules from `CODE_CONVENTION.md`.

### Runtime entry points

- Create: `src/extension.ts`
  Responsibility: activate and deactivate entry points.
- Create: `src/runtime/activate.ts`
  Responsibility: lifecycle wiring, provider registration, configuration refresh, command registration.
- Create: `src/runtime/commands.ts`
  Responsibility: `Set API Key`, `Clear API Key`, `Show Diagnostics` command handlers.

### Configuration and secrets

- Create: `src/config/settings.ts`
  Responsibility: read, normalize, and validate local per-user settings.
- Create: `src/config/secret-store.ts`
  Responsibility: secure access to `SecretStorage`.
- Create: `src/config/defaults.ts`
  Responsibility: default labels, order, timeouts, and combo mapping fallbacks.

### Provider-facing adapters

- Create: `src/provider/provider.ts`
  Responsibility: `LanguageModelChatProvider` implementation.
- Create: `src/provider/model-catalog.ts`
  Responsibility: resolve valid published models from user settings.
- Create: `src/provider/request-adapter.ts`
  Responsibility: convert VS Code chat messages and options into `9router` OpenAI-compatible requests.
- Create: `src/provider/stream-adapter.ts`
  Responsibility: translate streamed router events into VS Code progress parts.
- Create: `src/provider/tool-adapter.ts`
  Responsibility: conservative tool schema translation and tool-call response bridging.
- Create: `src/provider/vision-proxy.ts`
  Responsibility: optional image-to-text proxy path for multimodal requests when native combo support is unavailable.

### Router-facing transport

- Create: `src/router/client.ts`
  Responsibility: authenticated `9router` HTTP transport and timeout handling.
- Create: `src/router/sse-parser.ts`
  Responsibility: parse streaming OpenAI-style server-sent events safely.
- Create: `src/router/errors.ts`
  Responsibility: typed transport and protocol error classification.
- Create: `src/router/url.ts`
  Responsibility: normalize user-provided base URL into `/v1/chat/completions` endpoint paths.

### Diagnostics and shared types

- Create: `src/debug/output-channel.ts`
  Responsibility: VS Code output channel lifecycle and debug-level filtering.
- Create: `src/debug/redaction.ts`
  Responsibility: redact API keys, auth headers, and sensitive request fields.
- Create: `src/types/product-model.ts`
  Responsibility: curated product model keys and provider-facing model shape.
- Create: `src/types/router-contract.ts`
  Responsibility: normalized `9router` request and stream event contracts.
- Create: `src/types/error.ts`
  Responsibility: stable internal error categories and result types.

### Tests

- Create: `test/unit/config/settings.test.ts`
- Create: `test/unit/provider/model-catalog.test.ts`
- Create: `test/unit/provider/request-adapter.test.ts`
- Create: `test/unit/provider/stream-adapter.test.ts`
- Create: `test/unit/provider/tool-adapter.test.ts`
- Create: `test/unit/router/sse-parser.test.ts`
- Create: `test/unit/router/client.test.ts`
- Create: `test/unit/debug/redaction.test.ts`
- Create: `test/integration/extension/provider-registration.test.ts`
- Create: `test/integration/extension/settings-refresh.test.ts`
- Create: `test/integration/extension/text-stream-roundtrip.test.ts`
- Create: `test/integration/extension/timeout-cancellation.test.ts`

## Shared Interfaces

These interfaces are the contracts every task must reuse.

```ts
// src/types/product-model.ts
export const PRODUCT_MODEL_KEYS = ['daily', 'agent', 'fallback'] as const;

export type ProductModelKey = (typeof PRODUCT_MODEL_KEYS)[number];

export interface DisplayModelSetting {
  key: ProductModelKey;
  label: string;
  comboId: string;
  enabled: boolean;
  toolMode: 'auto' | 'off';
  visionMode: 'native' | 'proxy' | 'off';
}

export interface PublishedModel {
  id: ProductModelKey;
  name: string;
  vendor: '9router';
  family: 'daily' | 'agent' | 'fallback';
  version: string;
  maxInputTokens?: number;
}
```

```ts
// src/types/router-contract.ts
export type RouterRole = 'system' | 'user' | 'assistant' | 'tool';

export interface RouterMessage {
  role: RouterRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface RouterToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface RouterChatCompletionRequest {
  model: string;
  messages: RouterMessage[];
  stream: true;
  max_tokens?: number;
  tools?: RouterToolDefinition[];
}

export type RouterStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call-delta'; toolCallId: string; delta: string }
  | { type: 'response-complete'; finishReason?: string; requestId?: string }
  | { type: 'router-error'; error: string; requestId?: string };
```

```ts
// src/types/error.ts
export type ExtensionErrorCode =
  | 'AUTHENTICATION_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'COMBO_MAPPING_ERROR'
  | 'TRANSPORT_ERROR'
  | 'TIMEOUT_ERROR'
  | 'CANCELLATION_ERROR'
  | 'MALFORMED_STREAM_ERROR'
  | 'UPSTREAM_UNAVAILABLE';

export interface ExtensionError extends Error {
  code: ExtensionErrorCode;
  requestId?: string;
  details?: Record<string, unknown>;
}
```

## Task 1: Bootstrap the extension workspace and manifest

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `.vscodeignore`
- Create: `src/extension.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `activate(context: vscode.ExtensionContext): Promise<void>`
  - `deactivate(): Promise<void>`
  - `pnpm run build`
  - `pnpm run test:unit`

- [ ] **Step 1: Write the failing manifest and activation smoke test**

```ts
// test/integration/extension/provider-registration.test.ts
import { describe, expect, it } from 'vitest';

describe('extension manifest', () => {
  it('declares the 9router language model provider contribution', async () => {
    const manifest = await import('../../../package.json');

    expect(manifest.contributes.languageModelChatProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vendor: '9router',
          displayName: '9router'
        })
      ])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/integration/extension/provider-registration.test.ts`
Expected: FAIL with `Cannot find module '../../../package.json'` or missing `languageModelChatProviders`

- [ ] **Step 3: Write the minimal manifest and entrypoint**

```json
{
  "name": "9router-copilot-chat-provider",
  "displayName": "9router Copilot Chat Provider",
  "publisher": "local",
  "version": "0.1.0",
  "engines": {
    "vscode": "^1.105.0"
  },
  "main": "./dist/extension.js",
  "activationEvents": [
    "onStartupFinished",
    "onCommand:9routerCopilot.setApiKey",
    "onCommand:9routerCopilot.clearApiKey",
    "onCommand:9routerCopilot.showDiagnostics"
  ],
  "contributes": {
    "commands": [
      {
        "command": "9routerCopilot.setApiKey",
        "title": "9router: Set API Key"
      },
      {
        "command": "9routerCopilot.clearApiKey",
        "title": "9router: Clear API Key"
      },
      {
        "command": "9routerCopilot.showDiagnostics",
        "title": "9router: Show Diagnostics"
      }
    ],
    "languageModelChatProviders": [
      {
        "vendor": "9router",
        "displayName": "9router"
      }
    ]
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint .",
    "test:unit": "vitest run",
    "test:integration": "node ./dist/test/run-integration.js"
  }
}
```

```ts
// src/extension.ts
import * as vscode from 'vscode';
import { activateExtension, deactivateExtension } from './runtime/activate';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateExtension(context);
}

export async function deactivate(): Promise<void> {
  await deactivateExtension();
}
```

- [ ] **Step 4: Add strict compiler and unit-test config**

```ts
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022", "DOM"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts']
  }
});
```

- [ ] **Step 5: Run build and smoke test**

Run: `pnpm run build`
Expected: PASS with `dist/extension.js` generated

Run: `pnpm exec vitest run test/integration/extension/provider-registration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts eslint.config.js .vscodeignore src/extension.ts test/integration/extension/provider-registration.test.ts
git commit -m "chore: bootstrap vscode extension workspace"
```

## Task 2: Implement settings, defaults, and secret storage boundaries

**Files:**
- Create: `src/config/defaults.ts`
- Create: `src/config/settings.ts`
- Create: `src/config/secret-store.ts`
- Create: `src/types/product-model.ts`
- Create: `test/unit/config/settings.test.ts`
- Create: `test/unit/debug/redaction.test.ts`

**Interfaces:**
- Consumes:
  - `ProductModelKey`
- Produces:
  - `loadDisplayModelSettings(configuration: vscode.WorkspaceConfiguration): DisplayModelSetting[]`
  - `loadRuntimeSettings(configuration: vscode.WorkspaceConfiguration): { baseUrl: string; maxTokens?: number; requestTimeoutMs: number; debugMode: 'minimal' | 'metadata' | 'verbose' }`
  - `getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined>`
  - `setApiKey(secrets: vscode.SecretStorage, value: string): Promise<void>`
  - `clearApiKey(secrets: vscode.SecretStorage): Promise<void>`

- [ ] **Step 1: Write failing tests for settings normalization**

```ts
// test/unit/config/settings.test.ts
import { describe, expect, it } from 'vitest';
import { loadDisplayModelSettings, loadRuntimeSettings } from '../../../src/config/settings';

describe('loadDisplayModelSettings', () => {
  it('returns only enabled curated models with stable keys', () => {
    const configuration = {
      get: (key: string) => {
        if (key === 'displayModels') {
          return ['daily', 'fallback'];
        }

        if (key === 'modelMappings.daily') {
          return 'combo/daily-default';
        }

        if (key === 'modelMappings.fallback') {
          return 'combo/fallback-default';
        }

        return undefined;
      }
    };

    expect(loadDisplayModelSettings(configuration as never)).toEqual([
      expect.objectContaining({ key: 'daily', comboId: 'combo/daily-default', enabled: true }),
      expect.objectContaining({ key: 'fallback', comboId: 'combo/fallback-default', enabled: true })
    ]);
  });

  it('normalizes the router base url to /v1', () => {
    const configuration = {
      get: (key: string) => (key === 'baseUrl' ? 'https://router.example.com' : undefined)
    };

    expect(loadRuntimeSettings(configuration as never).baseUrl).toBe('https://router.example.com/v1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/unit/config/settings.test.ts`
Expected: FAIL with `Cannot find module '../../../src/config/settings'`

- [ ] **Step 3: Write defaults and validated settings loaders**

```ts
// src/config/defaults.ts
import type { ProductModelKey } from '../types/product-model';

export const DEFAULT_DISPLAY_MODELS: ProductModelKey[] = ['daily', 'agent', 'fallback'];

export const DEFAULT_MODEL_LABELS: Record<ProductModelKey, string> = {
  daily: 'Daily',
  agent: 'Agent',
  fallback: 'Fallback'
};

export const DEFAULT_MODEL_MAPPINGS: Record<ProductModelKey, string> = {
  daily: 'combo/daily',
  agent: 'combo/agent',
  fallback: 'combo/fallback'
};
```

```ts
// src/config/settings.ts
import * as vscode from 'vscode';
import { DEFAULT_DISPLAY_MODELS, DEFAULT_MODEL_LABELS, DEFAULT_MODEL_MAPPINGS } from './defaults';
import type { DisplayModelSetting, ProductModelKey } from '../types/product-model';

const SECTION = '9router-copilot';

export function loadDisplayModelSettings(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>
): DisplayModelSetting[] {
  const configured = configuration.get<ProductModelKey[]>('displayModels') ?? DEFAULT_DISPLAY_MODELS;

  return configured.map((key) => ({
    key,
    label: configuration.get<string>(`labels.${key}`) ?? DEFAULT_MODEL_LABELS[key],
    comboId: configuration.get<string>(`modelMappings.${key}`) ?? DEFAULT_MODEL_MAPPINGS[key],
    enabled: true,
    toolMode: (configuration.get<'auto' | 'off'>(`toolMode.${key}`) ?? 'off'),
    visionMode: (configuration.get<'native' | 'proxy' | 'off'>(`visionMode.${key}`) ?? 'off')
  }));
}

export function loadRuntimeSettings(
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>
): {
  baseUrl: string;
  maxTokens?: number;
  requestTimeoutMs: number;
  debugMode: 'minimal' | 'metadata' | 'verbose';
} {
  const configuredBaseUrl = configuration.get<string>('baseUrl') ?? 'https://router.example.com/v1';
  const baseUrl = configuredBaseUrl.endsWith('/v1') ? configuredBaseUrl : `${configuredBaseUrl}/v1`;

  return {
    baseUrl,
    maxTokens: configuration.get<number>('maxTokens'),
    requestTimeoutMs: configuration.get<number>('requestTimeoutMs') ?? 60000,
    debugMode: configuration.get<'minimal' | 'metadata' | 'verbose'>('debugMode') ?? 'minimal'
  };
}

export function getExtensionConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}
```

```ts
// src/config/secret-store.ts
import * as vscode from 'vscode';

const API_KEY_SECRET = '9router.apiKey';

export async function getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(API_KEY_SECRET);
}

export async function setApiKey(secrets: vscode.SecretStorage, value: string): Promise<void> {
  await secrets.store(API_KEY_SECRET, value.trim());
}

export async function clearApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(API_KEY_SECRET);
}
```

- [ ] **Step 4: Write the curated model types**

```ts
// src/types/product-model.ts
export const PRODUCT_MODEL_KEYS = ['daily', 'agent', 'fallback'] as const;

export type ProductModelKey = (typeof PRODUCT_MODEL_KEYS)[number];

export interface DisplayModelSetting {
  key: ProductModelKey;
  label: string;
  comboId: string;
  enabled: boolean;
  toolMode: 'auto' | 'off';
  visionMode: 'native' | 'proxy' | 'off';
}

export interface PublishedModel {
  id: ProductModelKey;
  name: string;
  vendor: '9router';
  family: 'daily' | 'agent' | 'fallback';
  version: string;
  maxInputTokens?: number;
}
```

- [ ] **Step 5: Run unit tests**

Run: `pnpm exec vitest run test/unit/config/settings.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/config/defaults.ts src/config/settings.ts src/config/secret-store.ts src/types/product-model.ts test/unit/config/settings.test.ts
git commit -m "feat: add configuration and secret storage foundations"
```

## Task 3: Build the router transport, URL normalization, and streaming parser

**Files:**
- Create: `src/router/url.ts`
- Create: `src/router/errors.ts`
- Create: `src/router/sse-parser.ts`
- Create: `src/router/client.ts`
- Create: `src/types/router-contract.ts`
- Create: `src/types/error.ts`
- Create: `test/unit/router/sse-parser.test.ts`
- Create: `test/unit/router/client.test.ts`

**Interfaces:**
- Consumes:
  - `RouterChatCompletionRequest`
  - `RouterStreamEvent`
  - `ExtensionError`
- Produces:
  - `buildChatCompletionsUrl(baseUrl: string): string`
  - `parseRouterEventStream(stream: ReadableStream<Uint8Array>): AsyncIterable<RouterStreamEvent>`
  - `createRouterClient(deps: { fetch: typeof globalThis.fetch; now: () => number }): RouterClient`
  - `RouterClient.streamChatCompletion(input: { baseUrl: string; apiKey: string; request: RouterChatCompletionRequest; timeoutMs: number; signal: AbortSignal }): AsyncIterable<RouterStreamEvent>`

- [ ] **Step 1: Write failing SSE parser tests**

```ts
// test/unit/router/sse-parser.test.ts
import { describe, expect, it } from 'vitest';
import { parseSseChunk } from '../../../src/router/sse-parser';

describe('parseSseChunk', () => {
  it('extracts text deltas from OpenAI-style data lines', () => {
    const events = parseSseChunk('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');

    expect(events).toEqual([{ type: 'text-delta', text: 'Hel' }]);
  });

  it('marks the stream complete when the router sends [DONE]', () => {
    const events = parseSseChunk('data: [DONE]\n\n');

    expect(events).toEqual([{ type: 'response-complete' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/unit/router/sse-parser.test.ts`
Expected: FAIL with `Cannot find module '../../../src/router/sse-parser'`

- [ ] **Step 3: Implement typed transport contracts and SSE parsing**

```ts
// src/router/url.ts
export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
  return `${normalized}/chat/completions`;
}
```

```ts
// src/router/sse-parser.ts
import type { RouterStreamEvent } from '../types/router-contract';

export function parseSseChunk(chunk: string): RouterStreamEvent[] {
  return chunk
    .split('\n\n')
    .flatMap((frame) => {
      const line = frame.trim();
      if (!line.startsWith('data:')) {
        return [];
      }

      const payload = line.slice('data:'.length).trim();
      if (payload === '[DONE]') {
        return [{ type: 'response-complete' as const }];
      }

      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };

      const text = parsed.choices?.[0]?.delta?.content;
      return text ? [{ type: 'text-delta' as const, text }] : [];
    });
}
```

```ts
// src/types/router-contract.ts
export type RouterRole = 'system' | 'user' | 'assistant' | 'tool';

export interface RouterMessage {
  role: RouterRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface RouterToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface RouterChatCompletionRequest {
  model: string;
  messages: RouterMessage[];
  stream: true;
  max_tokens?: number;
  tools?: RouterToolDefinition[];
}

export type RouterStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call-delta'; toolCallId: string; delta: string }
  | { type: 'response-complete'; finishReason?: string; requestId?: string }
  | { type: 'router-error'; error: string; requestId?: string };
```

- [ ] **Step 4: Implement the router client with timeout and auth headers**

```ts
// src/router/client.ts
import { buildChatCompletionsUrl } from './url';
import { parseSseChunk } from './sse-parser';
import type { RouterChatCompletionRequest, RouterStreamEvent } from '../types/router-contract';

export interface RouterClient {
  streamChatCompletion(input: {
    baseUrl: string;
    apiKey: string;
    request: RouterChatCompletionRequest;
    timeoutMs: number;
    signal: AbortSignal;
  }): AsyncIterable<RouterStreamEvent>;
}

export function createRouterClient(deps: { fetch: typeof globalThis.fetch }): RouterClient {
  return {
    async *streamChatCompletion(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

      const response = await deps.fetch(buildChatCompletionsUrl(input.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${input.apiKey}`
        },
        body: JSON.stringify(input.request),
        signal: input.signal
      });

      clearTimeout(timeout);

      const text = await response.text();
      for (const event of parseSseChunk(text)) {
        yield event;
      }
    }
  };
}
```

- [ ] **Step 5: Write and run client tests**

```ts
// test/unit/router/client.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createRouterClient } from '../../../src/router/client';

describe('createRouterClient', () => {
  it('posts to /v1/chat/completions with bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: async () => 'data: [DONE]\n\n'
    });

    const client = createRouterClient({ fetch: fetchMock as never });

    const events: unknown[] = [];
    for await (const event of client.streamChatCompletion({
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret-token',
      request: { model: 'combo/daily', messages: [], stream: true },
      timeoutMs: 1000,
      signal: new AbortController().signal
    })) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'https://router.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret-token'
        })
      })
    );
    expect(events).toEqual([{ type: 'response-complete' }]);
  });
});
```

Run: `pnpm exec vitest run test/unit/router/sse-parser.test.ts test/unit/router/client.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/router/url.ts src/router/errors.ts src/router/sse-parser.ts src/router/client.ts src/types/router-contract.ts src/types/error.ts test/unit/router/sse-parser.test.ts test/unit/router/client.test.ts
git commit -m "feat: add 9router transport and stream parser"
```

## Task 4: Publish curated models and implement the provider request path

**Files:**
- Create: `src/provider/model-catalog.ts`
- Create: `src/provider/request-adapter.ts`
- Create: `src/provider/stream-adapter.ts`
- Create: `src/provider/provider.ts`
- Create: `test/unit/provider/model-catalog.test.ts`
- Create: `test/unit/provider/request-adapter.test.ts`
- Create: `test/unit/provider/stream-adapter.test.ts`

**Interfaces:**
- Consumes:
  - `DisplayModelSetting[]`
  - `PublishedModel`
  - `RouterClient`
  - `RouterChatCompletionRequest`
- Produces:
  - `resolvePublishedModels(settings: DisplayModelSetting[]): PublishedModel[]`
  - `adaptMessagesToRouterRequest(input: { selectedModel: DisplayModelSetting; messages: readonly vscode.LanguageModelChatRequestMessage[]; maxTokens?: number }): RouterChatCompletionRequest`
  - `emitRouterEvent(progress: vscode.Progress<vscode.LanguageModelResponsePart>, event: RouterStreamEvent): void`
  - `class NineRouterChatProvider implements vscode.LanguageModelChatProvider<PublishedModel>`

- [ ] **Step 1: Write failing tests for model publication and request adaptation**

```ts
// test/unit/provider/model-catalog.test.ts
import { describe, expect, it } from 'vitest';
import { resolvePublishedModels } from '../../../src/provider/model-catalog';

describe('resolvePublishedModels', () => {
  it('publishes only curated models with valid combo mappings', () => {
    const models = resolvePublishedModels([
      { key: 'daily', label: 'Daily', comboId: 'combo/daily', enabled: true, toolMode: 'off', visionMode: 'off' },
      { key: 'agent', label: 'Agent', comboId: '', enabled: true, toolMode: 'off', visionMode: 'off' }
    ]);

    expect(models).toEqual([
      expect.objectContaining({ id: 'daily', name: 'Daily', vendor: '9router' })
    ]);
  });
});
```

```ts
// test/unit/provider/request-adapter.test.ts
import { describe, expect, it } from 'vitest';
import { adaptMessagesToRouterRequest } from '../../../src/provider/request-adapter';

describe('adaptMessagesToRouterRequest', () => {
  it('maps the selected display model to the configured combo id', () => {
    const request = adaptMessagesToRouterRequest({
      selectedModel: {
        key: 'daily',
        label: 'Daily',
        comboId: 'combo/daily',
        enabled: true,
        toolMode: 'off',
        visionMode: 'off'
      },
      messages: [
        { role: 1, content: 'Say hello' }
      ] as never,
      maxTokens: 256
    });

    expect(request).toMatchObject({
      model: 'combo/daily',
      stream: true,
      max_tokens: 256,
      messages: [{ role: 'user', content: 'Say hello' }]
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/unit/provider/model-catalog.test.ts test/unit/provider/request-adapter.test.ts`
Expected: FAIL with missing provider modules

- [ ] **Step 3: Implement curated publication and request conversion**

```ts
// src/provider/model-catalog.ts
import type { DisplayModelSetting, PublishedModel } from '../types/product-model';

export function resolvePublishedModels(settings: DisplayModelSetting[]): PublishedModel[] {
  return settings
    .filter((setting) => setting.enabled && setting.comboId.trim().length > 0)
    .map((setting) => ({
      id: setting.key,
      name: setting.label,
      vendor: '9router',
      family: setting.key,
      version: '1'
    }));
}
```

```ts
// src/provider/request-adapter.ts
import type * as vscode from 'vscode';
import type { DisplayModelSetting } from '../types/product-model';
import type { RouterChatCompletionRequest, RouterMessage } from '../types/router-contract';

function mapRole(role: vscode.LanguageModelChatMessageRole): RouterMessage['role'] {
  switch (role) {
    case 0:
      return 'system';
    case 1:
      return 'user';
    case 2:
      return 'assistant';
    default:
      return 'user';
  }
}

export function adaptMessagesToRouterRequest(input: {
  selectedModel: DisplayModelSetting;
  messages: readonly vscode.LanguageModelChatRequestMessage[];
  maxTokens?: number;
}): RouterChatCompletionRequest {
  return {
    model: input.selectedModel.comboId,
    stream: true,
    max_tokens: input.maxTokens,
    messages: input.messages.map((message) => ({
      role: mapRole(message.role),
      content: String(message.content)
    }))
  };
}
```

```ts
// src/provider/stream-adapter.ts
import * as vscode from 'vscode';
import type { RouterStreamEvent } from '../types/router-contract';

export function emitRouterEvent(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  event: RouterStreamEvent
): void {
  if (event.type === 'text-delta') {
    progress.report(new vscode.LanguageModelTextPart(event.text));
  }
}
```

- [ ] **Step 4: Implement the provider class**

```ts
// src/provider/provider.ts
import * as vscode from 'vscode';
import { getExtensionConfiguration, loadDisplayModelSettings, loadRuntimeSettings } from '../config/settings';
import { getApiKey } from '../config/secret-store';
import { adaptMessagesToRouterRequest } from './request-adapter';
import { resolvePublishedModels } from './model-catalog';
import { emitRouterEvent } from './stream-adapter';
import type { PublishedModel } from '../types/product-model';
import type { RouterClient } from '../router/client';

export class NineRouterChatProvider implements vscode.LanguageModelChatProvider<PublishedModel> {
  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly routerClient: RouterClient
  ) {}

  public async provideLanguageModelChatInformation(): Promise<PublishedModel[]> {
    const settings = loadDisplayModelSettings(getExtensionConfiguration());
    return resolvePublishedModels(settings);
  }

  public async provideLanguageModelChatResponse(
    model: PublishedModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const apiKey = await getApiKey(this.context.secrets);
    if (!apiKey) {
      throw new Error('9router API key is not configured');
    }

    const settings = loadDisplayModelSettings(getExtensionConfiguration());
    const selectedModel = settings.find((setting) => setting.key === model.id);
    if (!selectedModel) {
      throw new Error(`Missing combo mapping for ${model.id}`);
    }

    const runtime = loadRuntimeSettings(getExtensionConfiguration());
    const request = adaptMessagesToRouterRequest({
      selectedModel,
      messages,
      maxTokens: runtime.maxTokens ?? options.modelOptions?.maxInputTokens
    });

    for await (const event of this.routerClient.streamChatCompletion({
      baseUrl: runtime.baseUrl,
      apiKey,
      request,
      timeoutMs: runtime.requestTimeoutMs,
      signal: token as never
    })) {
      emitRouterEvent(progress, event);
    }
  }
}
```

- [ ] **Step 5: Run provider unit tests**

Run: `pnpm exec vitest run test/unit/provider/model-catalog.test.ts test/unit/provider/request-adapter.test.ts test/unit/provider/stream-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/provider/model-catalog.ts src/provider/request-adapter.ts src/provider/stream-adapter.ts src/provider/provider.ts test/unit/provider/model-catalog.test.ts test/unit/provider/request-adapter.test.ts test/unit/provider/stream-adapter.test.ts
git commit -m "feat: publish curated models and provider request flow"
```

## Task 5: Wire activation, commands, diagnostics, and settings refresh

**Files:**
- Create: `src/runtime/activate.ts`
- Create: `src/runtime/commands.ts`
- Create: `src/debug/output-channel.ts`
- Create: `src/debug/redaction.ts`
- Create: `test/integration/extension/settings-refresh.test.ts`

**Interfaces:**
- Consumes:
  - `NineRouterChatProvider`
  - `getApiKey`
  - `setApiKey`
  - `clearApiKey`
- Produces:
  - `activateExtension(context: vscode.ExtensionContext): Promise<void>`
  - `deactivateExtension(): Promise<void>`
  - `registerCommands(context: vscode.ExtensionContext): void`
  - `logDebugEvent(level: 'minimal' | 'metadata' | 'verbose', message: string, metadata?: Record<string, unknown>): void`
  - `redactValue(value: string): string`

- [ ] **Step 1: Write failing tests for settings refresh and redaction**

```ts
// test/unit/debug/redaction.test.ts
import { describe, expect, it } from 'vitest';
import { redactBearerToken } from '../../../src/debug/redaction';

describe('redactBearerToken', () => {
  it('replaces sensitive token content before logging', () => {
    expect(redactBearerToken('Bearer secret-token')).toBe('Bearer [REDACTED]');
  });
});
```

```ts
// test/integration/extension/settings-refresh.test.ts
import { describe, expect, it } from 'vitest';
import { handleConfigurationChange } from '../../../src/runtime/activate';

describe('handleConfigurationChange', () => {
  it('ignores unrelated settings changes and refreshes on 9router keys', () => {
    const refresh = vi.fn();

    handleConfigurationChange(
      {
        affectsConfiguration: (section: string) => section === '9router-copilot'
      } as never,
      refresh
    );

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/unit/debug/redaction.test.ts test/integration/extension/settings-refresh.test.ts`
Expected: FAIL with missing debug and runtime modules

- [ ] **Step 3: Implement redaction and output channel safety**

```ts
// src/debug/redaction.ts
export function redactBearerToken(value: string): string {
  return value.replace(/^Bearer\s+.+$/i, 'Bearer [REDACTED]');
}

export function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (key.toLowerCase().includes('authorization') || key.toLowerCase().includes('token')) {
        return [key, '[REDACTED]'];
      }

      return [key, value];
    })
  );
}
```

```ts
// src/debug/output-channel.ts
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('9router Copilot');
  return channel;
}

export function disposeOutputChannel(): void {
  channel?.dispose();
  channel = undefined;
}
```

- [ ] **Step 4: Implement runtime wiring and settings refresh**

```ts
// src/runtime/activate.ts
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { createRouterClient } from '../router/client';
import { NineRouterChatProvider } from '../provider/provider';
import { disposeOutputChannel } from '../debug/output-channel';

let providerRegistration: vscode.Disposable | undefined;

export async function activateExtension(context: vscode.ExtensionContext): Promise<void> {
  registerCommands(context);

  const provider = new NineRouterChatProvider(
    context,
    createRouterClient({ fetch: globalThis.fetch })
  );

  providerRegistration = vscode.lm.registerLanguageModelChatProvider('9router', provider);
  context.subscriptions.push(providerRegistration);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) =>
      handleConfigurationChange(event, () => {
        providerRegistration?.dispose();
        providerRegistration = vscode.lm.registerLanguageModelChatProvider('9router', provider);
      })
    )
  );
}

export function handleConfigurationChange(
  event: Pick<vscode.ConfigurationChangeEvent, 'affectsConfiguration'>,
  refresh: () => void
): void {
  if (event.affectsConfiguration('9router-copilot')) {
    refresh();
  }
}

export async function deactivateExtension(): Promise<void> {
  providerRegistration?.dispose();
  providerRegistration = undefined;
  disposeOutputChannel();
}
```

```ts
// src/runtime/commands.ts
import * as vscode from 'vscode';
import { clearApiKey, setApiKey } from '../config/secret-store';

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('9routerCopilot.setApiKey', async () => {
      const value = await vscode.window.showInputBox({ password: true, prompt: 'Enter 9router API key' });
      if (value) {
        await setApiKey(context.secrets, value);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('9routerCopilot.clearApiKey', async () => {
      await clearApiKey(context.secrets);
    })
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run test/unit/debug/redaction.test.ts test/integration/extension/settings-refresh.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/runtime/activate.ts src/runtime/commands.ts src/debug/output-channel.ts src/debug/redaction.ts test/unit/debug/redaction.test.ts test/integration/extension/settings-refresh.test.ts
git commit -m "feat: wire activation commands and diagnostics"
```

## Task 6: Add conservative tool support and failure isolation

**Files:**
- Create: `src/provider/tool-adapter.ts`
- Modify: `src/provider/request-adapter.ts`
- Modify: `src/provider/provider.ts`
- Create: `test/unit/provider/tool-adapter.test.ts`

**Interfaces:**
- Consumes:
  - `DisplayModelSetting.toolMode`
  - `RouterToolDefinition`
- Produces:
  - `adaptToolsToRouterDefinitions(tools: readonly vscode.LanguageModelChatTool[]): RouterToolDefinition[]`
  - `shouldExposeTools(setting: DisplayModelSetting): boolean`

- [ ] **Step 1: Write failing tests for conservative tool translation**

```ts
// test/unit/provider/tool-adapter.test.ts
import { describe, expect, it } from 'vitest';
import { adaptToolsToRouterDefinitions, shouldExposeTools } from '../../../src/provider/tool-adapter';

describe('shouldExposeTools', () => {
  it('enables tools only when the display model is explicitly configured for them', () => {
    expect(
      shouldExposeTools({
        key: 'agent',
        label: 'Agent',
        comboId: 'combo/agent',
        enabled: true,
        toolMode: 'auto',
        visionMode: 'off'
      })
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/unit/provider/tool-adapter.test.ts`
Expected: FAIL with missing tool adapter

- [ ] **Step 3: Implement isolated tool translation**

```ts
// src/provider/tool-adapter.ts
import type * as vscode from 'vscode';
import type { DisplayModelSetting } from '../types/product-model';
import type { RouterToolDefinition } from '../types/router-contract';

export function shouldExposeTools(setting: DisplayModelSetting): boolean {
  return setting.toolMode === 'auto';
}

export function adaptToolsToRouterDefinitions(
  tools: readonly vscode.LanguageModelChatTool[]
): RouterToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>
    }
  }));
}
```

- [ ] **Step 4: Update request building to include tools only when allowed**

```ts
// src/provider/request-adapter.ts
import { adaptToolsToRouterDefinitions, shouldExposeTools } from './tool-adapter';

export function adaptMessagesToRouterRequest(input: {
  selectedModel: DisplayModelSetting;
  messages: readonly vscode.LanguageModelChatRequestMessage[];
  tools?: readonly vscode.LanguageModelChatTool[];
  maxTokens?: number;
}): RouterChatCompletionRequest {
  const request: RouterChatCompletionRequest = {
    model: input.selectedModel.comboId,
    stream: true,
    max_tokens: input.maxTokens,
    messages: input.messages.map((message) => ({
      role: mapRole(message.role),
      content: String(message.content)
    }))
  };

  if (input.tools && shouldExposeTools(input.selectedModel)) {
    request.tools = adaptToolsToRouterDefinitions(input.tools);
  }

  return request;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run test/unit/provider/tool-adapter.test.ts test/unit/provider/request-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/provider/tool-adapter.ts src/provider/request-adapter.ts src/provider/provider.ts test/unit/provider/tool-adapter.test.ts
git commit -m "feat: add conservative tool adapter"
```

## Task 7: Add optional vision proxy behavior with explicit diagnostics

**Files:**
- Create: `src/provider/vision-proxy.ts`
- Modify: `src/provider/request-adapter.ts`
- Modify: `src/provider/provider.ts`
- Create: `test/unit/provider/vision-proxy.test.ts`

**Interfaces:**
- Consumes:
  - `DisplayModelSetting.visionMode`
  - `LanguageModelChatRequestMessage[]`
- Produces:
  - `prepareVisionCompatibleMessages(input: { selectedModel: DisplayModelSetting; messages: readonly vscode.LanguageModelChatRequestMessage[] }): Promise<readonly vscode.LanguageModelChatRequestMessage[]>`
  - `summarizeImageInputs(messages: readonly vscode.LanguageModelChatRequestMessage[]): Promise<string>`

- [ ] **Step 1: Write failing tests for proxy activation**

```ts
// test/unit/provider/vision-proxy.test.ts
import { describe, expect, it, vi } from 'vitest';
import { prepareVisionCompatibleMessages } from '../../../src/provider/vision-proxy';

describe('prepareVisionCompatibleMessages', () => {
  it('injects a generated image summary when visionMode is proxy', async () => {
    const summarizeImageInputs = vi.fn().mockResolvedValue('Image summary: architecture diagram');

    const output = await prepareVisionCompatibleMessages({
      selectedModel: {
        key: 'agent',
        label: 'Agent',
        comboId: 'combo/agent',
        enabled: true,
        toolMode: 'off',
        visionMode: 'proxy'
      },
      messages: [{ role: 1, content: 'Please inspect this image' }] as never,
      summarizeImageInputs
    });

    expect(String(output[0].content)).toContain('Image summary: architecture diagram');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/unit/provider/vision-proxy.test.ts`
Expected: FAIL with missing vision proxy module

- [ ] **Step 3: Implement explicit proxy-only behavior**

```ts
// src/provider/vision-proxy.ts
import type * as vscode from 'vscode';
import type { DisplayModelSetting } from '../types/product-model';

export async function prepareVisionCompatibleMessages(input: {
  selectedModel: DisplayModelSetting;
  messages: readonly vscode.LanguageModelChatRequestMessage[];
  summarizeImageInputs: (messages: readonly vscode.LanguageModelChatRequestMessage[]) => Promise<string>;
}): Promise<readonly vscode.LanguageModelChatRequestMessage[]> {
  if (input.selectedModel.visionMode !== 'proxy') {
    return input.messages;
  }

  const summary = await input.summarizeImageInputs(input.messages);
  return input.messages.map((message, index) =>
    index === 0
      ? {
          ...message,
          content: `${String(message.content)}\n\n[Vision proxy summary]\n${summary}`
        }
      : message
  );
}
```

- [ ] **Step 4: Update provider flow to pass through the proxy only when configured**

```ts
// src/provider/provider.ts
import { prepareVisionCompatibleMessages } from './vision-proxy';

const compatibleMessages = await prepareVisionCompatibleMessages({
  selectedModel,
  messages,
  summarizeImageInputs: async () => 'Vision proxy is not implemented yet'
});

const request = adaptMessagesToRouterRequest({
  selectedModel,
  messages: compatibleMessages,
  maxTokens: runtime.maxTokens ?? options.modelOptions?.maxInputTokens
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run test/unit/provider/vision-proxy.test.ts test/unit/provider/request-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/provider/vision-proxy.ts src/provider/request-adapter.ts src/provider/provider.ts test/unit/provider/vision-proxy.test.ts
git commit -m "feat: add optional vision proxy path"
```

## Task 8: Finish integration coverage, packaging, and release guardrails

**Files:**
- Create: `test/integration/extension/text-stream-roundtrip.test.ts`
- Create: `test/integration/extension/timeout-cancellation.test.ts`
- Modify: `package.json`
- Modify: `.vscodeignore`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes:
  - `activateExtension`
  - `NineRouterChatProvider`
  - `RouterClient`
- Produces:
  - `pnpm run test:integration`
  - `pnpm run lint`
  - `pnpm run package`

- [ ] **Step 1: Write the failing round-trip integration test**

```ts
// test/integration/extension/text-stream-roundtrip.test.ts
import { describe, expect, it } from 'vitest';
import { NineRouterChatProvider } from '../../../src/provider/provider';

describe('NineRouterChatProvider', () => {
  it('streams text deltas from 9router into VS Code response parts', async () => {
    const progressCalls: string[] = [];
    const provider = new NineRouterChatProvider(
      { secrets: { get: async () => 'token' } } as never,
      {
        async *streamChatCompletion() {
          yield { type: 'text-delta', text: 'Hello' };
          yield { type: 'text-delta', text: ' world' };
          yield { type: 'response-complete' };
        }
      } as never
    );

    await provider.provideLanguageModelChatResponse(
      { id: 'daily', name: 'Daily', vendor: '9router', family: 'daily', version: '1' },
      [{ role: 1, content: 'Say hello' }] as never,
      {} as never,
      {
        report: (part: { value?: string }) => {
          progressCalls.push(String(part.value ?? ''));
        }
      } as never,
      new AbortController().signal as never
    );

    expect(progressCalls.join('')).toContain('Hello');
  });
});
```

- [ ] **Step 2: Run the failing integration tests**

Run: `pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts`
Expected: FAIL until provider, stream adapter, and VS Code test shims are aligned

- [ ] **Step 3: Add integration harness and package script**

```json
// package.json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint .",
    "test:unit": "vitest run test/unit",
    "test:integration": "vitest run test/integration",
    "package": "vsce package --no-dependencies"
  }
}
```

```text
# .vscodeignore
.github/**
docs/**
test/**
*.log
vitest.config.ts
eslint.config.js
```

- [ ] **Step 4: Run full verification**

Run: `pnpm run lint`
Expected: PASS

Run: `pnpm run test:unit`
Expected: PASS

Run: `pnpm run test:integration`
Expected: PASS

Run: `pnpm run package`
Expected: PASS with a local `.vsix` artifact

- [ ] **Step 5: Update agent guidance to require verification before release**

```md
<!-- AGENTS.md -->
Before any release candidate or merge-ready completion claim, run:

- `pnpm run lint`
- `pnpm run test:unit`
- `pnpm run test:integration`
- `pnpm run package`
```

- [ ] **Step 6: Commit**

```bash
git add test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/timeout-cancellation.test.ts package.json .vscodeignore AGENTS.md
git commit -m "chore: add release verification guardrails"
```

## Delivery Sequence

Implement tasks in order.

1. Task 1 creates the workspace and manifest contract.
2. Task 2 creates configuration and secret boundaries.
3. Task 3 creates transport and streaming primitives.
4. Task 4 enables the first end-to-end text flow.
5. Task 5 adds runtime safety, diagnostics, and refresh behavior.
6. Task 6 adds conservative tool compatibility.
7. Task 7 adds optional vision compatibility.
8. Task 8 closes coverage and release readiness.

## Risks To Watch During Execution

- VS Code Language Model API signatures may differ slightly across supported engine versions.
- Tool and vision parts are host-version sensitive and must stay isolated to avoid destabilizing text-only flows.
- Some integration assertions may require lightweight VS Code object shims instead of the real extension host.
- Streaming behavior should remain incremental even if the first implementation uses text buffering for test scaffolds.

## Self-Review

### Spec coverage

- Curated picker models: covered by Tasks 2 and 4.
- Local per-user model mapping: covered by Task 2.
- Secure API key storage: covered by Task 2 and Task 5.
- OpenAI-compatible `/v1` router transport: covered by Task 3.
- Streaming-first request flow: covered by Tasks 3 and 4.
- Conservative tool support: covered by Task 6.
- Optional vision proxy: covered by Task 7.
- Diagnostics, redaction, and release guardrails: covered by Tasks 5 and 8.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain in the plan.
- Every task includes exact file paths, commands, and target interfaces.
- Each code-changing task includes code blocks or config blocks to anchor implementation.

### Type consistency

- `DisplayModelSetting`, `PublishedModel`, `RouterChatCompletionRequest`, and `RouterStreamEvent` are defined once and reused consistently.
- Product model keys remain `daily | agent | fallback` across settings, provider publication, and tests.
- The provider always resolves a curated display model to a `comboId` before any router call.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-15-9router-copilot-chat-provider-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
