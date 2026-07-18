# Reasoning Detail Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render OpenAI-compatible reasoning string deltas as native Copilot Chat thinking detail when the running VS Code host supports `LanguageModelThinkingPart`, with a safe drop fallback and no reasoning leakage into visible text, history, or diagnostics.

**Architecture:** Add one normalized `reasoning-delta` to the router stream contract, parse it at the SSE boundary, and translate it in the provider stream adapter through a narrow runtime-gated compatibility module. Keep final text and tool calls on their existing paths. Omit host thinking parts from replayed assistant text and emit only aggregate reasoning metadata after the primary stream.

**Tech Stack:** TypeScript 5.6 strict mode, VS Code Language Model Chat Provider API, proposed `LanguageModelThinkingPart` runtime surface, OpenAI-compatible `/v1/chat/completions` SSE, Vitest 4, pnpm, ESLint, `@vscode/vsce`

> **Runtime hardening amendment (2026-07-18):** A live VS Code 1.129 run proved
> that native thinking parts were available but the primary stream ended in
> cancellation with no normalized reasoning. The implementation therefore
> accepts the documented string aliases and emits safe aggregate diagnostics
> for every started primary stream, including zero-delta and interrupted runs.

## Global Constraints

- Follow `AGENTS.md`, `CODE_CONVENTION.md`, and `docs/superpowers/specs/2026-07-18-reasoning-detail-streaming-design.md`.
- Preserve the thin provider adapter architecture and keep `9router` as the only routing authority.
- Prefer `choices[0].delta.reasoning_content` and accept the documented string aliases at the SSE compatibility boundary; do not infer nested provider-specific objects.
- Emit reasoning automatically when received and supported; add no setting.
- Do not add `enabledApiProposals` to `package.json`.
- Never convert dropped reasoning to `LanguageModelTextPart`.
- Never log, dump, or persist reasoning content, including in verbose mode.
- Do not replay thinking parts to `9router` unless a future canonical router contract explicitly requires it.
- Keep internal Vision proxy reasoning out of the user-facing primary response.
- Add no dependency and no custom chat UI.
- Follow TDD: observe each new behavior fail before editing production code.
- Before completion, run build, lint, unit, integration, and package commands.

---

### Task 1: Normalize reasoning at the SSE boundary

**Files:**

- Modify: `test/unit/router/sse-parser.test.ts`
- Modify: `src/types/router-contract.ts`
- Modify: `src/router/sse-parser.ts`

**Interfaces:**

- Produces: `RouterStreamEvent` variant `{ type: 'reasoning-delta'; text: string }`
- Consumes: canonical `choices[0].delta.reasoning_content` and documented string aliases as untrusted input
- Preserves: usage, visible text, tool calls, finish reasons, router errors, and SSE buffering

- [ ] **Step 1: Replace the hidden-reasoning regression with failing parser tests**

Cover these cases in `test/unit/router/sse-parser.test.ts`:

```ts
it('extracts reasoning deltas from OpenAI-style reasoning content', () => {
  const events = parseSseChunk(
    'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\n'
  );

  expect(events).toEqual([
    { type: 'reasoning-delta', text: 'private reasoning' }
  ]);
});

it('emits reasoning before visible content from the same frame', () => {
  const events = parseSseChunk(
    'data: {"choices":[{"delta":{"content":"Visible","reasoning_content":"private reasoning"}}]}\n\n'
  );

  expect(events).toEqual([
    { type: 'reasoning-delta', text: 'private reasoning' },
    { type: 'text-delta', text: 'Visible' }
  ]);
});
```

Also add table coverage proving empty strings, numbers, objects, arrays, booleans,
and `null` do not produce reasoning events or fail an otherwise valid frame.

- [ ] **Step 2: Run the parser tests and confirm RED**

```bash
pnpm exec vitest run test/unit/router/sse-parser.test.ts
```

Expected: the reasoning-only expectation fails because the parser currently
ignores the field, and the mixed-frame expectation contains only visible text.

- [ ] **Step 3: Add the typed normalized event**

Add this member to `RouterStreamEvent` in `src/types/router-contract.ts`:

```ts
| { type: 'reasoning-delta'; text: string }
```

Do not add reasoning to `RouterMessage` or the request contract.

- [ ] **Step 4: Validate and emit reasoning before visible text**

In the local SSE payload shape, declare the canonical field and documented
aliases as `unknown`. Resolve the first non-empty string in precedence order
before processing `delta.content`:

```ts
const reasoning = getReasoningDelta(choice.delta);
if (reasoning) {
  events.push({ type: 'reasoning-delta', text: reasoning });
}
```

Do not trim or concatenate the model's delta. Streaming chunk boundaries remain
owned by the router response.

- [ ] **Step 5: Run focused parser coverage and confirm GREEN**

```bash
pnpm exec vitest run test/unit/router/sse-parser.test.ts test/unit/router/client.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands exit `0`; reasoning precedes sibling text while all
existing router events remain unchanged.

---

### Task 2: Add the proposed VS Code compatibility boundary

**Files:**

- Create: `src/provider/reasoning-part-compat.ts`
- Create: `test/unit/provider/reasoning-part-compat.test.ts`
- Modify: `test/support/vscode.ts`

**Interfaces:**

- Produces: `createLanguageModelThinkingResponsePart(value, api?)`
- Produces: `isLanguageModelThinkingPart(value, api?)`
- Returns: stable `LanguageModelResponsePart | undefined` to callers
- Contains: all casts involving the proposed thinking-part surface

- [ ] **Step 1: Extend the VS Code test double**

Add a minimal `LanguageModelThinkingPart` test class with a readonly `value`
and export it from `test/support/vscode.ts`. Keep it structurally limited to the
feature's runtime needs.

- [ ] **Step 2: Write failing supported and unsupported runtime tests**

Create `test/unit/provider/reasoning-part-compat.test.ts` to prove:

- the default test runtime creates an object with the supplied value
- the object is recognized as a thinking part
- an API object without the constructor returns `undefined`
- a text-like object is not treated as a thinking part when the constructor is
  unavailable

The unsupported test must assert that private reasoning is not returned as a
text response part.

- [ ] **Step 3: Run compatibility tests and confirm RED**

```bash
pnpm exec vitest run test/unit/provider/reasoning-part-compat.test.ts
```

Expected: FAIL because the compatibility module does not exist.

- [ ] **Step 4: Implement the narrow runtime probe**

The module should:

1. accept `unknown` for the API surface
2. verify the surface is an object or function
3. read `LanguageModelThinkingPart`
4. accept it only when it is a constructor function
5. return `undefined` when absent
6. confine the `unknown` to stable response-union cast to this file

Do not augment the global `vscode` declarations and do not change the manifest.

- [ ] **Step 5: Run compatibility tests, type-checking, and lint**

```bash
pnpm exec vitest run test/unit/provider/reasoning-part-compat.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands exit `0`; supported and unsupported hosts are both typed
and tested without broad `any` usage.

---

### Task 3: Stream native thinking parts and track safe aggregates

**Files:**

- Modify: `test/unit/provider/stream-adapter.test.ts`
- Modify: `src/provider/stream-adapter.ts`

**Interfaces:**

- Consumes: `RouterStreamEvent` reasoning deltas
- Produces: proposed thinking parts when supported
- Produces: `ReasoningStreamSummary`
- Preserves: text, usage, and tool-call response behavior

- [ ] **Step 1: Add failing native-thinking emission coverage**

Add a stream-adapter test that emits a `reasoning-delta`, captures reported
parts, and proves the first result is a runtime thinking part with the original
value. Keep the assertion structural through `isLanguageModelThinkingPart`
instead of adding proposed API types throughout the test.

- [ ] **Step 2: Add failing aggregate and fallback coverage**

Cover multiple deltas and assert:

```ts
{
  receivedDeltas: 2,
  receivedCharacters: 11,
  emittedDeltas: 2,
  droppedDeltas: 0
}
```

Inject or otherwise exercise an unsupported compatibility surface and prove
that reasoning produces no progress part while `receivedDeltas`,
`receivedCharacters`, and `droppedDeltas` still advance. Visible text emitted
after the dropped reasoning must still be reported normally.

- [ ] **Step 3: Run stream-adapter tests and confirm RED**

```bash
pnpm exec vitest run test/unit/provider/stream-adapter.test.ts
```

Expected: FAIL because the adapter does not handle `reasoning-delta` or expose a
summary.

- [ ] **Step 4: Implement immediate emission and summary tracking**

Extend `RouterEventEmitter` with:

```ts
getReasoningSummary(): ReasoningStreamSummary;
```

For each reasoning event:

1. increment received delta and character counts
2. ask the compatibility helper to create a thinking part
3. report it and increment emitted count when available
4. otherwise increment dropped count
5. return without entering text, usage, or tool-call branches

Return a copy of summary state so callers cannot mutate the accumulator.

- [ ] **Step 5: Run adapter regression coverage**

```bash
pnpm exec vitest run test/unit/provider/stream-adapter.test.ts test/unit/provider/reasoning-part-compat.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands exit `0`; thinking, text, usage, and tool-call parts
remain independently emitted.

---

### Task 4: Keep thinking parts out of router history

**Files:**

- Modify: `test/unit/provider/request-adapter.test.ts`
- Modify: `src/provider/request-adapter.ts`

**Interfaces:**

- Consumes: prior host assistant messages containing runtime thinking parts
- Produces: router history containing visible assistant text and supported tool
  history only
- Preserves: ordinary text, native image, tool call, and tool result adaptation

- [ ] **Step 1: Add a failing history test**

Build an assistant message containing a thinking part followed by
`LanguageModelTextPart('Visible answer')`. Assert the outgoing router message is:

```ts
{
  role: 'assistant',
  content: 'Visible answer'
}
```

The assertion must prove the reasoning string is absent from all serialized
request messages.

- [ ] **Step 2: Run request-adapter tests and confirm RED**

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts
```

Expected: FAIL because generic value extraction currently treats the proposed
thinking part as normal assistant text.

- [ ] **Step 3: Omit recognized thinking parts before generic text extraction**

Use `isLanguageModelThinkingPart` before the existing `{ value: string }`
branch and return an empty contribution for thinking parts. Do not serialize a
new request field and do not add provider-specific history logic.

- [ ] **Step 4: Run all request adaptation tests**

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts test/unit/provider/tool-adapter.test.ts test/unit/provider/image-input-adapter.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands exit `0`; visible assistant history, tool loops, and
Vision behavior remain unchanged.

---

### Task 5: Add privacy-safe provider diagnostics and integration coverage

**Files:**

- Modify: `test/integration/extension/text-stream-roundtrip.test.ts`
- Modify: `src/provider/provider.ts`

**Interfaces:**

- Consumes: `RouterEventEmitter.getReasoningSummary()` when the primary stream terminates
- Produces: `Reasoning stream diagnostic` safe metadata event
- Never produces: raw reasoning content or serialized response parts in logs

- [ ] **Step 1: Add a failing provider round-trip test**

Have the fake router client yield:

```ts
{ type: 'reasoning-delta', text: 'diagnostic-secret-reasoning' }
{ type: 'text-delta', text: 'Visible answer' }
{ type: 'response-complete' }
```

Capture progress and assert the thinking part precedes the visible text part.
Keep existing tool and usage assertions intact.

- [ ] **Step 2: Add a failing diagnostics privacy test**

With `debugMode: 'minimal'`, assert the output includes:

- `Reasoning stream diagnostic`
- the selected curated display model
- received, emitted, dropped, and character counts
- terminal outcome and `hostThinkingPartAvailable`

Assert the output does not contain `diagnostic-secret-reasoning`. Repeat the
content-leak assertion for `verbose` if the test harness supports changing the
level without weakening existing redaction expectations.

- [ ] **Step 3: Run integration coverage and confirm RED**

```bash
pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: the response adaptation may pass after Task 3, but the summary event
is absent until provider integration is added.

- [ ] **Step 4: Log one safe terminal aggregate**

In `finally`, read the emitter summary whenever the primary stream was started.
Emit `Reasoning stream diagnostic` at the minimal threshold even when the
received count is zero or the stream was cancelled or failed:

```ts
{
  displayModel,
  effectiveThinkingMode,
  outcome,
  receivedDeltas,
  receivedCharacters,
  emittedDeltas,
  droppedDeltas,
  hostThinkingPartAvailable
}
```

Do not pass the event text, raw router event, progress part, messages, or SSE
payload to the logger. Do not emit a reasoning summary for a stream that
contained no reasoning.

- [ ] **Step 5: Prove safe fallback does not break the final answer**

Add integration or focused adapter coverage for a host without the thinking
constructor. The final visible text and response completion must still succeed,
and the dropped count must reflect every received reasoning delta.

- [ ] **Step 6: Run provider and privacy regression coverage**

```bash
pnpm exec vitest run test/integration/extension/text-stream-roundtrip.test.ts test/unit/provider/stream-adapter.test.ts test/unit/debug/redaction.test.ts
pnpm run build
pnpm run lint
```

Expected: all commands exit `0`; logs contain aggregate counts only.

---

### Task 6: Update active documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`
- Modify: `docs/superpowers/specs/2026-07-16-thinking-mode-configuration-design.md`
- Verify: `docs/superpowers/specs/2026-07-18-reasoning-detail-streaming-design.md`
- Verify: `docs/superpowers/plans/2026-07-18-reasoning-detail-streaming.md`

**Interfaces:**

- Documents: automatic runtime-gated native reasoning detail
- Documents: safe drop behavior and no new setting
- Documents: metadata-only diagnostics and no history replay
- Supersedes: earlier hidden-reasoning statements only

- [ ] **Step 1: Update README user behavior**

After Thinking Effort, explain that primary reasoning is shown automatically in
Copilot Chat when `9router` sends a recognized reasoning string and the host
supports the proposed thinking part. Clarify that unsupported hosts drop only reasoning,
that final text continues, and that the extension cannot control native labels
or layout.

- [ ] **Step 2: Update the canonical production design**

Replace `Reasoning deltas remain hidden` with the runtime-gated stream design.
Cover stream order, compatibility ownership, safe fallback, diagnostics, and
history omission without changing router ownership.

- [ ] **Step 3: Mark the earlier non-goal as superseded**

Add a short note in the thinking-mode design stating that the 2026-07-18 design
supersedes only the non-goal about rendering reasoning deltas. Keep all request
mapping and other non-goals intact.

- [ ] **Step 4: Check active documentation for contradictions**

```bash
rg -n "Reasoning deltas remain hidden|Rendering reasoning or chain-of-thought deltas" README.md docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md docs/superpowers/specs/2026-07-16-thinking-mode-configuration-design.md docs/superpowers/specs/2026-07-18-reasoning-detail-streaming-design.md
```

Expected: active README and canonical design contain no stale hidden-reasoning
claim; the older non-goal appears only beside its explicit superseding note.

- [ ] **Step 5: Run documentation guardrails and diff checks**

```bash
pnpm run test:integration
git diff --check
```

Expected: documentation guardrails pass and Git reports no whitespace errors.

---

### Task 7: Run the complete release gate

**Files:**

- Verify: all files changed by Tasks 1-6
- Generated artifact: `9router-copilot-chat-provider-0.2.0.vsix`

**Interfaces:**

- Produces: release evidence for supported and unsupported host behavior
- Preserves: package exclusions and a focused intentional diff

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

Expected: all suites pass with no reasoning-detail regression skipped.

- [ ] **Step 3: Package the extension**

```bash
pnpm run package
pnpm exec vsce ls --no-dependencies
```

Expected: packaging succeeds; compiled extension files, manifest, README, and
license are included while source, tests, and internal design docs remain
excluded according to `.vscodeignore`.

- [ ] **Step 4: Inspect final state**

```bash
git status --short
git diff --check
git diff --stat
```

Expected: no whitespace errors or unrelated changes; the diff contains the
reasoning stream contract, compatibility boundary, focused tests, safe
diagnostics, and documentation only.
