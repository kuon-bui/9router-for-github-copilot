# Shared 9router Vision Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Vision path with a fail-closed two-stage flow that uses one shared 9router Vision combo, normalizes real VS Code image attachments, and sends textual image context to the selected curated combo.

**Architecture:** Keep `NineRouterChatProvider` as the request orchestrator, add a pure image input adapter for VS Code-to-OpenAI conversion, and make `VisionProxyService` use the existing `RouterClient` for secondary streaming requests. Configuration and capability publication remain local adapter concerns; 9router continues to own combo routing, fallback, quota, and upstream compatibility.

**Tech Stack:** TypeScript 5.9 in strict mode, VS Code Language Model API `^1.125.0`, OpenAI-compatible 9router `/v1/chat/completions`, Vitest 4, pnpm, `@vscode/vsce`.

## Global Constraints

- Follow `AGENTS.md`, `CODE_CONVENTION.md`, and `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`.
- Implement `docs/superpowers/specs/2026-07-17-shared-9router-vision-proxy-design.md`.
- Preserve the thin adapter architecture; never select upstream providers or implement retries/fallback locally.
- Use one non-secret setting named `9router-copilot.visionProxyComboId` with default `""`.
- Any Vision-stage failure must prevent the primary request.
- Never log image bytes, data URLs, source prompts, or generated Vision summaries.
- Reuse `SecretStorage`, `RouterClient`, SSE parsing, `maxTokens`, timeout, and host cancellation.
- Do not send tools, `tool_choice`, or `reasoning_effort` to the Vision combo.
- Preserve user-owned changes in `docs/9router-copilot-chat-provider-system-design.md` and `tsconfig.json`.
- At execution time, use `superpowers:using-git-worktrees` because the main workspace is dirty.
- Follow RED-GREEN-REFACTOR and commit only task-scoped files.

## File Structure

- Create `src/provider/image-input-adapter.ts`: recognize VS Code image parts, count them, and convert them to `image_url` data URLs.
- Create `test/unit/provider/image-input-adapter.test.ts`: image boundary tests.
- Modify `src/config/defaults.ts`, `src/config/settings.ts`, `src/provider/model-catalog.ts`, `src/debug/output-channel.ts`, and `package.json`: shared combo configuration and conservative capability publication.
- Modify `src/provider/request-adapter.ts`: native image normalization.
- Modify `src/provider/vision-proxy.ts`: `VisionProxyService`, sequential proxy calls, safe errors, and message transformation.
- Modify `src/provider/provider.ts`: request-scoped two-stage orchestration and cancellation.
- Modify focused unit/integration tests plus `README.md` and the canonical production design.

---

### Task 1: Shared Vision Combo Configuration and Capability Publication

**Files:**
- Modify: `src/config/defaults.ts`
- Modify: `src/config/settings.ts`
- Modify: `src/provider/model-catalog.ts`
- Modify: `src/debug/output-channel.ts`
- Modify: `package.json`
- Test: `test/unit/config/settings.test.ts`
- Test: `test/unit/provider/model-catalog.test.ts`
- Test: `test/integration/extension/diagnostics-command.test.ts`
- Test: `test/integration/extension/settings-refresh.test.ts`
- Test: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Produces: `RuntimeSettings.visionProxyComboId: string`.
- Produces: `SettingsIssue` code `MISSING_VISION_PROXY_COMBO` with `scope: 'capability'`.
- Produces: `createPublishedModel(setting, options?: { visionProxyConfigured?: boolean }): PublishedModel`.
- Produces: manifest property `9router-copilot.visionProxyComboId` with `default: ''`.

- [ ] **Step 1: Write failing settings and catalog tests**

Add to `test/unit/config/settings.test.ts`:

```ts
it('loads and trims the shared Vision proxy combo id', () => {
  const runtime = loadRuntimeSettings({
    get: (key: string) => key === 'visionProxyComboId' ? '  combo/vision  ' : undefined
  } as never);
  expect(runtime.visionProxyComboId).toBe('combo/vision');
});

it('degrades image capability without rejecting a proxy model', () => {
  const snapshot = buildSettingsSnapshot({
    get: (key: string) => {
      if (key === 'displayModels') return ['agent'];
      if (key === 'modelMappings.agent') return 'combo/agent';
      if (key === 'visionMode.agent') return 'proxy';
      return undefined;
    }
  } as never);

  expect(snapshot.state).toBe('degraded');
  expect(snapshot.publishedModels).toHaveLength(1);
  expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBeUndefined();
  expect(snapshot.issues).toContainEqual(expect.objectContaining({
    scope: 'capability',
    code: 'MISSING_VISION_PROXY_COMBO'
  }));
});

it('advertises proxy image input when the shared combo is configured', () => {
  const snapshot = buildSettingsSnapshot({
    get: (key: string) => {
      if (key === 'displayModels') return ['agent'];
      if (key === 'modelMappings.agent') return 'combo/agent';
      if (key === 'visionMode.agent') return 'proxy';
      if (key === 'visionProxyComboId') return 'combo/vision';
      return undefined;
    }
  } as never);

  expect(snapshot.state).toBe('valid');
  expect(snapshot.runtime?.visionProxyComboId).toBe('combo/vision');
  expect(snapshot.publishedModels[0]?.capabilities.imageInput).toBe(true);
});
```

Add to `test/unit/provider/model-catalog.test.ts`:

```ts
it('requires proxy availability before publishing image input', () => {
  const setting = {
    key: 'agent', label: 'Agent', comboId: 'combo/agent', enabled: true,
    toolMode: 'auto', visionMode: 'proxy', thinkingMode: 'off'
  } as const;

  expect(createPublishedModel(setting).capabilities.imageInput).toBeUndefined();
  expect(createPublishedModel(setting, {
    visionProxyConfigured: true
  }).capabilities.imageInput).toBe(true);
});
```

- [ ] **Step 2: Add failing refresh, diagnostics, and manifest tests**

In `test/integration/extension/settings-refresh.test.ts`, build an `agent` snapshot without `visionProxyComboId`, refresh with `visionProxyComboId: 'combo/vision'`, and assert `capabilities.imageInput` changes from `undefined` to `true`.

In `test/integration/extension/diagnostics-command.test.ts`, configure `visionProxyComboId: 'combo/vision-private'` and assert:

```ts
expect(__getOutputLines().join('\n')).toContain('"visionProxyConfigured":true');
expect(__getOutputLines().join('\n')).not.toContain('combo/vision-private');
```

In `test/integration/extension/release-guardrails.test.ts` add:

```ts
it('contributes one empty shared Vision proxy combo setting', () => {
  const setting = manifest.contributes.configuration.properties[
    '9router-copilot.visionProxyComboId'
  ];
  expect(setting).toMatchObject({ type: 'string', default: '' });
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts test/unit/provider/model-catalog.test.ts test/integration/extension/diagnostics-command.test.ts test/integration/extension/settings-refresh.test.ts test/integration/extension/release-guardrails.test.ts
```

Expected: FAIL because the setting, issue code, publication option, and manifest property do not exist.

- [ ] **Step 4: Implement configuration loading and non-fatal degradation**

Add to `src/config/defaults.ts`:

```ts
export const DEFAULT_VISION_PROXY_COMBO_ID = '';
```

Add the manifest property after the per-model Vision settings:

```json
"9router-copilot.visionProxyComboId": {
  "type": "string",
  "default": "",
  "description": "Existing 9router combo id used to describe image attachments for every display model configured with visionMode proxy."
}
```

Extend `src/config/settings.ts`:

```ts
export interface RuntimeSettings {
  baseUrl: string;
  maxTokens?: number;
  requestTimeoutMs: number;
  debugMode: 'minimal' | 'metadata' | 'verbose';
  visionProxyComboId: string;
}

export interface SettingsIssue {
  scope: 'runtime' | 'model' | 'capability';
  code:
    | 'INVALID_BASE_URL'
    | 'INVALID_REQUEST_TIMEOUT'
    | 'INVALID_MAX_TOKENS'
    | 'INVALID_DISPLAY_MODEL_KEY'
    | 'INVALID_COMBO_MAPPING'
    | 'INVALID_THINKING_MODE'
    | 'MISSING_VISION_PROXY_COMBO';
  message: string;
  modelKey?: string;
}
```

At the start of `loadRuntimeSettings`, `buildSettingsSnapshot`, and
`validateRuntimeSettings`, normalize with:

```ts
const visionProxyComboId =
  configuration.get<string>('visionProxyComboId')?.trim() ?? DEFAULT_VISION_PROXY_COMBO_ID;
```

Return the value in both `loadRuntimeSettings` and `validateRuntimeSettings`. In
`buildSettingsSnapshot`, the local normalized constant above is the source for
capability publication; pass
`visionProxyConfigured: visionProxyComboId.length > 0` to
`createPublishedModel`. After the model loop, add:

```ts
if (
  visionProxyComboId.length === 0 &&
  displayModels.some((model) => model.visionMode === 'proxy')
) {
  issues.push({
    scope: 'capability',
    code: 'MISSING_VISION_PROXY_COMBO',
    message:
      'Proxy Vision is disabled until 9router-copilot.visionProxyComboId references an existing 9router combo.'
  });
}
```

For a non-empty valid snapshot use `state: issues.length > 0 ? 'degraded' : 'valid'`. Preserve the existing `invalid-runtime` and `empty` returns.

- [ ] **Step 5: Implement conservative model capability and diagnostics**

In `src/provider/model-catalog.ts`:

```ts
export interface PublishedModelOptions {
  visionProxyConfigured?: boolean;
}

export function createPublishedModel(
  setting: DisplayModelSetting,
  options: PublishedModelOptions = {}
): PublishedModel {
  const exposesImageInput =
    setting.visionMode === 'native' ||
    (setting.visionMode === 'proxy' && options.visionProxyConfigured === true);
  const capabilities: PublishedModel['capabilities'] = {
    ...(setting.toolMode === 'auto' ? { toolCalling: 32 } : {}),
    ...(exposesImageInput ? { imageInput: true } : {})
  };

  return {
    id: setting.key,
    name: setting.label,
    vendor: '9router',
    family: setting.key,
    version: '1',
    maxInputTokens: 128_000,
    maxOutputTokens: 8_192,
    capabilities,
    configurationSchema: createThinkingEffortConfigurationSchema(setting.thinkingMode)
  };
}
```

Pass the optional options object through `resolvePublishedModels`. In `src/debug/output-channel.ts`, add only:

```ts
visionProxyConfigured: snapshot.runtime.visionProxyComboId.length > 0
```

Never print the combo value.

- [ ] **Step 6: Verify GREEN and commit**

Run the command from Step 3. Expected: all selected tests PASS.

```bash
git add package.json src/config/defaults.ts src/config/settings.ts src/provider/model-catalog.ts src/debug/output-channel.ts test/unit/config/settings.test.ts test/unit/provider/model-catalog.test.ts test/integration/extension/diagnostics-command.test.ts test/integration/extension/settings-refresh.test.ts test/integration/extension/release-guardrails.test.ts
git commit -m "feat: configure shared vision proxy combo"
```

### Task 2: Image Input Adapter and Native Vision Normalization

**Files:**
- Create: `src/provider/image-input-adapter.ts`
- Modify: `src/provider/request-adapter.ts`
- Create: `test/unit/provider/image-input-adapter.test.ts`
- Modify: `test/unit/provider/request-adapter.test.ts`

**Interfaces:**
- Produces: `HostImageDataPart { mimeType: string; data: Uint8Array }`.
- Produces: `isHostImageDataPart`, `createRouterImagePart`, `hasImageParts`, and `countImageParts`.
- Consumes: `RouterContentPart` from `src/types/router-contract.ts`.

- [ ] **Step 1: Write failing adapter and native request tests**

Create `test/unit/provider/image-input-adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  countImageParts,
  createRouterImagePart,
  hasImageParts,
  isHostImageDataPart
} from '../../../src/provider/image-input-adapter';

describe('image-input-adapter', () => {
  const png = { mimeType: 'image/png', data: new Uint8Array([0, 1, 2, 255]) };

  it('recognizes only complete image data parts', () => {
    expect(isHostImageDataPart(png)).toBe(true);
    expect(isHostImageDataPart({ mimeType: 'image/png' })).toBe(false);
    expect(isHostImageDataPart({
      mimeType: 'application/json', data: new Uint8Array([1])
    })).toBe(false);
    expect(isHostImageDataPart({ callId: 'call-1', name: 'tool', input: {} })).toBe(false);
  });

  it('creates an OpenAI-compatible image_url part', () => {
    expect(createRouterImagePart(png)).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAEC/w==' }
    });
  });

  it('counts images without misclassifying text or tools', () => {
    const content = [
      { value: 'inspect this' }, png,
      { mimeType: 'image/jpeg', data: new Uint8Array([3]) },
      { callId: 'call-1', name: 'tool', input: {} }
    ];
    expect(hasImageParts(content)).toBe(true);
    expect(countImageParts(content)).toBe(2);
    expect(hasImageParts('plain text')).toBe(false);
  });
});
```

In the native case in `test/unit/provider/request-adapter.test.ts`, use `{ mimeType: 'image/png', data: new Uint8Array([97, 98, 99]) }` and expect:

```ts
[
  { type: 'text', text: 'What is in this image?' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } }
]
```

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run test/unit/provider/image-input-adapter.test.ts test/unit/provider/request-adapter.test.ts
```

Expected: FAIL because the adapter is missing and native Vision preserves raw objects.

- [ ] **Step 3: Implement the image adapter**

Create `src/provider/image-input-adapter.ts`:

```ts
import type { RouterContentPart } from '../types/router-contract';

export interface HostImageDataPart {
  mimeType: string;
  data: Uint8Array;
}

export function isHostImageDataPart(part: unknown): part is HostImageDataPart {
  return typeof part === 'object' && part !== null &&
    'mimeType' in part && typeof part.mimeType === 'string' &&
    part.mimeType.startsWith('image/') &&
    'data' in part && part.data instanceof Uint8Array;
}

export function createRouterImagePart(part: HostImageDataPart): RouterContentPart {
  return {
    type: 'image_url',
    image_url: {
      url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`
    }
  };
}

export function hasImageParts(content: string | readonly unknown[]): boolean {
  return countImageParts(content) > 0;
}

export function countImageParts(content: string | readonly unknown[]): number {
  return typeof content === 'string' ? 0 : content.filter(isHostImageDataPart).length;
}
```

- [ ] **Step 4: Normalize native request content**

Import `createRouterImagePart` and `isHostImageDataPart` into `src/provider/request-adapter.ts`. In `adaptNativeVisionContent`, add this branch before the generic object branch:

```ts
if (isHostImageDataPart(part)) {
  return createRouterImagePart(part);
}
```

Do not alter text or tool-history branches.

- [ ] **Step 5: Verify GREEN and commit**

Run the command from Step 2. Expected: both files PASS.

```bash
git add src/provider/image-input-adapter.ts src/provider/request-adapter.ts test/unit/provider/image-input-adapter.test.ts test/unit/provider/request-adapter.test.ts
git commit -m "feat: normalize vscode image inputs"
```

### Task 3: Sequential Fail-Closed Vision Proxy Service

**Files:**
- Modify: `src/provider/vision-proxy.ts`
- Modify: `test/unit/provider/vision-proxy.test.ts`

**Interfaces:**
- Consumes: `RouterClient`, `DisplayModelSetting`, and Task 2 image adapter functions.
- Produces: `VisionProxyInput` containing selected model, messages, combo id, router runtime values, and abort signal.
- Produces: `VisionCompatibilityResult` containing messages, outcome, image counts, request ids, and optional block reason.
- Produces: `VisionProxyService.prepare(input): Promise<VisionCompatibilityResult>`.
- Produces: `buildVisionProxyRequest(message, comboId, maxTokens): RouterChatCompletionRequest`.

- [ ] **Step 1: Write failing successful-service tests**

Rewrite `test/unit/provider/vision-proxy.test.ts` to import `VisionProxyService`, `buildVisionProxyRequest`, `NineRouterError`, and router contract types. Define:

```ts
const proxyModel = {
  key: 'agent', label: 'Agent', comboId: 'combo/agent', enabled: true,
  toolMode: 'auto', visionMode: 'proxy', thinkingMode: 'max'
} as const;

const image = (mimeType: string, byte: number) => ({
  mimeType,
  data: new Uint8Array([byte])
});
```

Add the sequential transformation test:

```ts
it('summarizes each image-bearing message sequentially', async () => {
  const requests: RouterChatCompletionRequest[] = [];
  let active = 0;
  let maxActive = 0;
  const service = new VisionProxyService({
    async *streamChatCompletion(input) {
      requests.push(input.request);
      active += 1;
      maxActive = Math.max(maxActive, active);
      yield { type: 'text-delta', text: `summary-${requests.length}` };
      yield { type: 'response-complete', requestId: `req-${requests.length}` };
      active -= 1;
    }
  });

  const result = await service.prepare({
    selectedModel: proxyModel,
    messages: [
      { role: 1, content: [{ value: 'first' }, image('image/png', 1)] },
      { role: 2, content: [{ callId: 'call-1', name: 'tool', input: {} }] },
      { role: 1, content: [
        { value: 'second' }, image('image/jpeg', 2), image('image/png', 3)
      ] }
    ],
    visionProxyComboId: 'combo/vision',
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'secret',
    maxTokens: 128,
    requestTimeoutMs: 5_000,
    signal: new AbortController().signal
  });

  expect(requests.map((request) => request.model)).toEqual([
    'combo/vision', 'combo/vision'
  ]);
  expect(maxActive).toBe(1);
  expect(result).toMatchObject({
    outcome: 'vision-proxied',
    imageCount: 3,
    imageMessageCount: 2,
    requestIds: ['req-1', 'req-2']
  });
  expect(JSON.stringify(result.messages)).toContain('summary-1');
  expect(JSON.stringify(result.messages)).toContain('summary-2');
  expect(JSON.stringify(result.messages)).not.toContain('mimeType');
  expect(result.messages[1]?.content).toEqual([
    { callId: 'call-1', name: 'tool', input: {} }
  ]);
});
```

Add exact request-contract coverage:

```ts
it('builds a bare-combo multimodal request without tools or reasoning', () => {
  const request = buildVisionProxyRequest(
    { role: 1, content: [{ value: 'read this' }, image('image/png', 97)] },
    'combo/vision',
    256
  );

  expect(request).toMatchObject({
    model: 'combo/vision', stream: true, max_tokens: 256
  });
  expect(request).not.toHaveProperty('tools');
  expect(request).not.toHaveProperty('tool_choice');
  expect(request).not.toHaveProperty('reasoning_effort');
  expect(JSON.stringify(request.messages)).toContain('data:image/png;base64,YQ==');
});
```

- [ ] **Step 2: Write failing no-op and fail-closed tests**

Add cases for:

```ts
it('rejects a missing shared combo before calling 9router', async () => {
  let called = false;
  const service = new VisionProxyService({
    async *streamChatCompletion() {
      called = true;
      yield { type: 'response-complete' };
    }
  });

  await expect(service.prepare({
    selectedModel: proxyModel,
    messages: [{ role: 1, content: [image('image/png', 1)] }],
    visionProxyComboId: '',
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'secret',
    maxTokens: 128,
    requestTimeoutMs: 5_000,
    signal: new AbortController().signal
  })).rejects.toMatchObject({
    code: 'CONFIGURATION_ERROR',
    details: expect.objectContaining({
      phase: 'vision-proxy',
      settingsKey: '9router-copilot.visionProxyComboId'
    })
  });
  expect(called).toBe(false);
});
```

Add the no-op mode table:

```ts
it.each([
  ['native', 'native-vision'],
  ['off', 'vision-blocked']
] as const)('returns %s mode without proxying', async (visionMode, outcome) => {
  let called = false;
  const service = new VisionProxyService({
    async *streamChatCompletion() {
      called = true;
      yield { type: 'response-complete' };
    }
  });
  const messages = [{ role: 1, content: [image('image/png', 1)] }];
  const result = await service.prepare({
    selectedModel: { ...proxyModel, visionMode },
    messages,
    visionProxyComboId: 'combo/vision',
    baseUrl: 'https://router.example.com/v1',
    apiKey: 'secret',
    maxTokens: 128,
    requestTimeoutMs: 5_000,
    signal: new AbortController().signal
  });
  expect(result.outcome).toBe(outcome);
  expect(result.messages).toBe(messages);
  expect(called).toBe(false);
});

it('does not classify tool parts as images', async () => {
  const service = new VisionProxyService({
    async *streamChatCompletion() {
      throw new Error('must not be called');
    }
  });
  const result = await service.prepare({
    selectedModel: proxyModel,
    messages: [{ role: 2, content: [{ callId: 'call-1', name: 'tool', input: {} }] }],
    visionProxyComboId: 'combo/vision',
    baseUrl: 'https://router.example.com/v1', apiKey: 'secret', maxTokens: 128,
    requestTimeoutMs: 5_000, signal: new AbortController().signal
  });
  expect(result.outcome).toBe('text-only');
});
```

Add empty-stream and combo-mapping cases:

```ts
it('rejects an empty Vision stream', async () => {
  const service = new VisionProxyService({
    async *streamChatCompletion() { yield { type: 'response-complete' }; }
  });
  await expect(service.prepare({
    selectedModel: proxyModel,
    messages: [{ role: 1, content: [image('image/png', 1)] }],
    visionProxyComboId: 'combo/vision',
    baseUrl: 'https://router.example.com/v1', apiKey: 'secret', maxTokens: 128,
    requestTimeoutMs: 5_000, signal: new AbortController().signal
  })).rejects.toMatchObject({
    code: 'MALFORMED_STREAM_ERROR',
    details: { phase: 'vision-proxy' }
  });
});

it('maps a missing Vision combo to the shared setting without raw response text', async () => {
  const service = new VisionProxyService({
    async *streamChatCompletion() {
      throw new NineRouterError('COMBO_MAPPING_ERROR', 'missing', {
        requestId: 'req-404',
        details: { status: 404, responseText: 'raw-secret' }
      });
    }
  });
  const promise = service.prepare({
    selectedModel: proxyModel,
    messages: [{ role: 1, content: [image('image/png', 1)] }],
    visionProxyComboId: 'combo/missing',
    baseUrl: 'https://router.example.com/v1', apiKey: 'secret', maxTokens: 128,
    requestTimeoutMs: 5_000, signal: new AbortController().signal
  });
  await expect(promise).rejects.toMatchObject({
    code: 'CONFIGURATION_ERROR', requestId: 'req-404',
    details: {
      phase: 'vision-proxy', status: 404,
      settingsKey: '9router-copilot.visionProxyComboId'
    }
  });
  await expect(promise).rejects.not.toMatchObject({
    details: expect.objectContaining({ responseText: expect.anything() })
  });
});
```

Use one table for stable error codes:

```ts
it.each([
  'AUTHENTICATION_ERROR', 'TIMEOUT_ERROR', 'CANCELLATION_ERROR',
  'TRANSPORT_ERROR', 'UPSTREAM_UNAVAILABLE'
] as const)('preserves %s with safe phase details', async (code) => {
  const service = new VisionProxyService({
    async *streamChatCompletion() {
      throw new NineRouterError(code, 'safe message', {
        details: { responseText: 'must-not-survive' }
      });
    }
  });
  await expect(service.prepare({
    selectedModel: proxyModel,
    messages: [{ role: 1, content: [image('image/png', 1)] }],
    visionProxyComboId: 'combo/vision',
    baseUrl: 'https://router.example.com/v1', apiKey: 'secret', maxTokens: 128,
    requestTimeoutMs: 5_000, signal: new AbortController().signal
  })).rejects.toMatchObject({ code, details: { phase: 'vision-proxy' } });
});

it('converts router-error events to upstream unavailable', async () => {
  const service = new VisionProxyService({
    async *streamChatCompletion() {
      yield { type: 'router-error', error: 'upstream failed', requestId: 'req-up' };
    }
  });
  await expect(service.prepare({
    selectedModel: proxyModel,
    messages: [{ role: 1, content: [image('image/png', 1)] }],
    visionProxyComboId: 'combo/vision',
    baseUrl: 'https://router.example.com/v1', apiKey: 'secret', maxTokens: 128,
    requestTimeoutMs: 5_000, signal: new AbortController().signal
  })).rejects.toMatchObject({
    code: 'UPSTREAM_UNAVAILABLE', requestId: 'req-up',
    details: { phase: 'vision-proxy' }
  });
});
```

- [ ] **Step 3: Run the Vision unit test and verify RED**

```bash
pnpm exec vitest run test/unit/provider/vision-proxy.test.ts
```

Expected: FAIL because the service, request builder, counts, sequential calls, and safe error mapping do not exist.

- [ ] **Step 4: Define service contracts and request builder**

In `src/provider/vision-proxy.ts`, retain `HostChatRequestMessage` and define:

```ts
export interface VisionCompatibilityResult {
  messages: readonly HostChatRequestMessage[];
  outcome: VisionCompatibilityOutcome;
  hasVisionInput: boolean;
  imageCount: number;
  imageMessageCount: number;
  requestIds: string[];
  blockReason?: string;
}

export interface VisionProxyInput {
  selectedModel: DisplayModelSetting;
  messages: readonly HostChatRequestMessage[];
  visionProxyComboId: string;
  baseUrl: string;
  apiKey: string;
  maxTokens?: number;
  requestTimeoutMs: number;
  signal: AbortSignal;
}

const VISION_PROXY_INSTRUCTION =
  'Describe the supplied images faithfully for another language model. Include visible text, code, tables, diagrams, layout, and uncertainty. Do not answer the user request; provide only image context.';
```

Implement the exported request builder:

```ts
export function buildVisionProxyRequest(
  message: HostChatRequestMessage,
  comboId: string,
  maxTokens?: number
): RouterChatCompletionRequest {
  const userContent: RouterContentPart[] = [];
  const parts = typeof message.content === 'string' ? [message.content] : message.content;

  for (const part of parts) {
    if (typeof part === 'string') {
      userContent.push({ type: 'text', text: part });
    } else if (
      typeof part === 'object' && part !== null &&
      'value' in part && typeof part.value === 'string'
    ) {
      userContent.push({ type: 'text', text: part.value });
    } else if (isHostImageDataPart(part)) {
      userContent.push(createRouterImagePart(part));
    }
  }

  const request: RouterChatCompletionRequest = {
    model: comboId,
    stream: true,
    messages: [
      { role: 'system', content: VISION_PROXY_INSTRUCTION },
      { role: 'user', content: userContent }
    ]
  };
  if (typeof maxTokens === 'number') request.max_tokens = maxTokens;
  return request;
}
```

Add the message transformer:

```ts
function replaceImagesWithSummary(
  message: HostChatRequestMessage,
  summary: string
): HostChatRequestMessage {
  const retained = typeof message.content === 'string'
    ? [{ value: message.content }]
    : message.content.filter((part) => !isHostImageDataPart(part));

  return {
    ...message,
    content: [
      ...retained,
      { value: `[Vision proxy summary]\n${summary}` }
    ]
  };
}
```

- [ ] **Step 5: Implement safe error mapping and summary collection**

Use this mapper; never spread arbitrary router details:

```ts
function mapVisionProxyError(error: unknown): NineRouterError {
  if (!(error instanceof NineRouterError)) {
    return new NineRouterError('UPSTREAM_UNAVAILABLE', '9router Vision analysis failed', {
      details: { phase: 'vision-proxy' }
    });
  }

  const details: Record<string, unknown> = { phase: 'vision-proxy' };
  if (typeof error.details?.status === 'number') details.status = error.details.status;
  const options: { requestId?: string; details: Record<string, unknown> } = { details };
  if (error.requestId) options.requestId = error.requestId;

  if (error.code === 'COMBO_MAPPING_ERROR') {
    details.settingsKey = '9router-copilot.visionProxyComboId';
    return new NineRouterError(
      'CONFIGURATION_ERROR',
      'The configured 9router Vision proxy combo was not found. Update 9router-copilot.visionProxyComboId to a valid combo id.',
      options
    );
  }
  return new NineRouterError(error.code, error.message, options);
}
```

Add this private method to `VisionProxyService`:

```ts
private async summarizeMessage(
  message: HostChatRequestMessage,
  comboId: string,
  input: VisionProxyInput
): Promise<{ summary: string; requestId?: string }> {
  let summary = '';
  let requestId: string | undefined;

  try {
    const stream = this.routerClient.streamChatCompletion({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      request: buildVisionProxyRequest(message, comboId, input.maxTokens),
      timeoutMs: input.requestTimeoutMs,
      signal: input.signal
    });
    for await (const event of stream) {
      if (event.type === 'text-delta') summary += event.text;
      if (event.type === 'response-complete' && event.requestId) {
        requestId = event.requestId;
      }
      if (event.type === 'router-error') {
        throw new NineRouterError(
          'UPSTREAM_UNAVAILABLE',
          '9router Vision analysis failed',
          {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            details: { phase: 'vision-proxy' }
          }
        );
      }
    }
  } catch (error) {
    throw mapVisionProxyError(error);
  }

  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    throw new NineRouterError(
      'MALFORMED_STREAM_ERROR',
      '9router Vision analysis returned an empty summary',
      {
        ...(requestId ? { requestId } : {}),
        details: { phase: 'vision-proxy' }
      }
    );
  }

  return requestId ? { summary: trimmed, requestId } : { summary: trimmed };
}
```

When `mapVisionProxyError` receives an already-safe `UPSTREAM_UNAVAILABLE` created for a `router-error`, it reconstructs the error with the same code, request id, and phase-only details.

- [ ] **Step 6: Implement sequential `VisionProxyService.prepare`**

Implement this control flow:

```ts
export class VisionProxyService {
  public constructor(private readonly routerClient: RouterClient) {}

  public async prepare(input: VisionProxyInput): Promise<VisionCompatibilityResult> {
    const imageCount = input.messages.reduce(
      (total, message) => total + countImageParts(message.content), 0
    );
    const imageMessageCount = input.messages.filter((message) =>
      hasImageParts(message.content)
    ).length;

    if (imageCount === 0) return {
      messages: input.messages, outcome: 'text-only', hasVisionInput: false,
      imageCount: 0, imageMessageCount: 0, requestIds: []
    };
    if (input.selectedModel.visionMode === 'native') return {
      messages: input.messages, outcome: 'native-vision', hasVisionInput: true,
      imageCount, imageMessageCount, requestIds: []
    };
    if (input.selectedModel.visionMode === 'off') return {
      messages: input.messages, outcome: 'vision-blocked', hasVisionInput: true,
      imageCount, imageMessageCount, requestIds: [],
      blockReason: `Display model "${input.selectedModel.key}" cannot accept image inputs because visionMode is off.`
    };

    const comboId = input.visionProxyComboId.trim();
    if (comboId.length === 0) {
      throw new NineRouterError(
        'CONFIGURATION_ERROR',
        'Proxy Vision requires 9router-copilot.visionProxyComboId to reference an existing 9router combo.',
        { details: {
          phase: 'vision-proxy',
          settingsKey: '9router-copilot.visionProxyComboId'
        } }
      );
    }

    const messages: HostChatRequestMessage[] = [];
    const requestIds: string[] = [];
    for (const message of input.messages) {
      if (!hasImageParts(message.content)) {
        messages.push(message);
        continue;
      }
      if (input.signal.aborted) {
        throw new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled', {
          details: { phase: 'vision-proxy' }
        });
      }
      const result = await this.summarizeMessage(message, comboId, input);
      messages.push(replaceImagesWithSummary(message, result.summary));
      if (result.requestId) requestIds.push(result.requestId);
    }

    return {
      messages, outcome: 'vision-proxied', hasVisionInput: true,
      imageCount, imageMessageCount, requestIds
    };
  }
}
```

Catch router-client failures only around the streaming call and map them with `mapVisionProxyError`; do not remap locally created configuration or empty-summary errors.

- [ ] **Step 7: Verify GREEN and commit**

```bash
pnpm exec vitest run test/unit/provider/image-input-adapter.test.ts test/unit/provider/vision-proxy.test.ts test/unit/provider/request-adapter.test.ts
```

Expected: all selected tests PASS and no placeholder summary remains.

```bash
git add src/provider/vision-proxy.ts test/unit/provider/vision-proxy.test.ts
git commit -m "feat: add shared 9router vision proxy"
```

### Task 4: Provider Orchestration, Cancellation, and Safe Diagnostics

**Files:**
- Modify: `src/provider/provider.ts`
- Modify: `test/integration/extension/text-stream-roundtrip.test.ts`
- Modify: `test/integration/extension/timeout-cancellation.test.ts`

**Interfaces:**
- Consumes: `VisionProxyService.prepare` and `RuntimeSettings.visionProxyComboId`.
- Preserves: `mapProviderError` ownership for primary combo mapping failures.
- Produces: one abort signal covering every Vision call and the primary call.
- Produces: Vision metadata containing only outcome, counts, duration, and request ids.

- [ ] **Step 1: Write the failing successful two-stage integration test**

Add to `test/integration/extension/text-stream-roundtrip.test.ts` and import `RouterChatCompletionRequest`:

```ts
it('summarizes images before calling the selected combo', async () => {
  __setConfigurationValues({
    displayModels: ['agent'],
    'modelMappings.agent': 'combo/agent',
    'visionMode.agent': 'proxy',
    visionProxyComboId: 'combo/vision',
    'thinkingMode.agent': 'high',
    baseUrl: 'https://router.example.com/v1',
    maxTokens: 128,
    requestTimeoutMs: 5000,
    debugMode: 'metadata'
  });

  const requests: RouterChatCompletionRequest[] = [];
  const visible: string[] = [];
  const provider = new NineRouterChatProvider(
    { secrets: { get: async () => 'token' } } as never,
    {
      async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
        requests.push(input.request);
        if (input.request.model === 'combo/vision') {
          yield { type: 'text-delta', text: 'A diagram with A pointing to B.' };
          yield { type: 'response-complete', requestId: 'vision-req' };
          return;
        }
        yield { type: 'text-delta', text: 'Primary answer' };
        yield { type: 'response-complete', requestId: 'primary-req' };
      }
    } as never
  );

  await provider.provideLanguageModelChatResponse(
    {
      id: 'agent', name: 'Agent', vendor: '9router', family: 'agent', version: '1',
      maxInputTokens: 128000, maxOutputTokens: 8192,
      capabilities: { imageInput: true }
    },
    [{ role: 1, content: [
      new vscode.LanguageModelTextPart('Explain this'),
      { mimeType: 'image/png', data: new Uint8Array([97]) }
    ] }] as never,
    { modelConfiguration: { reasoningEffort: 'max' } } as never,
    { report: (part: vscode.LanguageModelResponsePart) => {
      if (part instanceof vscode.LanguageModelTextPart) visible.push(part.value);
    } } as never,
    __createCancellationToken().value as never
  );

  expect(requests).toHaveLength(2);
  expect(requests[0]?.model).toBe('combo/vision');
  expect(requests[0]).not.toHaveProperty('reasoning_effort');
  expect(requests[0]).not.toHaveProperty('tools');
  expect(requests[1]).toMatchObject({
    model: 'combo/agent', reasoning_effort: 'max'
  });
  expect(JSON.stringify(requests[1]?.messages)).toContain('[Vision proxy summary]');
  expect(JSON.stringify(requests[1]?.messages)).not.toContain('data:image/png');
  expect(visible).toEqual(['Primary answer']);
});
```

- [ ] **Step 2: Write failing fail-closed and privacy integration tests**

Add the missing-setting case:

```ts
it('fails before any router call when the shared Vision combo is empty', async () => {
  __setConfigurationValues({
    displayModels: ['agent'], 'modelMappings.agent': 'combo/agent',
    'visionMode.agent': 'proxy', baseUrl: 'https://router.example.com/v1',
    maxTokens: 128, requestTimeoutMs: 5000, debugMode: 'minimal'
  });
  let calls = 0;
  const provider = new NineRouterChatProvider(
    { secrets: { get: async () => 'token' } } as never,
    { async *streamChatCompletion() { calls += 1; yield { type: 'response-complete' }; } } as never
  );
  await expect(provider.provideLanguageModelChatResponse(
    {
      id: 'agent', name: 'Agent', vendor: '9router', family: 'agent', version: '1',
      maxInputTokens: 128000, maxOutputTokens: 8192, capabilities: {}
    },
    [{ role: 1, content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }] }] as never,
    {} as never, { report: () => undefined } as never,
    __createCancellationToken().value as never
  )).rejects.toMatchObject({
    code: 'CONFIGURATION_ERROR',
    details: expect.objectContaining({
      settingsKey: '9router-copilot.visionProxyComboId'
    })
  });
  expect(calls).toBe(0);
});
```

Add a test that configures `agent` proxy mode with
`visionProxyComboId: 'combo/vision'`. Track `modelsCalled`, and use this router
mock whose first and only call throws:

```ts
__setConfigurationValues({
  displayModels: ['agent'],
  'modelMappings.agent': 'combo/agent',
  'visionMode.agent': 'proxy',
  visionProxyComboId: 'combo/vision',
  baseUrl: 'https://router.example.com/v1',
  maxTokens: 128,
  requestTimeoutMs: 5000,
  debugMode: 'minimal'
});
const modelsCalled: string[] = [];
const provider = new NineRouterChatProvider(
  { secrets: { get: async () => 'token' } } as never,
  {
    async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
      modelsCalled.push(input.request.model);
      throw new NineRouterError('COMBO_MAPPING_ERROR', 'missing', {
        requestId: 'vision-404',
        details: { status: 404, responseText: 'must-not-leak' }
      });
    }
  } as never
);
```

Create `responsePromise` with this exact request:

```ts
const responsePromise = provider.provideLanguageModelChatResponse(
  {
    id: 'agent', name: 'Agent', vendor: '9router', family: 'agent', version: '1',
    maxInputTokens: 128000, maxOutputTokens: 8192, capabilities: {}
  },
  [{ role: 1, content: [
    { mimeType: 'image/png', data: new Uint8Array([1]) }
  ] }] as never,
  {} as never,
  { report: () => undefined } as never,
  __createCancellationToken().value as never
);
```

Then assert:

```ts
await expect(responsePromise).rejects.toMatchObject({
  code: 'CONFIGURATION_ERROR', requestId: 'vision-404',
  message: expect.stringContaining('9router-copilot.visionProxyComboId'),
  details: {
    phase: 'vision-proxy', status: 404,
    settingsKey: '9router-copilot.visionProxyComboId'
  }
});
expect(modelsCalled).toEqual(['combo/vision']);
```

For privacy, add this complete metadata case:

```ts
__setConfigurationValues({
  displayModels: ['agent'], 'modelMappings.agent': 'combo/agent',
  'visionMode.agent': 'proxy', visionProxyComboId: 'combo/vision',
  baseUrl: 'https://router.example.com/v1', maxTokens: 128,
  requestTimeoutMs: 5000, debugMode: 'metadata'
});
const provider = new NineRouterChatProvider(
  { secrets: { get: async () => 'api-key-secret' } } as never,
  {
    async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
      if (input.request.model === 'combo/vision') {
        yield { type: 'text-delta', text: 'vision-summary-secret' };
        yield { type: 'response-complete', requestId: 'vision-safe-id' };
        return;
      }
      yield { type: 'response-complete', requestId: 'primary-safe-id' };
    }
  } as never
);
await provider.provideLanguageModelChatResponse(
  {
    id: 'agent', name: 'Agent', vendor: '9router', family: 'agent', version: '1',
    maxInputTokens: 128000, maxOutputTokens: 8192, capabilities: {}
  },
  [{ role: 1, content: [
    new vscode.LanguageModelTextPart('source-text-secret'),
    { mimeType: 'image/png', data: new Uint8Array([1]) }
  ] }] as never,
  {} as never, { report: () => undefined } as never,
  __createCancellationToken().value as never
);
const output = __getOutputLines().join('\n');
expect(output).toContain('"imageCount":1');
expect(output).toContain('"imageMessageCount":1');
expect(output).toContain('"visionOutcome":"vision-proxied"');
for (const secret of [
  'source-text-secret', 'vision-summary-secret', 'api-key-secret',
  'data:image/png;base64'
]) {
  expect(output).not.toContain(secret);
}
```

- [ ] **Step 3: Write the failing cancellation integration test**

In `test/integration/extension/timeout-cancellation.test.ts`, configure proxy Vision and use this router behavior:

```ts
const cancellation = __createCancellationToken();
const modelsCalled: string[] = [];
let visionSignal: AbortSignal | undefined;
const provider = new NineRouterChatProvider(
  { secrets: { get: async () => 'token' } } as never,
  {
    async *streamChatCompletion(input: {
      request: RouterChatCompletionRequest;
      signal: AbortSignal;
    }) {
      modelsCalled.push(input.request.model);
      visionSignal = input.signal;
      await new Promise<void>((resolve) => {
        if (input.signal.aborted) resolve();
        else input.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new NineRouterError(
        'CANCELLATION_ERROR', '9router request was cancelled'
      );
    }
  } as never
);

const responsePromise = provider.provideLanguageModelChatResponse(
  {
    id: 'agent', name: 'Agent', vendor: '9router', family: 'agent', version: '1',
    maxInputTokens: 128000, maxOutputTokens: 8192, capabilities: {}
  },
  [{ role: 1, content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }] }] as never,
  {} as never, { report: () => undefined } as never, cancellation.value as never
);
await Promise.resolve();
cancellation.cancel();
```

Then assert:

```ts
await expect(responsePromise).rejects.toMatchObject({ code: 'CANCELLATION_ERROR' });
expect(modelsCalled).toEqual(['combo/vision']);
expect(visionSignal?.aborted).toBe(true);
```

The mock yields no summary, so the primary combo cannot start.

- [ ] **Step 4: Run integration tests and verify RED**

```bash
pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/timeout-cancellation.test.ts
```

Expected: FAIL because cancellation begins after placeholder Vision preparation and the provider submits only one router call.

- [ ] **Step 5: Wire `VisionProxyService` into the provider**

In `src/provider/provider.ts`, import the service and initialize it:

```ts
private readonly visionProxyService: VisionProxyService;

public constructor(
  private readonly context: Pick<vscode.ExtensionContext, 'secrets'>,
  private readonly routerClient: RouterClient,
  private snapshot: SettingsSnapshot = buildSettingsSnapshot(getExtensionConfiguration())
) {
  this.visionProxyService = new VisionProxyService(routerClient);
}
```

After resolving `requestSelectedModel`, create cancellation before Vision work:

```ts
const requestCancellation = createAbortSignalFromToken(token);
const visionStartedAt = Date.now();
```

Move Vision preparation, blocked-mode handling, tool/request adaptation, and primary streaming into one `try/catch/finally`. Call:

```ts
const visionResult = await this.visionProxyService.prepare({
  selectedModel: requestSelectedModel,
  messages: messages as readonly HostChatRequestMessage[],
  visionProxyComboId: this.snapshot.runtime.visionProxyComboId,
  baseUrl: this.snapshot.runtime.baseUrl,
  apiKey,
  maxTokens: this.snapshot.runtime.maxTokens,
  requestTimeoutMs: this.snapshot.runtime.requestTimeoutMs,
  signal: requestCancellation.signal
});
```

Before the primary stream starts, add:

```ts
if (requestCancellation.signal.aborted) {
  throw new NineRouterError('CANCELLATION_ERROR', '9router request was cancelled');
}
```

Keep exactly one cleanup in the outer `finally`.

- [ ] **Step 6: Log safe Vision metadata only**

Replace the existing Vision log metadata with:

```ts
logDebugEvent(this.snapshot.runtime.debugMode, 'Vision compatibility resolved', {
  displayModel: selectedModel.key,
  visionMode: selectedModel.visionMode,
  visionOutcome: visionResult.outcome,
  hasVisionInput: visionResult.hasVisionInput,
  imageCount: visionResult.imageCount,
  imageMessageCount: visionResult.imageMessageCount,
  visionRequestIds: visionResult.requestIds.join(','),
  durationMs: Date.now() - visionStartedAt
});
```

Do not log messages, request bodies, image objects, summaries, data URLs, or credentials.

- [ ] **Step 7: Preserve primary combo error mapping**

Use one outer handler:

```ts
} catch (error) {
  throw mapProviderError(error, selectedModel);
} finally {
  requestCancellation.cleanup();
}
```

The service has already converted Vision combo errors to `CONFIGURATION_ERROR`; `mapProviderError` therefore continues to map only a primary `COMBO_MAPPING_ERROR` to `modelMappings.<display model>`.

- [ ] **Step 8: Verify GREEN, run the provider suite, and commit**

```bash
pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/timeout-cancellation.test.ts
pnpm exec vitest run test/unit/config/settings.test.ts test/unit/provider/image-input-adapter.test.ts test/unit/provider/model-catalog.test.ts test/unit/provider/request-adapter.test.ts test/unit/provider/vision-proxy.test.ts test/integration/extension/diagnostics-command.test.ts test/integration/extension/settings-refresh.test.ts test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/timeout-cancellation.test.ts
```

Expected: all selected files PASS with no unhandled rejection or leaked timer.

```bash
git add src/provider/provider.ts test/integration/extension/text-stream-roundtrip.test.ts test/integration/extension/timeout-cancellation.test.ts
git commit -m "feat: orchestrate fail-closed vision requests"
```

### Task 5: Documentation, Architecture Alignment, and Release Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`
- Modify: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Consumes: runtime behavior from Tasks 1-4.
- Produces: exact user setup and fail-closed operational guidance.
- Produces: canonical architecture aligned with the shared 9router Vision combo.

- [ ] **Step 1: Write the failing documentation guardrail**

Add to `test/integration/extension/release-guardrails.test.ts`:

```ts
it('documents the shared fail-closed 9router Vision proxy', async () => {
  const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
  const productionDesign = await readFile(resolve(
    process.cwd(),
    'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
  ), 'utf8');

  for (const document of [readme, productionDesign]) {
    expect(document).toContain('9router-copilot.visionProxyComboId');
    expect(document).toContain('shared');
    expect(document).toContain('fail-closed');
    expect(document).toContain('image_url');
  }
  expect(readme).toContain('Vision proxy summary');
  expect(productionDesign).toContain('VisionProxyService');
  expect(productionDesign).toContain('must not reach the primary combo');
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: FAIL because current docs still specify an unspecified host-compatible Vision model.

- [ ] **Step 3: Update README**

Add to the settings example:

```json
"9router-copilot.visionProxyComboId": "replace-with-existing-vision-combo-id"
```

Update `### Vision Mode` to state:

```text
proxy: Send each image-bearing message to the shared combo configured by
9router-copilot.visionProxyComboId, replace raw images with a
[Vision proxy summary] text block, then send the transformed conversation to
the selected Daily, Agent, or Fallback combo.
```

Document that the combo must accept OpenAI-compatible `image_url` data URLs; one sequential Vision request runs per image-bearing message; multiple images in one message are batched; any missing combo, 404, timeout, cancellation, malformed stream, or upstream error stops the primary request; tools and Thinking Effort apply only to the primary request; image/prompt/summary content never appears in diagnostics.

Add common-issue entries for missing shared combo and upstream MIME/size incompatibility.

- [ ] **Step 4: Align the canonical production design**

In `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`:

- add `9router-copilot.visionProxyComboId` to per-user settings;
- replace the host-compatible model step with the shared 9router combo;
- name `VisionProxyService` and `image-input-adapter.ts`;
- document conversion from `LanguageModelDataPart` to `image_url` data URL;
- state that all Vision-stage errors are fail-closed and the transformed request must not reach the primary combo;
- retain explicit native Vision and 9router ownership of routing/fallback.

Do not edit `docs/9router-copilot-chat-provider-system-design.md`.

- [ ] **Step 5: Verify GREEN and commit docs**

Run the command from Step 2. Expected: PASS.

```bash
git add README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: document shared vision proxy flow"
```

- [ ] **Step 6: Run the mandatory verification gate**

Run each separately and require exit code 0:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

Expected: build and lint succeed, all tests pass, and `9router-copilot-chat-provider-0.1.0.vsix` is created.

- [ ] **Step 7: Perform the live compatibility check when a Vision combo is available**

Use VS Code user settings, never repository files:

```json
{
  "9router-copilot.modelMappings.agent": "<existing-primary-combo-id>",
  "9router-copilot.visionMode.agent": "proxy",
  "9router-copilot.visionProxyComboId": "<existing-native-vision-combo-id>",
  "9router-copilot.debugMode": "metadata"
}
```

Store the API key only with `9router: Set API Key`. In the Extension Development Host:

1. Select `Agent`, attach a PNG with visible text, and request transcription.
2. Confirm the answer uses the text and diagnostics contain counts/request ids but no prompt, base64, or summary.
3. Repeat with a JPEG.
4. Configure a missing Vision combo and confirm the error names the shared setting and the primary combo is not called.

Expected: PNG and JPEG work for the chosen combo and the missing combo fails closed. Treat a format rejection as combo compatibility information; do not add local fallback.

- [ ] **Step 8: Review final scope and sensitive data**

Run:

```bash
git status --short
git diff --check
git diff --stat HEAD~4..HEAD
rg -n "data:image|Vision proxy summary|visionProxyComboId|authorization" src test README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md
```

Expected: only planned files changed; no whitespace errors; `data:image` occurs only in conversion/tests; no API key or authorization value is committed; user-owned main-workspace edits remain untouched.

## Completion Criteria

- Five task-scoped implementation commits exist after the plan commit.
- Every design acceptance criterion has an automated test or the explicit live check.
- Build, lint, unit, integration, and package verification pass.
- Use `superpowers:requesting-code-review` before merge.
- Use `superpowers:finishing-a-development-branch` for integration and cleanup.
