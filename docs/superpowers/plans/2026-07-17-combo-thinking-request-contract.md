# Combo Thinking Request Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep configured 9router combo ids unchanged while forwarding Copilot Thinking Effort through `reasoning_effort`, and stop treating unrelated HTTP 404 responses as missing combo mappings.

**Architecture:** The request adapter remains the only owner of the OpenAI-compatible payload shape. It writes the validated combo id to `model` and, for enabled thinking levels, writes `reasoning_effort` separately so 9router can resolve the combo before translating thinking for the selected upstream model. The router client classifies a 404 as `COMBO_MAPPING_ERROR` only when the response explicitly names a missing or unknown model/combo.

**Tech Stack:** TypeScript 5.6, VS Code Language Model API types, Vitest 4, pnpm

## Global Constraints

- Preserve the thin provider adapter architecture and keep 9router as the only routing authority.
- Keep `Daily`, `Agent`, and `Fallback` separate from backend combo ids.
- Keep requests streaming-first through the OpenAI-compatible `/v1/chat/completions` contract.
- Do not add dependencies or change secret handling.
- Preserve the user's existing uncommitted `tsconfig.json` change.
- Follow TDD: observe each regression test fail for the expected reason before changing production code.

---

### Task 1: Forward Thinking Effort Without Mutating the Combo Id

**Files:**
- Modify: `src/types/router-contract.ts`
- Modify: `src/provider/request-adapter.ts`
- Test: `test/unit/provider/request-adapter.test.ts`

**Interfaces:**
- Consumes: `DisplayModelSetting.thinkingMode: ThinkingMode`
- Produces: `RouterChatCompletionRequest.reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
- Preserves: `RouterChatCompletionRequest.model` as the exact validated `comboId`

- [ ] **Step 1: Replace the suffix expectation with a failing combo regression test**

In `test/unit/provider/request-adapter.test.ts`, replace the existing test named `appends the configured thinking mode to the router model name` with:

```typescript
it('keeps the combo id bare and forwards thinking as reasoning_effort', () => {
  const request = adaptMessagesToRouterRequest({
    selectedModel: {
      key: 'agent',
      label: 'Agent',
      comboId: '123',
      enabled: true,
      toolMode: 'auto',
      visionMode: 'off',
      thinkingMode: 'high'
    },
    messages: [{ role: 1, content: 'Solve this carefully' }]
  });

  expect(request).toMatchObject({
    model: '123',
    reasoning_effort: 'high'
  });
});
```

Add this assertion to the existing test `maps the selected display model to the configured combo id`, after its `toMatchObject` assertion:

```typescript
expect(request).not.toHaveProperty('reasoning_effort');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts
```

Expected: FAIL because the request model is `123(high)` and `reasoning_effort` is absent.

- [ ] **Step 3: Add the request field and minimal adapter behavior**

In `src/types/router-contract.ts`, add the optional field to `RouterChatCompletionRequest`:

```typescript
reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
```

In `src/provider/request-adapter.ts`, delete `resolveRouterModelName`. Initialize the request with the bare combo id:

```typescript
const request: RouterChatCompletionRequest = {
  model: input.selectedModel.comboId,
  stream: true,
  messages
};
```

Immediately after request initialization, add:

```typescript
if (input.selectedModel.thinkingMode !== 'off') {
  request.reasoning_effort = input.selectedModel.thinkingMode;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts
```

Expected: all request-adapter tests PASS with no warnings.

- [ ] **Step 5: Commit the request-contract fix**

```bash
git add src/types/router-contract.ts src/provider/request-adapter.ts test/unit/provider/request-adapter.test.ts
git commit -m "fix: forward combo thinking in request body"
```

---

### Task 2: Stop Misclassifying Unrelated 404 Responses

**Files:**
- Modify: `src/router/client.ts`
- Test: `test/unit/router/client.test.ts`

**Interfaces:**
- Consumes: HTTP status, optional `x-request-id`, and raw 9router error body
- Produces: `COMBO_MAPPING_ERROR` only for explicit missing/unknown model or combo messages
- Produces: `TRANSPORT_ERROR` for other HTTP 404 responses

- [ ] **Step 1: Add failing classification tests through the public router client**

Append these tests inside `describe('createRouterClient', ...)` in `test/unit/router/client.test.ts`:

```typescript
it('classifies an explicit missing combo 404 as a combo mapping error', async () => {
  const client = createRouterClient({
    fetch: vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'x-request-id': 'req-missing-combo' }),
      text: async () => '{"error":{"message":"Combo not found"}}'
    }) as never
  });

  const consume = async (): Promise<void> => {
    for await (const _event of client.streamChatCompletion({
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret-token',
      request: { model: 'missing-combo', messages: [], stream: true },
      timeoutMs: 1000,
      signal: new AbortController().signal
    })) {
      // The error occurs before any event is emitted.
    }
  };

  await expect(consume()).rejects.toMatchObject({
    code: 'COMBO_MAPPING_ERROR',
    requestId: 'req-missing-combo'
  });
});

it('preserves an unrelated 404 as a transport error', async () => {
  const client = createRouterClient({
    fetch: vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => '{"error":{"message":"No active credentials for provider: openai"}}'
    }) as never
  });

  const consume = async (): Promise<void> => {
    for await (const _event of client.streamChatCompletion({
      baseUrl: 'https://router.example.com/v1',
      apiKey: 'secret-token',
      request: { model: '123', messages: [], stream: true },
      timeoutMs: 1000,
      signal: new AbortController().signal
    })) {
      // The error occurs before any event is emitted.
    }
  };

  await expect(consume()).rejects.toMatchObject({
    code: 'TRANSPORT_ERROR',
    message: '9router request failed with status 404'
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/router/client.test.ts
```

Expected: the unrelated-404 test FAILS because every 404 is currently `COMBO_MAPPING_ERROR`.

- [ ] **Step 3: Implement explicit missing-resource detection**

In `src/router/client.ts`, add this focused predicate above `classifyStatusError`:

```typescript
function isExplicitMissingModelError(responseText: string): boolean {
  const normalized = responseText.toLowerCase();
  return (
    /(?:model|combo)\s+(?:was\s+)?not\s+found/.test(normalized) ||
    /unknown\s+(?:model|combo)/.test(normalized) ||
    /invalid\s+(?:model|combo)/.test(normalized)
  );
}
```

Change the 404 branch to:

```typescript
if (status === 404 && isExplicitMissingModelError(responseText)) {
  return new NineRouterError(
    'COMBO_MAPPING_ERROR',
    '9router combo mapping was not found',
    buildErrorOptions(requestId, details)
  );
}
```

All other 404 responses then reach the existing `TRANSPORT_ERROR` fallback.

- [ ] **Step 4: Run router and provider error tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/router/client.test.ts test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: both test files PASS. The provider integration test continues enriching a real `COMBO_MAPPING_ERROR` with `displayModel`, `comboId`, and `settingsKey`.

- [ ] **Step 5: Commit the classification fix**

```bash
git add src/router/client.ts test/unit/router/client.test.ts
git commit -m "fix: classify router 404 responses precisely"
```

---

### Task 3: Align Current Documentation and Run the Release Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`

**Interfaces:**
- Documents: bare combo id in `model`
- Documents: enabled thinking level in `reasoning_effort`
- Preserves: 9router ownership of provider-specific reasoning translation

- [ ] **Step 1: Update README request-contract guidance**

In `README.md`, replace text that says enabled thinking is sent through a model suffix with:

```markdown
- `None`: Send the base combo id without a reasoning override.
- `Minimal`, `Low`, `Medium`, `High`, `XHigh`, `Max`: Keep the base combo id unchanged and send the selected level through the OpenAI-compatible `reasoning_effort` field.
```

Replace the paragraph that instructs users to avoid a suffixed mapping with:

```markdown
Configure `modelMappings.<model>` with the bare combo id, such as `123`. The extension keeps that id unchanged for combo lookup and sends Thinking Effort separately through `reasoning_effort`, while `9router` remains responsible for provider-specific reasoning translation and provider limits.
```

- [ ] **Step 2: Update the canonical production design**

In `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`, replace the request-contract statements that prescribe a model suffix with:

```markdown
The validated `9router-copilot.thinkingMode.<model>` value supplies that model's schema default and request fallback. A valid `modelConfiguration.reasoningEffort` value overrides the local default for the current request; `none` maps to internal `off`, while the remaining values map directly.

The extension keeps the resolved combo id unchanged in `model`. For a non-`off` effective level, it sets the OpenAI-compatible `reasoning_effort` request field. `9router` owns provider-specific reasoning translation and compatibility policy. Reasoning deltas remain hidden.
```

In the API contract list, replace the suffix statement with:

```markdown
Thinking preferences are configured per curated display model. The extension keeps the resolved combo id unchanged and sends a validated non-`off` level through `reasoning_effort`. `9router` owns provider-specific reasoning translation, normalization, limits, and upstream compatibility.
```

- [ ] **Step 3: Verify documentation guardrails**

Run:

```bash
pnpm exec vitest run test/integration/extension/release-guardrails.test.ts
```

Expected: PASS. If a guardrail still requires suffix-specific wording, update the assertion to require `reasoning_effort` and the bare combo contract, then rerun until PASS.

- [ ] **Step 4: Run the full mandatory verification gate**

Run each command independently:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

Expected: all five commands exit 0. Packaging produces `9router-copilot-chat-provider-0.1.0.vsix`.

- [ ] **Step 5: Review the final diff and commit documentation**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the user's pre-existing `tsconfig.json` change and intentional task files are listed before the final commit.

Commit only documentation changed by this task:

```bash
git add README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md
git commit -m "docs: document combo reasoning request field"
```
