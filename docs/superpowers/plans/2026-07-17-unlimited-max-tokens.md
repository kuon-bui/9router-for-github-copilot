# Unlimited Max Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `9router-copilot.maxTokens` default to `0` and omit `max_tokens` from primary and Vision proxy requests whenever the configured value is not a positive safe integer.

**Architecture:** Normalize the setting once at the VS Code configuration boundary into `number | undefined`. Request adapters keep their existing contract: a numeric normalized value is forwarded, while `undefined` is omitted. Invalid values intentionally degrade to unlimited behavior without invalidating the settings snapshot.

**Tech Stack:** TypeScript 5.9 strict mode, VS Code configuration contributions, OpenAI-compatible `/v1/chat/completions`, Vitest 4, pnpm, ESLint, `@vscode/vsce`

## Global Constraints

- Follow `AGENTS.md`, `CODE_CONVENTION.md`, and `docs/superpowers/specs/2026-07-17-unlimited-max-tokens-design.md`.
- `9router-copilot.maxTokens` defaults to `0`.
- Only positive safe integers are forwarded as `max_tokens`.
- Zero, negative, decimal, non-finite, missing, and non-number values normalize to `undefined` and do not invalidate runtime settings.
- The policy applies identically to primary and shared Vision proxy requests.
- Do not derive a request limit from per-model `maxOutputTokens`.
- Keep `9router` and upstream providers free to enforce their own limits.
- Add no dependency and do not change Context Window publication.
- Follow TDD: observe every new behavior fail before editing production code.
- Before completion, run build, lint, unit, integration, and package commands.

---

### Task 1: Normalize configuration and prove both request paths

**Files:**
- Modify: `test/unit/config/settings.test.ts`
- Modify: `test/integration/extension/release-guardrails.test.ts`
- Modify: `test/integration/extension/text-stream-roundtrip.test.ts`
- Modify: `src/config/settings.ts`
- Modify: `src/config/defaults.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizeMaxTokens(input: unknown): number | undefined`
- Produces: `RuntimeSettings.maxTokens` as a positive safe integer or `undefined`
- Removes: runtime issue code `INVALID_MAX_TOKENS`
- Verifies: no `max_tokens` on either Vision proxy or primary requests for configured `0`
- Preserves: positive limits on both request paths and all unrelated runtime validation

- [ ] **Step 1: Add failing normalization and snapshot tests**

Add `normalizeMaxTokens` to the import list in `test/unit/config/settings.test.ts`, then add:

```ts
describe('max token normalization', () => {
  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -1],
    ['decimal', 1.5],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['string', '4096'],
    ['null', null],
    ['object', { value: 4096 }]
  ])('normalizes %s to unlimited', (_label, input) => {
    expect(normalizeMaxTokens(input)).toBeUndefined();
  });

  it('preserves a positive safe integer', () => {
    expect(normalizeMaxTokens(4_096)).toBe(4_096);
  });

  it('defaults missing maxTokens to unlimited runtime behavior', () => {
    expect(loadRuntimeSettings(configuration({})).maxTokens).toBeUndefined();
  });
});
```

Add under `buildSettingsSnapshot`:

```ts
it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'invalid', null])(
  'keeps runtime valid when maxTokens is %s',
  (maxTokens) => {
    const snapshot = buildSettingsSnapshot(
      configuration({
        models: [{ id: 'coder', name: 'Coder', modelId: 'router/coder' }],
        maxTokens
      })
    );

    expect(snapshot.state).toBe('valid');
    expect(snapshot.runtime?.maxTokens).toBeUndefined();
    expect(snapshot.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'INVALID_MAX_TOKENS' })])
    );
  }
);
```

- [ ] **Step 2: Add a failing manifest guardrail**

Add to `test/integration/extension/release-guardrails.test.ts`:

```ts
it('defaults maxTokens to unlimited', () => {
  const properties = manifest.contributes.configuration.properties as Record<string, unknown>;

  expect(properties['9router-copilot.maxTokens']).toMatchObject({
    type: 'integer',
    minimum: 0,
    default: 0
  });
});
```

- [ ] **Step 3: Add a failing end-to-end request test**

Add to the `NineRouterChatProvider` suite in `test/integration/extension/text-stream-roundtrip.test.ts`:

```ts
it('omits max_tokens from Vision and primary requests when maxTokens is zero', async () => {
  __setConfigurationValues({
    models: [
      {
        id: 'agent',
        name: 'Agent',
        modelId: 'router/agent',
        visionMode: 'proxy'
      }
    ],
    visionProxyModelId: 'router/vision',
    baseUrl: 'https://router.example.com/v1',
    maxTokens: 0,
    requestTimeoutMs: 5_000,
    debugMode: 'minimal'
  });

  const requests: RouterChatCompletionRequest[] = [];
  const provider = new NineRouterChatProvider(
    { secrets: { get: async () => 'token' } } as never,
    {
      async *streamChatCompletion(input: { request: RouterChatCompletionRequest }) {
        requests.push(input.request);
        if (input.request.model === 'router/vision') {
          yield { type: 'text-delta', text: 'safe image summary' };
        }
        yield { type: 'response-complete' };
      }
    } as never
  );

  await provider.provideLanguageModelChatResponse(
    {
      id: 'agent',
      name: 'Agent',
      vendor: '9router',
      family: 'agent',
      version: '1',
      maxInputTokens: 128_000,
      maxOutputTokens: 8_192,
      capabilities: { imageInput: true }
    },
    [
      {
        role: 1,
        content: [{ mimeType: 'image/png', data: new Uint8Array([1]) }]
      }
    ] as never,
    {} as never,
    { report: () => undefined } as never,
    __createCancellationToken().value as never
  );

  expect(requests.map((request) => request.model)).toEqual([
    'router/vision',
    'router/agent'
  ]);
  expect(requests[0]).not.toHaveProperty('max_tokens');
  expect(requests[1]).not.toHaveProperty('max_tokens');
});
```

In the existing test `summarizes images before calling the selected model`, after `expect(calls).toHaveLength(2)`, add the positive-limit regression:

```ts
expect(calls[0]?.request.max_tokens).toBe(128);
expect(calls[1]?.request.max_tokens).toBe(128);
```

- [ ] **Step 4: Run all new behavior and confirm RED**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts test/integration/extension/text-stream-roundtrip.test.ts
```

Expected failures:

- `normalizeMaxTokens` is not exported
- missing `maxTokens` still loads `4096`
- invalid values still create `INVALID_MAX_TOKENS` or invalidate the runtime
- manifest still uses `type: number`, `minimum: 1`, and `default: 4096`
- the zero-limit provider request is blocked by invalid runtime settings

- [ ] **Step 5: Implement boundary normalization**

Change `src/config/defaults.ts`:

```ts
export const DEFAULT_MAX_TOKENS = 0;
```

In `src/config/settings.ts`, remove `INVALID_MAX_TOKENS` from `RuntimeSettingsIssue['code']` and add:

```ts
export function normalizeMaxTokens(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0
    ? input
    : undefined;
}
```

Replace the `maxTokens` read in `loadRuntimeSettings` with:

```ts
const maxTokens = normalizeMaxTokens(
  configuration.get<unknown>('maxTokens') ?? DEFAULT_MAX_TOKENS
);
```

Delete the `INVALID_MAX_TOKENS` validation block from `validateRuntimeSettings`. Do not change the base URL or request timeout checks.

Change `package.json` to:

```json
"9router-copilot.maxTokens": {
  "type": "integer",
  "minimum": 0,
  "default": 0,
  "description": "Maximum response tokens requested from 9router. Use 0 to omit max_tokens and apply no extension-level limit."
}
```

No provider or adapter production edit is needed: the provider already passes only a defined runtime value, and both request builders already omit an absent optional value.

- [ ] **Step 6: Run focused coverage and confirm GREEN**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts test/integration/extension/text-stream-roundtrip.test.ts test/unit/provider/request-adapter.test.ts test/unit/provider/vision-proxy.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands exit `0`; zero and malformed values omit the field, while `128` remains present on both request paths.

- [ ] **Step 7: Commit the runtime behavior**

```bash
git add package.json src/config/defaults.ts src/config/settings.ts test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts test/integration/extension/text-stream-roundtrip.test.ts
git commit -m "feat: support unlimited max tokens"
```

---

### Task 2: Document unlimited semantics

**Files:**
- Modify: `test/integration/extension/release-guardrails.test.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`

**Interfaces:**
- Documents: `0` and malformed values omit `max_tokens`
- Clarifies: unlimited is extension-local and backend/upstream limits still apply

- [ ] **Step 1: Add a failing documentation guardrail**

Add to `test/integration/extension/release-guardrails.test.ts`:

```ts
it('documents unlimited maxTokens semantics', async () => {
  const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
  const productionDesign = await readFile(
    resolve(
      process.cwd(),
      'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
    ),
    'utf8'
  );

  for (const document of [readme, productionDesign]) {
    expect(document).toContain('default is `0`');
    expect(document).toContain('omits `max_tokens`');
    expect(document).toContain('upstream');
  }
});
```

- [ ] **Step 2: Run the guardrail and confirm RED**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts -t "unlimited maxTokens"
```

Expected: FAIL because the active documents still show `4096` and describe `max_tokens` as always controlled by the setting.

- [ ] **Step 3: Update README and canonical design**

In `README.md`:

- change the settings example to `"9router-copilot.maxTokens": 0`
- replace the existing maxTokens paragraph with:

```markdown
`9router-copilot.maxTokens` is independent of per-model Context Window metadata. Its default is `0`. A positive integer is sent as `max_tokens`; `0` or a malformed value omits `max_tokens`, applying no extension-level response limit. `9router` or an upstream provider may still enforce its own limit. Streaming requests continue to set `stream_options.include_usage`.
```

In `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`, replace the paragraph claiming the global setting always controls the sent field with:

```markdown
The per-model metadata is independent from `9router-copilot.maxTokens`. The setting's default is `0`. Only a positive safe integer is sent as `max_tokens`; `0` or a malformed value omits `max_tokens`, so the extension applies no response-token limit. `9router` or an upstream provider may still enforce its own limit.
```

- [ ] **Step 4: Run documentation and focused regression coverage**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts test/unit/config/settings.test.ts test/integration/extension/text-stream-roundtrip.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit active documentation**

```bash
git add README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: explain unlimited max tokens"
```

---

### Task 3: Run the complete release gate

**Files:**
- Verify: all files changed by Tasks 1-2
- Generated artifact: `9router-copilot-chat-provider-0.1.0.vsix`

**Interfaces:**
- Produces: fresh release evidence for the complete feature
- Preserves: package exclusions and a clean intentional Git diff

- [ ] **Step 1: Run build and lint**

```bash
pnpm run build
pnpm run lint
```

Expected: both commands exit `0`.

- [ ] **Step 2: Run all tests**

```bash
pnpm run test:unit
pnpm run test:integration
```

Expected: both suites pass with no unlimited-token regression skipped.

- [ ] **Step 3: Package and inspect the VSIX**

```bash
pnpm run package
pnpm exec vsce ls --no-dependencies
```

Expected: package succeeds; compiled extension files, manifest, README, and license are included while `src/**`, `test/**`, `docs/**`, `AGENTS.md`, and `CODE_CONVENTION.md` are excluded.

- [ ] **Step 4: Inspect final state**

```bash
git status --short
git diff --check
git log --oneline -5
```

Expected: no whitespace errors; only intentional feature commits and the ignored VSIX artifact remain.
