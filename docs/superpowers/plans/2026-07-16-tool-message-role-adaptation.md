# Tool Message Role Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Copilot internal plain-text messages from becoming malformed OpenAI `tool` messages without `tool_call_id`.

**Architecture:** Keep role conversion inside the focused request adapter. Classify tool messages from valid tool-result content, map documented VS Code roles explicitly, and degrade unknown host roles to `user`.

**Tech Stack:** TypeScript, VS Code Language Model API types, Vitest, pnpm

## Global Constraints

- Preserve the thin provider adapter architecture.
- Do not add provider-specific DeepSeek behavior.
- Do not discard host context or invent tool call ids.
- Preserve valid `LanguageModelToolResultPart` conversion.
- Preserve all unrelated uncommitted workspace changes.
- Follow TDD and observe the regression test fail before changing production code.

---

### Task 1: Reproduce the Malformed Tool Message

**Files:**
- Modify: `test/unit/provider/request-adapter.test.ts`

**Interfaces:**
- Consumes: `adaptMessagesToRouterRequest(input)`
- Produces: Regression coverage for unknown numeric host roles with plain-text content

- [ ] **Step 1: Add the regression test**

Add:

```ts
it('degrades undocumented numeric roles without tool results to user messages', () => {
  const request = adaptMessagesToRouterRequest({
    selectedModel: {
      key: 'agent',
      label: 'Agent',
      comboId: '123',
      enabled: true,
      toolMode: 'auto',
      visionMode: 'off'
    },
    messages: [
      {
        role: 3,
        content: 'Internal progress-message instructions'
      }
    ]
  });

  expect(request.messages).toEqual([
    {
      role: 'user',
      content: 'Internal progress-message instructions'
    }
  ]);
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts
```

Expected: FAIL because the adapter currently emits `role: 'tool'` without
`tool_call_id`.

### Task 2: Make Tool Classification Content-Driven

**Files:**
- Modify: `src/provider/request-adapter.ts`

**Interfaces:**
- Consumes: host message role and content
- Produces: valid OpenAI-compatible `RouterMessage`

- [ ] **Step 1: Remove undocumented numeric tool-role mapping**

Change `mapRole` so it maps only:

```ts
if (role === 0 || role === 'system') {
  return 'system';
}

if (role === 2 || role === 'assistant') {
  return 'assistant';
}

return 'user';
```

Numeric role `3` and string role `tool` must not map to `tool` without a valid
tool-result part. The content-driven tool-result branch handles valid tool
messages before `mapRole` is called.

- [ ] **Step 2: Require a non-empty tool result call id**

Update the tool-result predicate to require:

```ts
typeof part.callId === 'string' &&
part.callId.trim().length > 0
```

This prevents malformed tool-result-like content from creating an invalid
upstream tool message.

- [ ] **Step 3: Run the targeted test and verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts
```

Expected: all request-adapter tests pass, including valid tool-result
conversion with `tool_call_id`.

### Task 3: Verify Runtime Boundaries and Package

**Files:**
- Verify all modified source, test, manifest, and documentation files

**Interfaces:**
- Consumes: completed role-adaptation fix and prior combo-default fix
- Produces: fresh release-gate evidence

- [ ] **Step 1: Run focused provider and router tests**

Run:

```bash
pnpm exec vitest run test/unit/provider test/unit/router test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Check the worktree**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; pre-existing unrelated changes remain intact.

- [ ] **Step 3: Run the full repository verification gate**

Run each command separately:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

Expected: every command exits with status 0.

- [ ] **Step 4: Inspect the final relevant diff**

Run:

```bash
git diff -- src/provider/request-adapter.ts test/unit/provider/request-adapter.test.ts src/config/defaults.ts package.json README.md test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts
```

Expected: the diff contains only the two approved fixes and their regression
coverage, alongside the user's pre-existing changes outside this file list.
