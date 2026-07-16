# Valid Combo Mapping Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent fresh installations from publishing curated models backed by nonexistent placeholder `9router` combo ids.

**Architecture:** Keep combo definition ownership in `9router`. The extension contributes empty combo mapping defaults, validates mappings locally, and publishes only display models with explicit user-supplied combo ids.

**Tech Stack:** TypeScript, VS Code extension manifest, Vitest, pnpm

## Global Constraints

- Preserve the thin provider adapter architecture.
- Do not discover, create, guess, or route backend combos in the extension.
- Keep `Daily`, `Agent`, and `Fallback` as presentation-layer model names.
- Preserve all unrelated uncommitted cancellation, debugging, and packaging work in the checkout.
- Follow TDD: verify the regression tests fail before changing production configuration.

---

### Task 1: Add Regression Coverage for Empty Mapping Defaults

**Files:**
- Modify: `test/unit/config/settings.test.ts`
- Modify: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_MODEL_MAPPINGS`, `loadDisplayModelSettings(configuration)`
- Produces: Regression expectations for internal and manifest mapping defaults

- [ ] **Step 1: Write the failing unit test**

Add the defaults import:

```ts
import { DEFAULT_MODEL_MAPPINGS } from '../../../src/config/defaults';
```

Add this test inside `describe('loadDisplayModelSettings', ...)`:

```ts
it('does not invent backend combo ids for unconfigured display models', () => {
  const configuration = {
    get: () => undefined
  };

  expect(DEFAULT_MODEL_MAPPINGS).toEqual({
    daily: '',
    agent: '',
    fallback: ''
  });
  expect(loadDisplayModelSettings(configuration as never).map((model) => model.comboId)).toEqual([
    '',
    '',
    ''
  ]);
});
```

- [ ] **Step 2: Write the failing manifest regression test**

Add this test inside `describe('release guardrails', ...)`:

```ts
it('does not contribute placeholder combo ids as executable defaults', () => {
  const properties = manifest.contributes.configuration.properties;

  expect(properties['9router-copilot.modelMappings.daily'].default).toBe('');
  expect(properties['9router-copilot.modelMappings.agent'].default).toBe('');
  expect(properties['9router-copilot.modelMappings.fallback'].default).toBe('');
});
```

- [ ] **Step 3: Run targeted tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts
```

Expected: FAIL because internal defaults and manifest defaults still contain `combo/daily`, `combo/agent`, and `combo/fallback`.

### Task 2: Remove Placeholder Defaults and Align Documentation

**Files:**
- Modify: `src/config/defaults.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`

**Interfaces:**
- Consumes: Existing `DEFAULT_MODEL_MAPPINGS` and VS Code configuration contribution
- Produces: Empty defaults requiring explicit existing `9router` combo ids

- [ ] **Step 1: Make internal defaults non-executable**

Change `DEFAULT_MODEL_MAPPINGS` to:

```ts
export const DEFAULT_MODEL_MAPPINGS: Record<ProductModelKey, string> = {
  daily: '',
  agent: '',
  fallback: ''
};
```

- [ ] **Step 2: Make VS Code contributed defaults empty**

Set each mapping property's `default` to `""` and make its description explicit:

```json
"9router-copilot.modelMappings.agent": {
  "type": "string",
  "default": "",
  "description": "Existing 9router combo id used by the Agent display model. The model stays hidden until configured."
}
```

Apply the corresponding wording to `daily` and `fallback`.

- [ ] **Step 3: Update README configuration and diagnostics guidance**

Replace the three example mappings with:

```json
"9router-copilot.modelMappings.daily": "replace-with-existing-daily-combo-id",
"9router-copilot.modelMappings.agent": "replace-with-existing-agent-combo-id",
"9router-copilot.modelMappings.fallback": "replace-with-existing-fallback-combo-id",
```

Under `### Model Mapping`, state:

```md
The extension does not create or guess combo ids. Each non-empty value must
already exist in the connected `9router` instance. Models with empty mappings
stay out of the picker.
```

Extend the diagnostics list to distinguish:

```md
- Empty combo mapping: configure the relevant `9router-copilot.modelMappings.<model>` setting with an existing combo id.
- Combo not found: the configured id no longer exists in `9router`; recreate the backend combo or update the setting.
```

- [ ] **Step 4: Reconcile the production design**

Replace the recommendation to ship default combo mappings with:

```md
- Ship default display model labels, but keep combo mapping defaults empty.
- Require each published display model to reference an existing user-configured `9router` combo id.
```

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts
```

Expected: PASS with zero failing tests.

### Task 3: Verify the Complete Extension

**Files:**
- Verify all modified source, manifest, documentation, and test files

**Interfaces:**
- Consumes: Completed Tasks 1 and 2
- Produces: Fresh evidence for build, lint, unit, integration, and VSIX packaging

- [ ] **Step 1: Check formatting and unintended changes**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; unrelated pre-existing changes remain preserved.

- [ ] **Step 2: Run the repository verification gate**

Run each command separately:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

Expected: every command exits with status 0.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff -- src/config/defaults.ts package.json README.md test/unit/config/settings.test.ts test/integration/extension/release-guardrails.test.ts docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md
```

Expected: only explicit mapping-default behavior, regression coverage, and aligned documentation changed.
