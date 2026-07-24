# 9router Model Context Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish each configured model's Context Window from `GET /v1/models`, retaining the latest successful catalog in RAM and falling back per field to configured values then `264000`.

**Architecture:** Generalize the existing authenticated Vision catalog request into one validated model-catalog operation. `NineRouterChatProvider` refreshes and caches that catalog during each `provideLanguageModelChatInformation` call, while pure publication code resolves exact `modelId` matches using catalog/config/default precedence. Existing model token fields remain optional compatibility fallbacks; routing, chat requests, usage reporting, and persistence remain unchanged.

**Tech Stack:** TypeScript 5, VS Code `LanguageModelChatProvider`, native `fetch`, Vitest 4, pnpm.

## Global Constraints

- Preserve the thin provider adapter architecture and keep `9router` as the only routing authority.
- Use authenticated `GET /v1/models`; do not use `GET /v1/models/info`.
- Match catalog entries only by exact `catalogItem.id === configuredModel.modelId` equality.
- Accept token metadata only as positive safe integers.
- Resolve each field independently: catalog, configured fallback, built-in `264000`.
- Keep the latest successfully parsed catalog in RAM only.
- A failed refresh keeps the previous catalog; first-refresh failure still publishes fallback metadata.
- Attempt at most one catalog request per `provideLanguageModelChatInformation` call.
- Missing API credentials skip catalog refresh and keep model publication available.
- Keep `models[].maxInputTokens` and `models[].maxOutputTokens` as optional compatibility fallbacks.
- Do not add timers, persisted cache, dependencies, combo introspection, or routing logic.
- Do not change `max_tokens`, usage reporting, `provideTokenCount`, or chat completion behavior.
- Do not leak API keys, auth headers, prompt content, or raw catalog bodies in diagnostics.
- Follow `CODE_CONVENTION.md` and `docs/superpowers/specs/2026-07-24-router-model-context-metadata-design.md`.
- Before claiming completion, run `pnpm run build`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, and `pnpm run package`.

## File Structure

- Modify `src/router/model-catalog.ts`: validate general 9router model metadata and derive the existing Vision-only view.
- Modify `src/router/client.ts`: expose one authenticated `listModels` catalog operation.
- Modify `src/runtime/vision-configuration.ts`: filter Vision choices from the general catalog.
- Modify `src/provider/model-catalog.ts`: apply catalog/config/default token precedence with exact model-id matching.
- Modify `src/provider/provider.ts`: refresh catalog per model-information call and retain latest successful catalog in RAM.
- Modify `src/config/defaults.ts`: omit manual token values from the default model object while retaining built-in fallback constants.
- Modify `package.json`: omit manual values from the default example and describe token fields as fallbacks.
- Modify `README.md`: document automatic catalog metadata and fallback behavior.
- Modify `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`: make 9router catalog metadata the primary Context Window source.
- Modify `docs/superpowers/specs/2026-07-17-per-model-context-window-settings-design.md`: mark configured values as compatibility fallbacks.
- Modify focused router, provider, runtime, integration, and release-guardrail tests listed in each task.

---

### Task 1: Generalize 9router Model Catalog Discovery

**Files:**
- Modify: `test/unit/router/model-catalog.test.ts`
- Modify: `test/unit/router/client.test.ts`
- Modify: `test/unit/runtime/vision-configuration.test.ts`
- Modify: `src/router/model-catalog.ts`
- Modify: `src/router/client.ts`
- Modify: `src/runtime/vision-configuration.ts`

**Interfaces:**
- Produces: `RouterModelMetadata` with `id`, optional `ownedBy`, optional literal `vision: true`, optional `contextWindow`, and optional `maxOutput`.
- Produces: `parseRouterModels(payload: unknown): RouterModelMetadata[]`.
- Produces: `toVisionModels(models: readonly RouterModelMetadata[]): RouterVisionModel[]`.
- Preserves: `parseVisionModels(payload: unknown): RouterVisionModel[]` as a pure compatibility wrapper.
- Replaces: `RouterClient.listVisionModels(...)` with `RouterClient.listModels(...): Promise<RouterModelMetadata[]>`.
- Consumes later: Tasks 2 and 3 use `RouterModelMetadata` and `RouterClient.listModels`.

- [ ] **Step 1: Add failing general catalog parser tests**

Replace the import in `test/unit/router/model-catalog.test.ts` with:

```ts
import {
  parseRouterModels,
  parseVisionModels,
  toVisionModels
} from '../../../src/router/model-catalog';
```

Add these tests before the existing `parseVisionModels` tests:

```ts
describe('parseRouterModels', () => {
  it('validates context metadata while retaining catalog models without capabilities', () => {
    expect(
      parseRouterModels({
        object: 'list',
        data: [
          {
            id: 'cx/gpt-5.6-sol',
            owned_by: 'cx',
            capabilities: {
              vision: true,
              contextWindow: 400_000,
              maxOutput: 128_000
            }
          },
          { id: 'router/combo' },
          {
            id: 'partial/model',
            capabilities: {
              contextWindow: 64_000,
              maxOutput: 0
            }
          },
          {
            id: 'invalid/model',
            capabilities: {
              contextWindow: 1.5,
              maxOutput: '8192'
            }
          },
          { id: '', capabilities: { contextWindow: 32_000 } },
          null
        ]
      })
    ).toEqual([
      {
        id: 'cx/gpt-5.6-sol',
        ownedBy: 'cx',
        vision: true,
        contextWindow: 400_000,
        maxOutput: 128_000
      },
      { id: 'invalid/model' },
      { id: 'partial/model', contextWindow: 64_000 },
      { id: 'router/combo' }
    ]);
  });

  it('merges duplicate ids without replacing earlier valid metadata', () => {
    expect(
      parseRouterModels({
        data: [
          { id: 'router/model', capabilities: { contextWindow: 128_000 } },
          {
            id: 'router/model',
            owned_by: 'router',
            capabilities: { vision: true, contextWindow: 64_000, maxOutput: 8_192 }
          }
        ]
      })
    ).toEqual([
      {
        id: 'router/model',
        ownedBy: 'router',
        vision: true,
        contextWindow: 128_000,
        maxOutput: 8_192
      }
    ]);
  });

  it.each([null, {}, { data: null }, { data: {} }])(
    'rejects malformed general catalog root %j',
    (payload) => {
      expect(() => parseRouterModels(payload)).toThrowError(
        expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' })
      );
    }
  );

  it('derives the Vision view from validated general metadata', () => {
    expect(
      toVisionModels([
        { id: 'router/text' },
        { id: 'router/vision', ownedBy: 'router', vision: true }
      ])
    ).toEqual([{ id: 'router/vision', ownedBy: 'router' }]);
  });
});
```

- [ ] **Step 2: Run parser tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/router/model-catalog.test.ts
```

Expected: FAIL because `parseRouterModels` and `toVisionModels` are not exported.

- [ ] **Step 3: Implement validated general catalog parsing**

Replace the Vision-specific internal parser in `src/router/model-catalog.ts` with the following public types and behavior. Keep `NineRouterError` as the only error type for malformed roots.

```ts
export interface RouterModelMetadata {
  id: string;
  ownedBy?: string;
  vision?: true;
  contextWindow?: number;
  maxOutput?: number;
}

export interface RouterVisionModel {
  id: string;
  ownedBy?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCatalogPayload(payload: unknown): payload is { data: unknown[] } {
  return isRecord(payload) && Array.isArray(payload.data);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function malformedCatalogError(): NineRouterError {
  return new NineRouterError(
    'UPSTREAM_UNAVAILABLE',
    '9router model catalog response is malformed',
    { details: { phase: 'model-catalog-discovery' } }
  );
}

function parseCatalogItem(item: unknown): RouterModelMetadata | undefined {
  if (!isRecord(item) || typeof item.id !== 'string') {
    return undefined;
  }

  const id = item.id.trim();
  if (id.length === 0) {
    return undefined;
  }

  const capabilities = isRecord(item.capabilities) ? item.capabilities : undefined;
  const ownedBy = typeof item.owned_by === 'string' ? item.owned_by.trim() : '';

  return {
    id,
    ...(ownedBy.length > 0 ? { ownedBy } : {}),
    ...(capabilities?.vision === true ? { vision: true as const } : {}),
    ...(isPositiveSafeInteger(capabilities?.contextWindow)
      ? { contextWindow: capabilities.contextWindow }
      : {}),
    ...(isPositiveSafeInteger(capabilities?.maxOutput)
      ? { maxOutput: capabilities.maxOutput }
      : {})
  };
}

function mergeCatalogItems(
  existing: RouterModelMetadata,
  candidate: RouterModelMetadata
): RouterModelMetadata {
  const ownedBy = existing.ownedBy ?? candidate.ownedBy;
  const contextWindow = existing.contextWindow ?? candidate.contextWindow;
  const maxOutput = existing.maxOutput ?? candidate.maxOutput;

  return {
    id: existing.id,
    ...(ownedBy ? { ownedBy } : {}),
    ...(existing.vision === true || candidate.vision === true
      ? { vision: true as const }
      : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutput !== undefined ? { maxOutput } : {})
  };
}

export function parseRouterModels(payload: unknown): RouterModelMetadata[] {
  if (!isCatalogPayload(payload)) {
    throw malformedCatalogError();
  }

  const byId = new Map<string, RouterModelMetadata>();
  for (const item of payload.data) {
    const parsed = parseCatalogItem(item);
    if (!parsed) {
      continue;
    }

    const existing = byId.get(parsed.id);
    byId.set(parsed.id, existing ? mergeCatalogItems(existing, parsed) : parsed);
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function toVisionModels(
  models: readonly RouterModelMetadata[]
): RouterVisionModel[] {
  return models
    .filter((model) => model.vision === true)
    .map((model) =>
      model.ownedBy ? { id: model.id, ownedBy: model.ownedBy } : { id: model.id }
    );
}

export function parseVisionModels(payload: unknown): RouterVisionModel[] {
  return toVisionModels(parseRouterModels(payload));
}
```

- [ ] **Step 4: Run parser tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/router/model-catalog.test.ts
```

Expected: PASS for general metadata, malformed roots, duplicate merging, and existing Vision behavior.

- [ ] **Step 5: Add failing generic client expectations**

In `test/unit/router/client.test.ts`, rename every `client.listVisionModels(...)` call to `client.listModels(...)`. Replace the test named `gets /v1/models with bearer auth and filters Vision models` with:

```ts
it('gets and validates the full /v1/models catalog with bearer auth', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      object: 'list',
      data: [
        {
          id: 'router/vision',
          owned_by: 'router',
          capabilities: {
            vision: true,
            contextWindow: 400_000,
            maxOutput: 128_000
          }
        },
        { id: 'router/text', capabilities: { vision: false } }
      ]
    })
  });

  const client = createRouterClient({ fetch: fetchMock as never });

  await expect(
    client.listModels({
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret-token',
      timeoutMs: 1000,
      signal: new AbortController().signal
    })
  ).resolves.toEqual([
    { id: 'router/text' },
    {
      id: 'router/vision',
      ownedBy: 'router',
      vision: true,
      contextWindow: 400_000,
      maxOutput: 128_000
    }
  ]);

  expect(fetchMock).toHaveBeenCalledWith(
    'https://router.example.com/v1/models',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ authorization: 'Bearer secret-token' })
    })
  );
});
```

Update malformed-catalog detail expectations from `vision-model-discovery` to `model-catalog-discovery`.

- [ ] **Step 6: Run client tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/router/client.test.ts
```

Expected: FAIL because `RouterClient` still exposes `listVisionModels` and still returns a Vision-filtered catalog.

- [ ] **Step 7: Replace the client Vision method with one general catalog method**

In `src/router/client.ts`:

1. Replace `parseVisionModels` with `parseRouterModels` in the value import.
2. Replace `RouterVisionModel` with `RouterModelMetadata` in the type import.
3. Replace the `listVisionModels` interface member with:

```ts
listModels(input: {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<RouterModelMetadata[]>;
```

4. Rename the implementation method to `listModels` and return `parseRouterModels(payload)`.
5. Change both discovery detail objects from:

```ts
{ phase: 'vision-model-discovery' }
```

to:

```ts
{ phase: 'model-catalog-discovery' }
```

Keep existing bearer auth, composite timeout/cancellation, request-id propagation, JSON parsing safety, and status classification unchanged.

- [ ] **Step 8: Adapt Vision configuration to the general catalog**

In `src/runtime/vision-configuration.ts`, add:

```ts
import { toVisionModels } from '../router/model-catalog';
```

Replace the existing discovery call with:

```ts
const models = toVisionModels(
  await dependencies.routerClient.listModels({
    baseUrl: runtime.baseUrl,
    apiKey,
    timeoutMs: runtime.requestTimeoutMs,
    signal: requestCancellation.signal
  })
);
```

In `test/unit/runtime/vision-configuration.test.ts`:

- Rename the override key `listVisionModels` to `listModels` in `createDependencies`.
- Rename the router-client mock member to `listModels`.
- Make the default return value `[{ id: 'router/vision', vision: true as const }]`.
- Replace each `listVisionModels: async () => ...` override with `listModels: async () => ...`.
- Return `[{ id: 'router/vision', vision: true as const }]` from successful overrides.

- [ ] **Step 9: Run router and Vision tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/router/model-catalog.test.ts test/unit/router/client.test.ts test/unit/runtime/vision-configuration.test.ts
```

Expected: PASS. Vision picker still lists only entries with explicit `vision: true`.

- [ ] **Step 10: Commit generic catalog boundary**

```bash
git add src/router/model-catalog.ts src/router/client.ts src/runtime/vision-configuration.ts test/unit/router/model-catalog.test.ts test/unit/router/client.test.ts test/unit/runtime/vision-configuration.test.ts
git commit -m "feat(router): expose model catalog metadata"
```

---

### Task 2: Resolve Published Token Metadata

**Files:**
- Modify: `test/unit/provider/model-catalog.test.ts`
- Modify: `src/provider/model-catalog.ts`

**Interfaces:**
- Consumes: `RouterModelMetadata` from Task 1.
- Extends: `PublishedModelOptions` with optional `routerModel?: RouterModelMetadata`.
- Produces: `ResolvePublishedModelsOptions` with optional `routerModels?: readonly RouterModelMetadata[]` and existing `visionProxyConfigured?: boolean`.
- Preserves: `createPublishedModel(setting, options): PublishedModel` and `resolvePublishedModels(settings, options): PublishedModel[]`.

- [ ] **Step 1: Add failing catalog-precedence tests**

Add these tests to `test/unit/provider/model-catalog.test.ts`:

```ts
it('prefers validated router metadata over configured fallback limits', () => {
  const model = createPublishedModel(
    {
      sourceIndex: 0,
      id: 'agent',
      name: 'Agent',
      modelId: 'cx/gpt-5.6-sol',
      toolMode: 'off',
      visionMode: 'off',
      thinkingMode: 'off',
      maxInputTokens: 64_000,
      maxOutputTokens: 8_192
    },
    {
      routerModel: {
        id: 'cx/gpt-5.6-sol',
        contextWindow: 400_000,
        maxOutput: 128_000
      }
    }
  );

  expect(model).toMatchObject({
    maxInputTokens: 400_000,
    maxOutputTokens: 128_000
  });
});

it('falls back independently when catalog metadata omits one field', () => {
  const model = createPublishedModel(
    {
      sourceIndex: 0,
      id: 'agent',
      name: 'Agent',
      modelId: 'router/agent',
      toolMode: 'off',
      visionMode: 'off',
      thinkingMode: 'off',
      maxInputTokens: 64_000,
      maxOutputTokens: 8_192
    },
    {
      routerModel: {
        id: 'router/agent',
        contextWindow: 400_000
      }
    }
  );

  expect(model).toMatchObject({
    maxInputTokens: 400_000,
    maxOutputTokens: 8_192
  });
});

it('matches catalog metadata by exact backend model id', () => {
  const settings = [
    {
      sourceIndex: 0,
      id: 'agent',
      name: 'Agent',
      modelId: 'cx/gpt-5.6-sol',
      toolMode: 'off',
      visionMode: 'off',
      thinkingMode: 'off',
      maxInputTokens: 264_000,
      maxOutputTokens: 264_000
    }
  ] as const;

  expect(
    resolvePublishedModels(settings as never, {
      routerModels: [
        { id: 'cx/gpt-5.6-sol-preview', contextWindow: 800_000, maxOutput: 256_000 },
        { id: 'cx/gpt-5.6-sol', contextWindow: 400_000, maxOutput: 128_000 }
      ]
    })[0]
  ).toMatchObject({
    maxInputTokens: 400_000,
    maxOutputTokens: 128_000
  });
});
```

Use a typed `ConfiguredModel[]` variable instead of `as never` if TypeScript rejects the readonly fixture; do not weaken production types.

- [ ] **Step 2: Run provider catalog tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/provider/model-catalog.test.ts
```

Expected: FAIL because publication options do not accept or apply router metadata.

- [ ] **Step 3: Implement pure field-level precedence**

Update `src/provider/model-catalog.ts` imports:

```ts
import type { RouterModelMetadata } from '../router/model-catalog';
import type { ConfiguredModel, PublishedModel } from '../types/product-model';
```

Use these option contracts:

```ts
export interface PublishedModelOptions {
  visionProxyConfigured?: boolean;
  routerModel?: RouterModelMetadata;
}

export interface ResolvePublishedModelsOptions {
  visionProxyConfigured?: boolean;
  routerModels?: readonly RouterModelMetadata[];
}
```

In `createPublishedModel`, replace token publication with:

```ts
maxInputTokens: options.routerModel?.contextWindow ?? setting.maxInputTokens,
maxOutputTokens: options.routerModel?.maxOutput ?? setting.maxOutputTokens,
```

Replace `resolvePublishedModels` with exact-id lookup:

```ts
export function resolvePublishedModels(
  settings: ConfiguredModel[],
  options: ResolvePublishedModelsOptions = {}
): PublishedModel[] {
  const routerModelsById = new Map(
    options.routerModels?.map((model) => [model.id, model] as const) ?? []
  );

  return settings.map((setting) => {
    const routerModel = routerModelsById.get(setting.modelId);

    return createPublishedModel(setting, {
      ...(options.visionProxyConfigured === true ? { visionProxyConfigured: true } : {}),
      ...(routerModel ? { routerModel } : {})
    });
  });
}
```

Avoid deriving model ids or reading combo internals. Parser validation from Task 1 guarantees catalog token fields are usable.

- [ ] **Step 4: Run provider catalog tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/provider/model-catalog.test.ts
```

Expected: PASS for catalog override, per-field fallback, exact matching, Vision capability, and Thinking Effort schema behavior.

- [ ] **Step 5: Commit publication precedence**

```bash
git add src/provider/model-catalog.ts test/unit/provider/model-catalog.test.ts
git commit -m "feat(provider): resolve router context metadata"
```

---

### Task 3: Refresh and Cache Catalog During Model Publication

**Files:**
- Modify: `test/integration/extension/settings-refresh.test.ts`
- Modify: `src/provider/provider.ts`

**Interfaces:**
- Consumes: `RouterClient.listModels` from Task 1.
- Consumes: `resolvePublishedModels(..., { routerModels })` from Task 2.
- Adds provider state: `private latestModelCatalog: readonly RouterModelMetadata[] | undefined`.
- Preserves: `provideLanguageModelChatInformation(options, token): Promise<PublishedModel[]>`.
- Preserves: invalid-runtime snapshots publish no models; missing credentials and discovery failures publish fallback models.

- [ ] **Step 1: Add failing provider refresh/cache tests**

In `test/integration/extension/settings-refresh.test.ts`, import `NineRouterError`:

```ts
import { NineRouterError } from '../../../src/router/errors';
```

Add these tests inside `describe('NineRouterChatProvider snapshot refresh', ...)`:

```ts
it('refreshes on every information call, retains failed cache, and replaces it after success', async () => {
  const listModels = vi
    .fn()
    .mockResolvedValueOnce([
      { id: 'router/coder', contextWindow: 400_000, maxOutput: 128_000 }
    ])
    .mockRejectedValueOnce(
      new NineRouterError('TRANSPORT_ERROR', 'catalog unavailable')
    )
    .mockResolvedValueOnce([
      { id: 'router/coder', contextWindow: 200_000, maxOutput: 64_000 }
    ]);
  const provider = new NineRouterChatProvider(
    context,
    { listModels, streamChatCompletion: routerClient.streamChatCompletion } as never,
    createSnapshot([
      {
        id: 'coder',
        name: 'Coder',
        modelId: 'router/coder',
        maxInputTokens: 32_000,
        maxOutputTokens: 2_048
      }
    ])
  );
  const token = __createCancellationToken().value as never;

  await expect(
    provider.provideLanguageModelChatInformation({} as never, token)
  ).resolves.toEqual([
    expect.objectContaining({ maxInputTokens: 400_000, maxOutputTokens: 128_000 })
  ]);
  await expect(
    provider.provideLanguageModelChatInformation({} as never, token)
  ).resolves.toEqual([
    expect.objectContaining({ maxInputTokens: 400_000, maxOutputTokens: 128_000 })
  ]);
  await expect(
    provider.provideLanguageModelChatInformation({} as never, token)
  ).resolves.toEqual([
    expect.objectContaining({ maxInputTokens: 200_000, maxOutputTokens: 64_000 })
  ]);

  expect(listModels).toHaveBeenCalledTimes(3);
  expect(listModels).toHaveBeenCalledWith(
    expect.objectContaining({
      baseUrl: 'http://127.0.0.1:3456/v1',
      apiKey: 'token',
      timeoutMs: 60_000,
      signal: expect.any(AbortSignal)
    })
  );
});

it('uses configured fallback metadata when the first catalog refresh fails', async () => {
  const provider = new NineRouterChatProvider(
    context,
    {
      listModels: vi.fn().mockRejectedValue(
        new NineRouterError('TRANSPORT_ERROR', 'catalog unavailable')
      ),
      streamChatCompletion: routerClient.streamChatCompletion
    } as never,
    createSnapshot([
      {
        id: 'coder',
        name: 'Coder',
        modelId: 'router/coder',
        maxInputTokens: 32_000,
        maxOutputTokens: 2_048
      }
    ])
  );

  await expect(
    provider.provideLanguageModelChatInformation(
      {} as never,
      __createCancellationToken().value as never
    )
  ).resolves.toEqual([
    expect.objectContaining({ maxInputTokens: 32_000, maxOutputTokens: 2_048 })
  ]);
});

it('skips discovery without an API key and uses built-in fallback metadata', async () => {
  const listModels = vi.fn();
  const provider = new NineRouterChatProvider(
    { secrets: { get: async () => undefined } } as never,
    { listModels, streamChatCompletion: routerClient.streamChatCompletion } as never,
    createSnapshot([
      { id: 'coder', name: 'Coder', modelId: 'router/coder' }
    ])
  );

  await expect(
    provider.provideLanguageModelChatInformation(
      {} as never,
      __createCancellationToken().value as never
    )
  ).resolves.toEqual([
    expect.objectContaining({ maxInputTokens: 264_000, maxOutputTokens: 264_000 })
  ]);
  expect(listModels).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run integration test and verify RED**

Run:

```bash
pnpm exec vitest run test/integration/extension/settings-refresh.test.ts
```

Expected: FAIL because model-information calls neither fetch nor cache the router catalog.

- [ ] **Step 3: Add provider RAM cache and best-effort refresh**

Update `src/provider/provider.ts` imports:

```ts
import { isVisionProxyConfigured } from '../config/settings';
import { createPublishedModel, resolvePublishedModels } from './model-catalog';
import type { RouterModelMetadata } from '../router/model-catalog';
```

Keep existing imports used elsewhere; remove only imports made unused by this change.

Add provider state:

```ts
private latestModelCatalog: readonly RouterModelMetadata[] | undefined;
```

Replace `provideLanguageModelChatInformation` with:

```ts
public async provideLanguageModelChatInformation(
  _options: vscode.PrepareLanguageModelChatModelOptions,
  token: vscode.CancellationToken
): Promise<PublishedModel[]> {
  const runtime = this.snapshot.runtime;
  if (!runtime || this.snapshot.models.length === 0) {
    return this.snapshot.publishedModels;
  }

  await this.refreshModelCatalog(runtime, token);

  return resolvePublishedModels(this.snapshot.models, {
    visionProxyConfigured: isVisionProxyConfigured(runtime),
    ...(this.latestModelCatalog
      ? { routerModels: this.latestModelCatalog }
      : {})
  });
}
```

Add this private method inside `NineRouterChatProvider`:

```ts
private async refreshModelCatalog(
  runtime: RuntimeSettings,
  token: vscode.CancellationToken
): Promise<void> {
  const startedAt = Date.now();

  try {
    const apiKey = await getApiKey(this.context.secrets);
    if (!apiKey) {
      return;
    }

    const requestCancellation = createAbortSignalFromToken(token);
    try {
      const catalog = await this.routerClient.listModels({
        baseUrl: runtime.baseUrl,
        apiKey,
        timeoutMs: runtime.requestTimeoutMs,
        signal: requestCancellation.signal
      });

      this.latestModelCatalog = catalog;
      logDebugEvent(runtime.debugMode, '9router model catalog refreshed', {
        modelCount: catalog.length,
        durationMs: Date.now() - startedAt
      });
    } finally {
      requestCancellation.cleanup();
    }
  } catch (error) {
    logDebugEvent(runtime.debugMode, '9router model catalog refresh failed', {
      errorCode: error instanceof NineRouterError ? error.code : 'UNKNOWN',
      requestId: error instanceof NineRouterError ? error.requestId : undefined,
      cached: this.latestModelCatalog !== undefined,
      durationMs: Date.now() - startedAt
    });
  }
}
```

Add `RuntimeSettings` to the existing type import from `../config/settings`. Do not log `error.message`, causes, response bodies, API keys, or headers.

If `createPublishedModel` is no longer referenced directly in `provider.ts`, do not import it; only `resolvePublishedModels` is needed there.

- [ ] **Step 4: Run provider integration test and verify GREEN**

Run:

```bash
pnpm exec vitest run test/integration/extension/settings-refresh.test.ts
```

Expected: PASS. Each information call attempts one refresh, failed refresh retains cache, successful refresh replaces cache, and missing credentials use fallback metadata.

- [ ] **Step 5: Run provider and transport regression suites**

Run:

```bash
pnpm exec vitest run test/unit/provider test/unit/router test/integration/extension/provider-registration.test.ts test/integration/extension/settings-refresh.test.ts
```

Expected: PASS. Invalid-runtime publication remains empty; Vision and chat behavior remain unchanged.

- [ ] **Step 6: Commit provider cache behavior**

```bash
git add src/provider/provider.ts test/integration/extension/settings-refresh.test.ts
git commit -m "feat(provider): cache router model metadata"
```

---

### Task 4: Make Manual Token Fields Compatibility Fallbacks

**Files:**
- Modify: `test/integration/extension/release-guardrails.test.ts`
- Modify: `src/config/defaults.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`
- Modify: `docs/superpowers/specs/2026-07-17-per-model-context-window-settings-design.md`

**Interfaces:**
- Preserves: `DEFAULT_MODEL_MAX_INPUT_TOKENS = 264_000`.
- Preserves: `DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 264_000`.
- Preserves: parser-normalized `ConfiguredModel.maxInputTokens` and `ConfiguredModel.maxOutputTokens` as required positive safe integers.
- Changes user contract: default model examples omit both fields; fields remain optional schema properties and configured fallbacks.

- [ ] **Step 1: Add failing manifest and documentation guardrails**

In the first test in `test/integration/extension/release-guardrails.test.ts`, replace the local `models` type with:

```ts
const models = properties['9router-copilot.models'] as {
  type: string;
  default: unknown[];
  items: {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: {
      maxInputTokens: Record<string, unknown>;
      maxOutputTokens: Record<string, unknown>;
    };
  };
};
```

Change the expected default model to:

```ts
default: [
  {
    id: 'agent',
    name: 'Agent',
    modelId: '',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off'
  }
],
```

Then add:

```ts
expect(models.items.properties.maxInputTokens).toMatchObject({
  type: 'integer',
  minimum: 1,
  default: 264_000,
  description: expect.stringContaining('fallback')
});
expect(models.items.properties.maxOutputTokens).toMatchObject({
  type: 'integer',
  minimum: 1,
  default: 264_000,
  description: expect.stringContaining('fallback')
});
```

In `documents the breaking dynamic model contract without legacy settings`, add:

```ts
for (const document of [readme, productionDesign]) {
  expect(document).toContain('capabilities.contextWindow');
  expect(document).toContain('capabilities.maxOutput');
  expect(document).toContain('latest successful');
  expect(document).toContain('264000');
}
expect(readme).toContain('compatibility fallback');
```

- [ ] **Step 2: Run release guardrails and verify RED**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: FAIL because default examples still include manual limits and current docs describe configured values as primary metadata.

- [ ] **Step 3: Remove limits from the default model object only**

In `src/config/defaults.ts`, keep both fallback constants unchanged and change `DEFAULT_MODELS` to:

```ts
export const DEFAULT_MODELS = [
  {
    id: 'agent',
    name: 'Agent',
    modelId: '',
    toolMode: 'auto',
    visionMode: 'off',
    thinkingMode: 'off'
  }
] as const;
```

`parseModelSettings` must continue filling absent fields from the two `264_000` constants. Existing parser tests already lock this behavior.

- [ ] **Step 4: Update manifest defaults and fallback descriptions**

In `package.json`:

- Remove `maxInputTokens` and `maxOutputTokens` from the single object under `9router-copilot.models.default`.
- Keep both properties under `items.properties`.
- Set their descriptions exactly to:

```json
"description": "Optional max-input-token fallback used when 9router catalog metadata is unavailable."
```

and:

```json
"description": "Optional max-output-token fallback used when 9router catalog metadata is unavailable."
```

Keep `type`, `minimum`, and `default` unchanged.

- [ ] **Step 5: Update README configuration and semantics**

Remove these lines from the JSON model example in `README.md`:

```json
"maxInputTokens": 128000,
"maxOutputTokens": 8192
```

Keep valid JSON by removing the comma after `"thinkingMode": "off"`.

Replace the model-field explanation for both limits with:

```md
- `maxInputTokens` and `maxOutputTokens`: Optional compatibility fallbacks for Context Window metadata. Normal operation reads `capabilities.contextWindow` and `capabilities.maxOutput` from authenticated `GET /v1/models` results.
```

Replace the paragraph beginning with `` `9router-copilot.maxTokens` is independent`` with text that states:

```md
Before returning picker models, the provider attempts one authenticated `GET /v1/models` refresh. Exact `modelId` matches use `capabilities.contextWindow` and `capabilities.maxOutput`. The latest successful catalog stays in RAM; a failed refresh keeps that cache. Missing or invalid metadata falls back per field to the model object's optional compatibility fallback, then `264000`.

`9router-copilot.maxTokens` remains independent of Context Window metadata. Its default is `0`. A positive safe integer is sent as `max_tokens`; `0` or a malformed value omits `max_tokens`, applying no extension-level response limit. `9router` or an upstream provider may still enforce its own limit. Streaming requests continue to set `stream_options.include_usage`.
```

- [ ] **Step 6: Update architecture documents without changing routing ownership**

In `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`:

- Change the per-user models list so `maxInputTokens` and `maxOutputTokens` are optional fallback fields.
- Replace the statement that every published model uses validated configured limits with the precedence contract: exact catalog `capabilities.contextWindow`/`capabilities.maxOutput`, configured fallback, then `264000`.
- Document one refresh per `provideLanguageModelChatInformation`, latest successful RAM cache retention, and failure-safe publication.
- Keep `9router-copilot.maxTokens`, usage reporting, and `provideTokenCount` text unchanged.
- Replace the Capability Model sentence saying future metadata may enrich the picker with a statement that Context Window metadata is now consumed, while tools, Vision, and reasoning capability policy remain conservative.

At the top of `docs/superpowers/specs/2026-07-17-per-model-context-window-settings-design.md`, add:

```md
> Superseded in part by `2026-07-24-router-model-context-metadata-design.md`: configured token limits remain compatibility fallbacks, while `GET /v1/models` metadata is the primary source.
```

Update its Objective, Configuration Contract, Architecture and Data Flow, and Non-Goals sections only where they claim configured limits are the primary source. Preserve historical implementation details and link to the newer design for final precedence.

- [ ] **Step 7: Run config and release tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/config/model-settings.test.ts test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts
```

Expected: PASS. Absent fields normalize to `264000`; explicit valid fields remain accepted; examples no longer require manual limits.

- [ ] **Step 8: Commit configuration and documentation contract**

```bash
git add src/config/defaults.ts package.json README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md docs/superpowers/specs/2026-07-17-per-model-context-window-settings-design.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: make token limits catalog-driven"
```

---

### Task 5: Full Verification Gate

**Files:**
- Verify all modified source, tests, manifest, README, and design documents.
- Do not modify files unless a verification failure is caused by this feature.

**Interfaces:**
- Verifies all acceptance criteria from `docs/superpowers/specs/2026-07-24-router-model-context-metadata-design.md`.
- Produces: buildable, lint-clean, tested, packageable VS Code extension.

- [ ] **Step 1: Run build**

```bash
pnpm run build
```

Expected: exit code `0`; no TypeScript errors.

- [ ] **Step 2: Run lint**

```bash
pnpm run lint
```

Expected: exit code `0`; no lint errors or warnings introduced by this feature.

- [ ] **Step 3: Run complete unit suite**

```bash
pnpm run test:unit
```

Expected: exit code `0`; all unit tests pass.

- [ ] **Step 4: Run complete integration suite**

```bash
pnpm run test:integration
```

Expected: exit code `0`; all integration tests pass.

- [ ] **Step 5: Build VSIX package**

```bash
pnpm run package
```

Expected: exit code `0`; VSIX is produced and package guardrails pass.

- [ ] **Step 6: Inspect final diff and status**

```bash
git diff --check
git status --short
git log --oneline -5
```

Expected: `git diff --check` prints nothing; only intentional uncommitted verification artifacts may appear. Remove generated VSIX if repository policy does not track it.

- [ ] **Step 7: Commit any verification-only fixes**

If verification required a source or test correction, stage only those corrected files and commit:

```bash
git commit -m "fix: complete router metadata integration"
```

Skip this commit when Step 6 shows no tracked changes.
