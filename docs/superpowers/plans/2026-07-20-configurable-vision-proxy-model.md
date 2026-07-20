# Configurable Vision Proxy Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared configurable image-description prompt, selectable 9router or native GitHub Copilot analyzer, model Quick Pick, and automatic setup for unconfigured proxy image requests.

**Architecture:** Extend existing flat runtime settings, add strict 9router model-catalog parsing at router boundary, and centralize model selection in one runtime configurator. Keep `VisionProxyService` as orchestrator with two focused analyzer paths; provider invokes setup only for missing proxy source/model and then continues current request.

**Tech Stack:** TypeScript 5.6, VS Code Extension API 1.125, native `fetch`, Vitest 4, pnpm

## Global Constraints

- Preserve thin provider adapter architecture and keep 9router as routing authority.
- Add no runtime dependency, webview, model-name capability guessing, or local fallback policy.
- Use flat settings: `visionProxySource`, `visionProxyModelId`, `visionProxyPrompt`.
- Default prompt exactly matches previous built-in Vision instruction.
- `GET /v1/models` choices require `capabilities.vision === true`.
- Native Copilot choices come from `vscode.lm.selectChatModels({ vendor: 'copilot' })`; stable consumer API exposes no image capability field.
- Missing source/model opens one coalesced Quick Pick flow; success continues current request.
- Analyzer failure remains fail-closed; primary request never runs without every image summary.
- Never log API keys, prompt text, image bytes/data URLs, source text, or summaries.
- Use User target for settings written by guided setup.
- Keep one request cancellation path through setup, analysis, and primary request.
- Follow `CODE_CONVENTION.md`, `AGENTS.md`, and approved design spec.

---

## File Map

**Create**

- `src/router/model-catalog.ts` — validates and filters untrusted `/v1/models` payloads.
- `src/runtime/vision-configuration.ts` — source/model Quick Pick, User-setting writes, and in-flight setup coalescing.
- `src/provider/copilot-vision-analyzer.ts` — exact native model resolution, multimodal request construction, stream collection, and error mapping.
- `test/unit/router/model-catalog.test.ts` — strict catalog parsing tests.
- `test/unit/runtime/vision-configuration.test.ts` — guided setup tests.
- `test/unit/provider/copilot-vision-analyzer.test.ts` — native analyzer tests.

**Modify**

- `package.json` — command and three flat settings.
- `src/config/defaults.ts` — source and prompt defaults.
- `src/config/settings.ts` — source migration, prompt validation, capability publication.
- `src/router/url.ts` — `/v1/models` URL builder.
- `src/router/client.ts` — authenticated model-list request with existing timeout/cancellation semantics.
- `src/runtime/commands.ts` — configure command registration.
- `src/runtime/activate.ts` — shared router client/configurator wiring.
- `src/provider/vision-proxy.ts` — custom prompt and source-aware analyzer dispatch.
- `src/provider/provider.ts` — automatic missing-configuration flow and current-request continuation.
- `src/debug/output-channel.ts` — safe source/configured booleans only.
- `test/support/vscode.ts` — Quick Pick, configuration update, native model, and response-stream test doubles.
- `test/unit/config/settings.test.ts` — settings defaults, migration, validation, and publication.
- `test/unit/provider/vision-proxy.test.ts` — prompt forwarding and analyzer dispatch.
- `test/unit/router/client.test.ts` — model-list transport failures and cancellation.
- `test/integration/extension/diagnostics-command.test.ts` — safe diagnostics.
- `test/integration/extension/release-guardrails.test.ts` — manifest and documentation contract.
- `test/integration/extension/settings-refresh.test.ts` — source/model/prompt publication refresh.
- `test/integration/extension/text-stream-roundtrip.test.ts` — automatic setup, both analyzer sources, and fail-closed behavior.
- `README.md` — user configuration and troubleshooting.
- `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md` — canonical architecture update.

---

### Task 1: Runtime Settings and Manifest Contract

**Files:**
- Modify: `src/config/defaults.ts`
- Modify: `src/config/settings.ts`
- Modify: `package.json`
- Test: `test/unit/config/settings.test.ts`
- Test: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Produces: `VisionProxySource = '9router' | 'copilot'`
- Produces: `RuntimeSettings.visionProxySource: VisionProxySource | undefined`
- Produces: `RuntimeSettings.visionProxyPrompt: string`
- Produces: `isVisionProxyConfigured(runtime: RuntimeSettings): boolean`
- Consumes: existing `createPublishedModel(setting, { visionProxyConfigured })`

- [ ] **Step 1: Add failing settings tests**

Add imports and cases to `test/unit/config/settings.test.ts`:

```ts
import {
  DEFAULT_VISION_PROXY_PROMPT
} from '../../../src/config/defaults';
import {
  buildSettingsSnapshot,
  isVisionProxyConfigured,
  loadRuntimeSettings,
  normalizeBaseUrl,
  normalizeMaxTokens
} from '../../../src/config/settings';

it('loads default Vision prompt with no selected source', () => {
  const runtime = loadRuntimeSettings(configuration({}));

  expect(runtime.visionProxySource).toBeUndefined();
  expect(runtime.visionProxyModelId).toBe('');
  expect(runtime.visionProxyPrompt).toBe(DEFAULT_VISION_PROXY_PROMPT);
  expect(isVisionProxyConfigured(runtime)).toBe(false);
});

it('loads explicit source, model, and custom prompt', () => {
  const runtime = loadRuntimeSettings(configuration({
    visionProxySource: 'copilot',
    visionProxyModelId: 'copilot/gpt-vision',
    visionProxyPrompt: '  Extract visible UI details.  '
  }));

  expect(runtime).toMatchObject({
    visionProxySource: 'copilot',
    visionProxyModelId: 'copilot/gpt-vision',
    visionProxyPrompt: 'Extract visible UI details.'
  });
  expect(isVisionProxyConfigured(runtime)).toBe(true);
});

it('treats legacy model-only configuration as 9router', () => {
  const runtime = loadRuntimeSettings(configuration({
    visionProxyModelId: 'router/vision'
  }));

  expect(runtime.visionProxySource).toBe('9router');
});

it('does not advertise proxy image input with invalid source or blank prompt', () => {
  for (const values of [
    { visionProxySource: 'other', visionProxyModelId: 'model', visionProxyPrompt: 'prompt' },
    { visionProxySource: '9router', visionProxyModelId: 'model', visionProxyPrompt: '   ' }
  ]) {
    const snapshot = buildSettingsSnapshot(configuration({
      models: [{ id: 'agent', name: 'Agent', modelId: 'router/agent', visionMode: 'proxy' }],
      ...values
    }));

    expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBeUndefined();
    expect(snapshot.state).toBe('degraded');
  }
});
```

Update existing proxy-publication fixture to include explicit valid source and prompt.

- [ ] **Step 2: Add failing manifest assertions**

Extend `test/integration/extension/release-guardrails.test.ts`:

```ts
expect(properties['9router-copilot.visionProxySource']).toMatchObject({
  type: 'string',
  enum: ['', '9router', 'copilot'],
  default: ''
});
expect(properties['9router-copilot.visionProxyPrompt']).toMatchObject({
  type: 'string',
  minLength: 1
});
expect(manifest.contributes.commands).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ command: '9routerCopilot.configureVisionProxy' })
  ])
);
```

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm exec vitest run test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts`

Expected: FAIL because source, prompt, helper, command, and manifest settings do not exist.

- [ ] **Step 4: Add defaults and runtime parsing**

Add to `src/config/defaults.ts`:

```ts
export const DEFAULT_VISION_PROXY_SOURCE = '' as const;
export const DEFAULT_VISION_PROXY_MODEL_ID = '';
export const DEFAULT_VISION_PROXY_PROMPT =
  'Describe the supplied images faithfully for another language model. Include visible text, code, tables, diagrams, layout, and uncertainty. Do not answer the user request; provide only image context.';
```

In `src/config/settings.ts`, import new defaults and add:

```ts
export type VisionProxySource = '9router' | 'copilot';

export interface RuntimeSettings {
  baseUrl: string;
  maxTokens?: number;
  requestTimeoutMs: number;
  debugMode: 'minimal' | 'metadata' | 'verbose';
  visionProxySource: VisionProxySource | undefined;
  visionProxyModelId: string;
  visionProxyPrompt: string;
}

export function normalizeVisionProxySource(
  source: unknown,
  modelId: string
): VisionProxySource | undefined {
  if (source === '9router' || source === 'copilot') {
    return source;
  }

  return source === undefined && modelId.length > 0 ? '9router' : undefined;
}

export function isVisionProxyConfigured(runtime: RuntimeSettings): boolean {
  return (
    runtime.visionProxySource !== undefined &&
    runtime.visionProxyModelId.length > 0 &&
    runtime.visionProxyPrompt.length > 0
  );
}
```

Inside `loadRuntimeSettings`, read model first, then source and prompt:

```ts
const visionProxyModelId =
  configuration.get<string>('visionProxyModelId')?.trim() ??
  DEFAULT_VISION_PROXY_MODEL_ID;
const visionProxySource = normalizeVisionProxySource(
  configuration.get<unknown>('visionProxySource'),
  visionProxyModelId
);
const visionProxyPrompt =
  configuration.get<string>('visionProxyPrompt')?.trim() ??
  DEFAULT_VISION_PROXY_PROMPT;
```

Return all three fields. In `buildSettingsSnapshot`, derive publication from `runtime ? isVisionProxyConfigured(runtime) : false`. Add capability issues for explicit invalid source, empty model, and blank prompt without making unrelated text models unavailable.

- [ ] **Step 5: Add manifest properties and command**

Add command to `package.json`:

```json
{
  "command": "9routerCopilot.configureVisionProxy",
  "title": "9router: Configure Vision Proxy"
}
```

Add settings beside `visionProxyModelId`:

```json
"9router-copilot.visionProxySource": {
  "type": "string",
  "enum": ["", "9router", "copilot"],
  "enumDescriptions": [
    "Not configured.",
    "Use a Vision-capable model exposed by 9router.",
    "Use a native GitHub Copilot model."
  ],
  "default": "",
  "description": "Source used to describe images for models configured with visionMode proxy."
},
"9router-copilot.visionProxyPrompt": {
  "type": "string",
  "minLength": 1,
  "default": "Describe the supplied images faithfully for another language model. Include visible text, code, tables, diagrams, layout, and uncertainty. Do not answer the user request; provide only image context.",
  "description": "Complete prompt used by the selected Vision proxy model to describe image-bearing messages."
}
```

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit settings contract**

Run:

```bash
git add package.json src/config/defaults.ts src/config/settings.ts test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts
git commit -m "feat(config): add vision proxy settings"
```

---

### Task 2: 9router Vision Model Discovery

**Files:**
- Create: `src/router/model-catalog.ts`
- Modify: `src/router/url.ts`
- Modify: `src/router/client.ts`
- Create: `test/unit/router/model-catalog.test.ts`
- Modify: `test/unit/router/client.test.ts`

**Interfaces:**
- Produces: `RouterVisionModel { id: string; ownedBy?: string }`
- Produces: `parseVisionModels(payload: unknown): RouterVisionModel[]`
- Produces: `RouterClient.listVisionModels(input): Promise<RouterVisionModel[]>`
- Produces: `buildModelsUrl(baseUrl: string): string`

- [ ] **Step 1: Write failing pure parser tests**

Create `test/unit/router/model-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseVisionModels } from '../../../src/router/model-catalog';

 describe('parseVisionModels', () => {
  it('keeps only explicit boolean Vision capability, deduplicated and sorted', () => {
    expect(parseVisionModels({
      object: 'list',
      data: [
        { id: 'z/model', owned_by: 'z', capabilities: { vision: true } },
        { id: 'a/model', owned_by: 'a', capabilities: { vision: true } },
        { id: 'z/model', owned_by: 'z', capabilities: { vision: true } },
        { id: 'no/caps' },
        { id: 'false/vision', capabilities: { vision: false } },
        { id: 'truthy/vision', capabilities: { vision: 1 } },
        { id: '', capabilities: { vision: true } }
      ]
    })).toEqual([
      { id: 'a/model', ownedBy: 'a' },
      { id: 'z/model', ownedBy: 'z' }
    ]);
  });

  it.each([null, {}, { data: null }, { data: {} }])(
    'rejects malformed root %j',
    (payload) => {
      expect(() => parseVisionModels(payload)).toThrowError(
        expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' })
      );
    }
  );
});
```

- [ ] **Step 2: Write failing transport tests**

Add to `test/unit/router/client.test.ts`:

```ts
it('gets /v1/models with bearer auth and filters Vision models', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      object: 'list',
      data: [
        { id: 'router/vision', capabilities: { vision: true } },
        { id: 'router/text', capabilities: { vision: false } }
      ]
    })
  });
  const client = createRouterClient({ fetch: fetchMock as never });

  await expect(client.listVisionModels({
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'secret-token',
    timeoutMs: 1000,
    signal: new AbortController().signal
  })).resolves.toEqual([{ id: 'router/vision' }]);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://router.example.com/v1/models',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ authorization: 'Bearer secret-token' })
    })
  );
});
```

Also add one non-OK, one timeout, and one caller-cancellation case expecting existing `NineRouterError` codes.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm exec vitest run test/unit/router/model-catalog.test.ts test/unit/router/client.test.ts`

Expected: FAIL because parser, URL builder, and client method do not exist.

- [ ] **Step 4: Implement strict catalog parser**

Create `src/router/model-catalog.ts`:

```ts
import { NineRouterError } from './errors';

export interface RouterVisionModel {
  id: string;
  ownedBy?: string;
}

export function parseVisionModels(payload: unknown): RouterVisionModel[] {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('data' in payload) ||
    !Array.isArray(payload.data)
  ) {
    throw new NineRouterError(
      'UPSTREAM_UNAVAILABLE',
      '9router model catalog response is malformed',
      { details: { phase: 'vision-model-discovery' } }
    );
  }

  const byId = new Map<string, RouterVisionModel>();
  for (const item of payload.data) {
    if (typeof item !== 'object' || item === null) continue;
    if (!('id' in item) || typeof item.id !== 'string') continue;
    if (!('capabilities' in item) || typeof item.capabilities !== 'object' || item.capabilities === null) continue;
    if (!('vision' in item.capabilities) || item.capabilities.vision !== true) continue;

    const id = item.id.trim();
    if (id.length === 0) continue;
    const ownedBy = 'owned_by' in item && typeof item.owned_by === 'string'
      ? item.owned_by.trim()
      : '';
    byId.set(id, ownedBy.length > 0 ? { id, ownedBy } : { id });
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
```

- [ ] **Step 5: Add URL and client method**

Add to `src/router/url.ts`:

```ts
export function buildModelsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  const versionedBaseUrl = normalizedBaseUrl.endsWith('/v1')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1`;
  return `${versionedBaseUrl}/models`;
}
```

Extend `RouterClient` in `src/router/client.ts`:

```ts
listVisionModels(input: {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<RouterVisionModel[]>;
```

Implement GET using `createCompositeAbortSignal`, `buildModelsUrl`, bearer auth, `response.json()`, and `parseVisionModels`. Map `401/403` to `AUTHENTICATION_ERROR`, timeout to `TIMEOUT_ERROR`, caller abort to `CANCELLATION_ERROR`, non-OK status to `TRANSPORT_ERROR`, and invalid JSON/root to safe `UPSTREAM_UNAVAILABLE`. Never retain raw response text in discovery error details.

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run test/unit/router/model-catalog.test.ts test/unit/router/client.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit model discovery**

Run:

```bash
git add src/router/model-catalog.ts src/router/url.ts src/router/client.ts test/unit/router/model-catalog.test.ts test/unit/router/client.test.ts
git commit -m "feat(router): discover vision models"
```

---

### Task 3: Guided Vision Configuration

**Files:**
- Create: `src/runtime/vision-configuration.ts`
- Modify: `src/runtime/commands.ts`
- Modify: `test/support/vscode.ts`
- Create: `test/unit/runtime/vision-configuration.test.ts`
- Modify: `test/integration/extension/diagnostics-command.test.ts`

**Interfaces:**
- Consumes: `RouterClient.listVisionModels(...)`
- Produces: `VisionProxySelection { source: VisionProxySource; modelId: string }`
- Produces: `VisionProxyConfigurator = (token: vscode.CancellationToken) => Promise<VisionProxySelection | undefined>`
- Produces: `createVisionProxyConfigurator(dependencies): VisionProxyConfigurator`
- Produces: command dependency `configureVisionProxy`

- [ ] **Step 1: Extend VS Code test double**

Add controllable Quick Pick, configuration updates, native models, and model selection to `test/support/vscode.ts`:

```ts
let quickPickValues: unknown[] = [];
let selectedChatModels: unknown[] = [];
const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];

export const ConfigurationTarget = { Global: 1 } as const;

export class LanguageModelChatMessage {
  public static User(content: unknown[]): LanguageModelChatMessage {
    return new LanguageModelChatMessage(1, content);
  }

  public constructor(
    public readonly role: number,
    public readonly content: unknown[]
  ) {}
}

export class CancellationTokenSource {
  private readonly state = __createCancellationToken();
  public readonly token = this.state.value;

  public cancel(): void {
    this.state.cancel();
  }

  public dispose(): void {}
}

export const window = {
  createOutputChannel(): OutputChannel { return outputChannel; },
  async showInputBox(): Promise<string | undefined> { return inputBoxValue; },
  async showQuickPick(): Promise<unknown> { return quickPickValues.shift(); }
};

export const workspace = {
  getConfiguration(): {
    get: <T>(key: string) => T | undefined;
    update: (key: string, value: unknown, target: unknown) => Promise<void>;
  } {
    return {
      get<T>(key: string): T | undefined {
        return configurationValues.get(key) as T | undefined;
      },
      async update(key: string, value: unknown, target: unknown): Promise<void> {
        configurationValues.set(key, value);
        configurationUpdates.push({ key, value, target });
      }
    };
  }
};

export const lm = {
  registerLanguageModelChatProvider(_vendor: string, provider: unknown): Disposable {
    registeredProvider = provider;
    return new Disposable();
  },
  async selectChatModels(): Promise<unknown[]> {
    return selectedChatModels;
  }
};
```

Export setters/getters for Quick Pick values, selected chat models, and updates; clear them in `__resetVscodeState()`. Keep `LanguageModelChatMessage` and `CancellationTokenSource` exports so command and analyzer tests execute real construction paths.

- [ ] **Step 2: Write failing configurator tests**

Create `test/unit/runtime/vision-configuration.test.ts` covering:

```ts
it('selects a discovered 9router Vision model and writes model before source', async () => {
  __setQuickPickValues([
    { label: '9router', source: '9router' },
    { label: 'router/vision', modelId: 'router/vision' }
  ]);
  const configure = createVisionProxyConfigurator({
    secrets: { get: async () => 'secret' } as never,
    routerClient: {
      listVisionModels: async () => [{ id: 'router/vision' }]
    } as never,
    getRuntimeSettings: () => loadRuntimeSettings(configuration({}))
  });

  await expect(configure(__createCancellationToken().value as never)).resolves.toEqual({
    source: '9router',
    modelId: 'router/vision'
  });
  expect(__getConfigurationUpdates().map(({ key }) => key)).toEqual([
    'visionProxyModelId',
    'visionProxySource'
  ]);
});

it('selects a native Copilot model by opaque id', async () => {
  __setSelectedChatModels([
    { id: 'copilot/vision', name: 'Vision', family: 'gpt', vendor: 'copilot' }
  ]);
  __setQuickPickValues([
    { label: 'GitHub Copilot', source: 'copilot' },
    { label: 'Vision', modelId: 'copilot/vision' }
  ]);

  const result = await createVisionProxyConfigurator(dependencies)(token);
  expect(result).toEqual({ source: 'copilot', modelId: 'copilot/vision' });
});
```

Add cases for source cancellation, model cancellation, missing API key, empty 9router catalog, empty Copilot list, and two concurrent calls sharing one setup promise. Assert cancellation writes nothing.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm exec vitest run test/unit/runtime/vision-configuration.test.ts`

Expected: FAIL because configurator and expanded VS Code test API do not exist.

- [ ] **Step 4: Implement configurator**

Create `src/runtime/vision-configuration.ts` with these public definitions:

```ts
import * as vscode from 'vscode';
import { getApiKey } from '../config/secret-store';
import { NineRouterError } from '../router/errors';
import type { RuntimeSettings, VisionProxySource } from '../config/settings';
import type { RouterClient } from '../router/client';

export interface VisionProxySelection {
  source: VisionProxySource;
  modelId: string;
}

export type VisionProxyConfigurator = (
  token: vscode.CancellationToken
) => Promise<VisionProxySelection | undefined>;

interface Dependencies {
  secrets: vscode.SecretStorage;
  routerClient: RouterClient;
  getRuntimeSettings: () => RuntimeSettings;
}
```

Implement one module-scoped `inFlight` promise inside factory closure. `runConfiguration` must:

- show source Quick Pick;
- for 9router, require API key and call `listVisionModels` using runtime URL/timeout plus cancellation-derived abort signal;
- for Copilot, call `vscode.lm.selectChatModels({ vendor: 'copilot' })`, deduplicate exact ids, sort by `name` then `id`, and show Quick Pick;
- update `visionProxyModelId` then `visionProxySource` with `vscode.ConfigurationTarget.Global`;
- return selection directly;
- return `undefined` on user cancellation;
- throw `NineRouterError` on unavailable choices or configuration-write failures.

Use existing `createAbortSignalFromToken()` for catalog cancellation and always call its cleanup.

- [ ] **Step 5: Register configure command**

Extend `CommandDependencies` in `src/runtime/commands.ts`:

```ts
interface CommandDependencies {
  getSettingsSnapshot?: () => SettingsSnapshot | undefined;
  configureVisionProxy?: VisionProxyConfigurator;
}
```

Register:

```ts
vscode.commands.registerCommand('9routerCopilot.configureVisionProxy', async () => {
  const cancellation = new vscode.CancellationTokenSource();
  try {
    await dependencies.configureVisionProxy?.(cancellation.token);
  } finally {
    cancellation.dispose();
  }
});
```

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run test/unit/runtime/vision-configuration.test.ts test/integration/extension/diagnostics-command.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit guided configuration**

Run:

```bash
git add src/runtime/vision-configuration.ts src/runtime/commands.ts test/support/vscode.ts test/unit/runtime/vision-configuration.test.ts test/integration/extension/diagnostics-command.test.ts
git commit -m "feat(runtime): configure vision proxy"
```

---

### Task 4: Native Copilot Vision Analyzer

**Files:**
- Create: `src/provider/copilot-vision-analyzer.ts`
- Modify: `src/provider/vision-proxy.ts`
- Create: `test/unit/provider/copilot-vision-analyzer.test.ts`
- Modify: `test/unit/provider/vision-proxy.test.ts`

**Interfaces:**
- Consumes: `VisionProxySource`, `HostChatRequestMessage`, `HostImageDataPart`
- Produces: `CopilotVisionAnalyzer.summarize(input): Promise<{ summary: string }>`
- Changes: `buildVisionProxyRequest(message, modelId, prompt, maxTokens?)`
- Changes: `VisionProxyInput` gains `visionProxySource`, `visionProxyPrompt`, and `cancellationToken`

- [ ] **Step 1: Write failing native analyzer tests**

Create `test/unit/provider/copilot-vision-analyzer.test.ts`. Use injectable model selection so tests need no network:

```ts
it('resolves exact model and sends prompt, text context, and image', async () => {
  const sent: vscode.LanguageModelChatMessage[] = [];
  const analyzer = new CopilotVisionAnalyzer({
    selectChatModels: async (selector) => {
      expect(selector).toEqual({ vendor: 'copilot', id: 'copilot/vision' });
      return [{
        id: 'copilot/vision',
        async sendRequest(messages: vscode.LanguageModelChatMessage[]) {
          sent.push(...messages);
          return { text: ['visible text', ' and layout'] };
        }
      } as never];
    }
  });

  await expect(analyzer.summarize({
    message: {
      role: 1,
      content: [{ value: 'local context' }, image('image/png', 97)]
    },
    modelId: 'copilot/vision',
    prompt: 'Describe image.',
    token
  })).resolves.toEqual({ summary: 'visible text and layout' });
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent)).toContain('Describe image.');
  expect(JSON.stringify(sent)).toContain('local context');
});
```

Add tests for no exact model, empty response, `NoPermissions`, `NotFound`, `Blocked`, cancellation, and stream error. Assert mapped errors never contain prompt, source text, image data, or partial summary.

- [ ] **Step 2: Add failing source-dispatch and prompt tests**

Update `test/unit/provider/vision-proxy.test.ts`:

```ts
it('uses the configured prompt as the complete 9router system instruction', () => {
  const request = buildVisionProxyRequest(
    { role: 1, content: [image('image/png', 97)] },
    'combo/vision',
    'Custom image instruction.',
    256
  );

  expect(request.messages[0]).toEqual({
    role: 'system',
    content: 'Custom image instruction.'
  });
});

it('dispatches Copilot source without calling 9router', async () => {
  let routerCalled = false;
  const service = new VisionProxyService(
    { async *streamChatCompletion() { routerCalled = true; } } as never,
    { summarize: async () => ({ summary: 'native summary' }) } as never
  );

  const result = await service.prepare({
    selectedModel: proxyModel,
    messages: [{ role: 1, content: [image('image/png', 1)] }],
    visionProxySource: 'copilot',
    visionProxyModelId: 'copilot/vision',
    visionProxyPrompt: 'Describe.',
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'secret',
    requestTimeoutMs: 5_000,
    signal: new AbortController().signal,
    cancellationToken: token
  });

  expect(result.outcome).toBe('vision-proxied');
  expect(routerCalled).toBe(false);
});
```

Update all existing service fixtures with source, prompt, and cancellation token.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm exec vitest run test/unit/provider/copilot-vision-analyzer.test.ts test/unit/provider/vision-proxy.test.ts`

Expected: FAIL because native analyzer and source-aware signatures do not exist.

- [ ] **Step 4: Implement native analyzer**

Create `src/provider/copilot-vision-analyzer.ts`:

```ts
import * as vscode from 'vscode';
import { NineRouterError } from '../router/errors';
import { isHostImageDataPart } from './image-input-adapter';
import type { HostChatRequestMessage } from './vision-proxy';

interface Dependencies {
  selectChatModels: typeof vscode.lm.selectChatModels;
}

export class CopilotVisionAnalyzer {
  public constructor(
    private readonly dependencies: Dependencies = {
      selectChatModels: vscode.lm.selectChatModels
    }
  ) {}

  public async summarize(input: {
    message: HostChatRequestMessage;
    modelId: string;
    prompt: string;
    token: vscode.CancellationToken;
  }): Promise<{ summary: string }> {
    const models = await this.dependencies.selectChatModels({
      vendor: 'copilot',
      id: input.modelId
    });
    const model = models.find((candidate) => candidate.id === input.modelId);
    if (!model) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        'Configured GitHub Copilot Vision model is unavailable. Run 9router: Configure Vision Proxy.',
        { details: { phase: 'vision-proxy', source: 'copilot' } }
      );
    }

    const content: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [
      new vscode.LanguageModelTextPart(input.prompt)
    ];
    const parts = typeof input.message.content === 'string'
      ? [input.message.content]
      : input.message.content;
    for (const part of parts) {
      if (typeof part === 'string') content.push(new vscode.LanguageModelTextPart(part));
      else if (isHostImageDataPart(part)) content.push(new vscode.LanguageModelDataPart(part.data, part.mimeType));
      else if (typeof part === 'object' && part !== null && 'value' in part && typeof part.value === 'string') {
        content.push(new vscode.LanguageModelTextPart(part.value));
      }
    }

    try {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(content)],
        { justification: 'Describe attached images for the selected 9router chat model.' },
        input.token
      );
      let summary = '';
      for await (const text of response.text) summary += text;
      if (summary.trim().length === 0) {
        throw new NineRouterError(
          'MALFORMED_STREAM_ERROR',
          'GitHub Copilot Vision analysis returned an empty summary',
          { details: { phase: 'vision-proxy', source: 'copilot' } }
        );
      }
      return { summary: summary.trim() };
    } catch (error) {
      throw mapCopilotVisionError(error);
    }
  }
}
```

Implement `mapCopilotVisionError` by preserving `NineRouterError`, checking `vscode.LanguageModelError.code`, and returning safe mappings from approved design. Do not include `cause`, prompt, message content, or partial response.

- [ ] **Step 5: Make Vision service source-aware**

In `src/provider/vision-proxy.ts`:

- remove fixed `VISION_PROXY_INSTRUCTION`;
- pass `prompt` into `buildVisionProxyRequest`;
- add `visionProxySource`, `visionProxyPrompt`, and `cancellationToken` to input;
- reject absent source/model/blank prompt with `CONFIGURATION_ERROR`;
- dispatch `9router` to current stream logic;
- dispatch `copilot` to `CopilotVisionAnalyzer.summarize`;
- keep sequential processing, replacement, request IDs, fail-closed behavior, and safe metadata.

Constructor:

```ts
public constructor(
  private readonly routerClient: RouterClient,
  private readonly copilotAnalyzer = new CopilotVisionAnalyzer()
) {}
```

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run test/unit/provider/copilot-vision-analyzer.test.ts test/unit/provider/vision-proxy.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit analyzer paths**

Run:

```bash
git add src/provider/copilot-vision-analyzer.ts src/provider/vision-proxy.ts test/unit/provider/copilot-vision-analyzer.test.ts test/unit/provider/vision-proxy.test.ts
git commit -m "feat(provider): add copilot vision analyzer"
```

---

### Task 5: Provider Setup Continuation and Activation Wiring

**Files:**
- Modify: `src/provider/provider.ts`
- Modify: `src/runtime/activate.ts`
- Modify: `src/debug/output-channel.ts`
- Modify: `test/integration/extension/settings-refresh.test.ts`
- Modify: `test/integration/extension/text-stream-roundtrip.test.ts`
- Modify: `test/integration/extension/diagnostics-command.test.ts`

**Interfaces:**
- Consumes: `VisionProxyConfigurator`, `VisionProxySelection`, source-aware `VisionProxyService.prepare`
- Changes: `NineRouterChatProvider` constructor accepts optional `configureVisionProxy`
- Produces: one configurator shared by command and provider

- [ ] **Step 1: Write failing automatic setup integration test**

Add to `test/integration/extension/text-stream-roundtrip.test.ts`:

```ts
it('configures missing Vision analyzer and continues the current request', async () => {
  const configureVisionProxy = vi.fn().mockResolvedValue({
    source: '9router',
    modelId: 'router/vision'
  });
  const modelsCalled: string[] = [];
  const provider = new NineRouterChatProvider(
    context,
    {
      async *streamChatCompletion(input) {
        modelsCalled.push(input.request.model);
        if (input.request.model === 'router/vision') {
          yield { type: 'text-delta', text: 'configured summary' };
        }
        yield { type: 'response-complete' };
      }
    },
    createSnapshot({
      visionProxySource: '',
      visionProxyModelId: '',
      visionProxyPrompt: 'Describe image.'
    }),
    { configureVisionProxy }
  );

  await provider.provideLanguageModelChatResponse(
    publishedProxyModel,
    [{ role: 1, content: [image('image/png', 1)] }] as never,
    {} as never,
    progress,
    token
  );

  expect(configureVisionProxy).toHaveBeenCalledTimes(1);
  expect(modelsCalled).toEqual(['router/vision', 'router/agent']);
});
```

Add cases where configurator returns `undefined` and throws; assert no router call. Add configured Copilot source case with injected `VisionProxyService` or native model test double; assert native summary reaches primary request and no secondary 9router analyzer call occurs.

- [ ] **Step 2: Write failing refresh and diagnostics tests**

In `test/integration/extension/settings-refresh.test.ts`, require image capability only when source, model, and prompt are all valid. In diagnostics test, require:

```ts
expect(output).toContain('"visionProxySource":"copilot"');
expect(output).toContain('"visionProxyConfigured":true');
expect(output).not.toContain('copilot/private-model-id');
expect(output).not.toContain('private custom prompt');
```

- [ ] **Step 3: Run integration tests and verify failure**

Run: `pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/settings-refresh.test.ts test/integration/extension/diagnostics-command.test.ts`

Expected: FAIL because provider does not invoke configurator and diagnostics lack source.

- [ ] **Step 4: Add provider setup resolution**

In `src/provider/provider.ts`, add constructor options:

```ts
interface NineRouterChatProviderOptions {
  configureVisionProxy?: VisionProxyConfigurator;
}
```

Before `visionProxyService.prepare`, resolve request-local source/model:

```ts
let visionProxySource = this.snapshot.runtime.visionProxySource;
let visionProxyModelId = this.snapshot.runtime.visionProxyModelId;
const needsSetup =
  requestSelectedModel.visionMode === 'proxy' &&
  messages.some((message) => hasImageParts(message.content)) &&
  (!visionProxySource || visionProxyModelId.length === 0);

if (needsSetup) {
  const selection = await this.options.configureVisionProxy?.(token);
  if (!selection) {
    throw new NineRouterError(
      'CONFIGURATION_ERROR',
      'Vision proxy configuration was cancelled. Run 9router: Configure Vision Proxy before sending images.',
      { details: { phase: 'vision-configuration' } }
    );
  }
  visionProxySource = selection.source;
  visionProxyModelId = selection.modelId;
}
```

Pass request-local values, `visionProxyPrompt`, and host cancellation token to `prepare`. Do not auto-open setup for stale configured model failures.

- [ ] **Step 5: Wire one shared configurator**

In `src/runtime/activate.ts`, create one router client variable, then one configurator:

```ts
const routerClient = createRouterClient({ fetch: globalThis.fetch });
const configureVisionProxy = createVisionProxyConfigurator({
  secrets: context.secrets,
  routerClient,
  getRuntimeSettings: () => loadRuntimeSettings(getExtensionConfiguration())
});
provider = new NineRouterChatProvider(
  context,
  routerClient,
  buildSettingsSnapshot(getExtensionConfiguration()),
  { configureVisionProxy }
);
registerCommands(context, {
  getSettingsSnapshot: () => provider?.getSnapshot(),
  configureVisionProxy
});
```

- [ ] **Step 6: Keep diagnostics content-safe**

Update runtime diagnostic metadata in `src/debug/output-channel.ts`:

```ts
visionProxySource: snapshot.runtime.visionProxySource ?? 'none',
visionProxyConfigured: isVisionProxyConfigured(snapshot.runtime)
```

Never add model id or prompt to diagnostic output.

- [ ] **Step 7: Run integration tests**

Run: `pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/settings-refresh.test.ts test/integration/extension/diagnostics-command.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit provider wiring**

Run:

```bash
git add src/provider/provider.ts src/runtime/activate.ts src/debug/output-channel.ts test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/settings-refresh.test.ts test/integration/extension/diagnostics-command.test.ts
git commit -m "feat(provider): configure missing vision proxy"
```

---

### Task 6: Documentation, Safety Regression, and Release Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`
- Modify: `test/integration/extension/release-guardrails.test.ts`
- Modify: relevant tests from Tasks 1–5 if release gate finds regressions

**Interfaces:**
- Consumes: final settings and command names.
- Produces: documented user workflow and passing full verification gate.

- [ ] **Step 1: Add failing documentation guardrails**

Extend `test/integration/extension/release-guardrails.test.ts`:

```ts
for (const text of [
  '9router-copilot.visionProxySource',
  '9router-copilot.visionProxyModelId',
  '9router-copilot.visionProxyPrompt',
  '9router: Configure Vision Proxy',
  'capabilities.vision',
  'GitHub Copilot'
]) {
  expect(readme).toContain(text);
  expect(productionDesign).toContain(text);
}
expect(readme).toContain('GET /v1/models');
expect(readme).toContain('fail-closed');
```

- [ ] **Step 2: Run guardrail test and verify failure**

Run: `pnpm exec vitest run test/integration/extension/release-guardrails.test.ts`

Expected: FAIL because user docs and canonical production design describe only shared 9router model id.

- [ ] **Step 3: Update README**

Document exact settings JSON:

```json
{
  "9router-copilot.visionProxySource": "9router",
  "9router-copilot.visionProxyModelId": "provider/vision-model",
  "9router-copilot.visionProxyPrompt": "Describe the supplied images faithfully for another language model. Include visible text, code, tables, diagrams, layout, and uncertainty. Do not answer the user request; provide only image context."
}
```

Document:

- command and automatic setup behavior;
- 9router discovery from `GET /v1/models` with strict `capabilities.vision === true` filter;
- native GitHub Copilot source and consent/quota/model availability behavior;
- editable complete prompt semantics;
- legacy model-only configuration interpreted as 9router;
- fail-closed errors and reconfiguration command;
- privacy exclusions.

- [ ] **Step 4: Update canonical production design**

Replace single-9router-only Vision section with approved dual-source flow. Keep primary request and 9router branch routing authority unchanged. Explicitly state stable native selector does not expose image capability metadata, so runtime request enforces compatibility without name guessing.

- [ ] **Step 5: Run guardrail test**

Run: `pnpm exec vitest run test/integration/extension/release-guardrails.test.ts`

Expected: PASS.

- [ ] **Step 6: Run complete verification gate in order**

Run:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

Expected:

- build exits 0 with no TypeScript errors;
- lint exits 0 with no ESLint errors;
- all unit tests pass;
- all integration tests pass;
- package exits 0 and creates VSIX.

If a command fails, fix only behavior introduced by this feature, rerun failing command, then rerun all five commands from start.

- [ ] **Step 7: Inspect final diff for content leaks and scope**

Run:

```bash
git --no-pager diff --check
git status --short
git --no-pager diff --stat
grep -R "visionProxyPrompt\|data:image\|Vision proxy summary" dist/src test README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md
```

Expected: no whitespace errors; only planned files changed; prompt/image/summary strings appear only in intended request construction, tests, and documentation—not diagnostics or log metadata.

- [ ] **Step 8: Commit documentation and release coverage**

Run:

```bash
git add README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: explain vision proxy selection"
```

- [ ] **Step 9: Record verification evidence**

Run:

```bash
git status --short
git --no-pager log -7 --oneline
```

Expected: clean working tree, except intentionally uncommitted approved spec/plan if commit authorization remains skipped; recent commits match Tasks 1–6.
