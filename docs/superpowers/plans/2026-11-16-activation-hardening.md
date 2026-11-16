# Activation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make activation resilient, keep the picker in sync with API-key and settings changes, surface broken settings once, and guide first-run setup.

**Architecture:** `src/runtime/activate.ts` stays the wiring point. New logic goes into three focused runtime modules:
- `settings-refresh.ts`: refresh allowlist and coalescing
- `snapshot-health.ts`: deciding and deduplicating notices
- `welcome.ts`: first-run guidance

One predicate is added to `src/config/secret-store.ts`. Provider, router, and adapter code is untouched.

**Tech Stack:** TypeScript (strict), VS Code extension API 1.146, Vitest with the `vscode` mock at `test/support/vscode.ts`, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-16-activation-hardening-design.md`

## Global Constraints

- Follow `AGENTS.md` and `CODE_CONVENTION.md`. `src/runtime` owns wiring; do not touch request, stream, tool, or Vision adapters.
- No secret value in any log line, notification, or test snapshot. Logs go through `logDebugEvent` (it applies `redactObject`).
- Command ids are exactly: `9routerCopilot.setApiKey`, `9routerCopilot.showDiagnostics`, `9routerCopilot.manageModels`, `9routerCopilot.addModel`.
- The secret key is `9router.apiKey`. The settings section is `9router-copilot`.
- Work on a branch `feat/activation-hardening`, never on `main`.
- Commit messages use Conventional Commits and end with the session's attribution line.
- The final gate runs `pnpm run build`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, and `pnpm run package`.

## Review Focus

1. **A burst of settings writes.** Configure Vision Proxy writes `visionProxyModelId` then `visionProxySource`, so the picker should republish once, not twice. Pinned in Task 2.
2. **Repeated saves of the same broken `settings.json`.** The warning should appear once, not on every save. Pinned in Task 4.
3. **Fresh install.** The shipped default entry has an empty `modelId` and no key is set. The user should see the welcome, not a "hid 1 model entry" warning. Pinned in Tasks 4 and 5.
4. **Clearing the API key.** This fires the same secret-change event and must also republish. Pinned in Task 3.
5. **Copilot Chat missing, rejecting, or never resolving.** Activation should complete in all three cases. Pinned in Task 1.

---

### Task 1: Activation resilience and mock extensions

Covers spec goals 2 and 3, plus de-duplicating the runtime-settings closures.

**Files:**
- Modify: `test/support/vscode.ts`
- Modify: `src/runtime/activate.ts`
- Test: `test/unit/runtime/activate.test.ts`

**Interfaces:**
- Produces (in the test mock, used by Tasks 3–5):
  - `__setExtension(id: string, extension: { activate: () => Promise<void> } | undefined): void`. It makes `extensions.getExtension(id)` return that value.
  - `commands.executeCommand(command: string, ...args: unknown[]): Promise<unknown>`, which records the command id.
  - `__getExecutedCommands(): string[]`
  - `__setInformationResponse(value: string | undefined): void`. It makes `window.showInformationMessage(message, ...items)` resolve to that value. The default stays `undefined`.
  - All of these are cleared by `__resetVscodeState()`.
- Produces (in the test file, used by Tasks 2–5): a `createContext(overrides?)` helper. It returns
  `{ secrets: { get, store, delete, onDidChange }, globalState: { get, update }, subscriptions: [], extensionUri: Uri.file('/ext'), extensionPath: '/ext' }`.
  `onDidChange` is backed by the mock's `EventEmitter<{ key: string }>`, and the emitter is returned alongside the context.

- [ ] **Step 1: Create the branch**

Run: `git switch -c feat/activation-hardening`
Expected: `Switched to a new branch 'feat/activation-hardening'`

- [ ] **Step 2: Extend the mock and write the failing tests**

Move the existing test onto `createContext()`. Add:

```ts
it('completes activation when Copilot Chat is not installed', async () => {
  await activateExtension(createContext().context, hooks());
  expect(__getRegisteredProvider()).toBe(providerStub);
});

it('keeps the provider registered when Copilot Chat activation rejects', async () => {
  __setExtension('GitHub.copilot-chat', { activate: () => Promise.reject(new Error('copilot boom')) });
  await activateExtension(createContext().context, hooks());
  expect(__getRegisteredProvider()).toBe(providerStub);
  await vi.waitFor(() =>
    expect(__getOutputLines().join('\n')).toContain('GitHub Copilot Chat activation failed')
  );
  expect(__getOutputLines().join('\n')).toContain('copilot boom');
});

it('does not wait for Copilot Chat activation to settle', async () => {
  __setExtension('GitHub.copilot-chat', { activate: () => new Promise<void>(() => undefined) });
  await expect(activateExtension(createContext().context, hooks())).resolves.toBeUndefined();
});

it('registers the provider with an empty Vision prompt when the bundled prompt is unreadable', async () => {
  let receivedPrompt: string | undefined;
  await activateExtension(createContext().context, {
    ...hooks(),
    readDefaultVisionProxyPrompt: async () => {
      throw new Error('Unable to read default Vision proxy prompt: /ext/prompts/vision/x.md');
    },
    createProvider: (_c, _r, _s, options) => {
      receivedPrompt = options.defaultVisionProxyPrompt;
      return providerStub;
    }
  });
  expect(receivedPrompt).toBe('');
  expect(__getRegisteredProvider()).toBe(providerStub);
  expect(__getOutputLines().join('\n')).toContain('9router default Vision proxy prompt unavailable');
});
```

`hooks()` returns `{ readDefaultVisionProxyPrompt: async () => 'Default Vision prompt.', createProvider: () => providerStub }`. `providerStub` additionally gets `refreshFromSnapshot: vi.fn()`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run test/unit/runtime/activate.test.ts`
Expected: the reject, hang, and unreadable-prompt tests FAIL. The hang test times out or the reject test throws `copilot boom`.

- [ ] **Step 4: Implement in `src/runtime/activate.ts`**

- **Prompt loading.** Wrap the prompt read in a local `loadDefaultVisionPrompt(read, extensionPath): Promise<string>`. On rejection it calls `logDebugEvent('minimal', '9router default Vision proxy prompt unavailable', { reason }, 'minimal')` and returns `''`.
- **Copilot Chat.** Replace `await copilotChatExtension?.activate()` with a local `activateCopilotChat(): void`. It calls `activate()` without awaiting and attaches a rejection handler that logs `'GitHub Copilot Chat activation failed'` with `{ reason }` at threshold `'minimal'`.
- **De-duplication.** Define `getRuntimeSettings = (): RuntimeSettings => loadRuntimeSettings(getExtensionConfiguration(), defaultVisionProxyPrompt)` once and pass it to both configurators. Define `buildSnapshot = (): SettingsSnapshot => buildSettingsSnapshot(getExtensionConfiguration(), defaultVisionProxyPrompt)` once and use it for the initial provider snapshot and the configuration refresh.

`reason` is `error instanceof Error ? error.message : String(error)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run test/unit/runtime/activate.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add test/support/vscode.ts src/runtime/activate.ts test/unit/runtime/activate.test.ts
git commit -m "fix(runtime): keep activation alive when Copilot Chat or the Vision prompt fails"
```

---

### Task 2: Scoped, coalesced settings refresh

Covers spec goal 5.

**Files:**
- Create: `src/runtime/settings-refresh.ts`
- Modify: `src/runtime/activate.ts` (`handleConfigurationChange` and its listener)
- Test: `test/unit/runtime/settings-refresh.test.ts` (new)
- Test: `test/integration/extension/settings-refresh.test.ts:20-31` (rewrite the first test)
- Test: `test/unit/runtime/activate.test.ts`

**Interfaces:**
- Produces:
  - `export const SNAPSHOT_SETTING_KEYS: readonly string[]`. The value is exactly `['baseUrl', 'models', 'visionProxyModelId', 'visionProxySource', 'visionProxyPrompt', 'maxTokens', 'requestTimeoutMs', 'debugMode']`.
  - `export const SETTINGS_REFRESH_DELAY_MS = 100`
  - `export function affectsProviderSnapshot(event: Pick<vscode.ConfigurationChangeEvent, 'affectsConfiguration'>): boolean`. It returns true iff any `` `9router-copilot.${key}` `` is affected.
  - `export interface CoalescedRefresh extends vscode.Disposable { schedule(): void }`
  - `export function createCoalescedRefresh(refresh: () => void, delayMs: number): CoalescedRefresh`. This is a trailing timer: each `schedule()` restarts it, and `dispose()` clears it.
  - `handleConfigurationChange(event, refresh)` keeps its signature and calls `refresh()` iff `affectsProviderSnapshot(event)`.

- [ ] **Step 1: Write the failing tests**

Unit tests in `test/unit/runtime/settings-refresh.test.ts`:
- `it.each(SNAPSHOT_SETTING_KEYS)('treats %s as a snapshot setting', ...)`: an event whose `affectsConfiguration(s)` is `s === \`9router-copilot.${key}\`` gives `true`.
- `'ignores usageCompact and unrelated sections'`: `9router-copilot.usageCompact` → `false`, and `editor.fontSize` → `false`.
- `'runs one refresh for a burst of schedules'`: using `vi.useFakeTimers()`, call `schedule()` three times. `refresh` is not called yet. Then `vi.advanceTimersByTime(SETTINGS_REFRESH_DELAY_MS)` and `refresh` is called exactly once.
- `'dispose cancels a pending refresh'`: call `schedule()`, then `dispose()`, then advance 100 ms. `refresh` is not called.

Rewrite the integration test as `'refreshes for snapshot settings and ignores usageCompact'`. With `affectsConfiguration: (s) => s === '9router-copilot.models'` it is called once. With `s === '9router-copilot.usageCompact'` it is not called.

Activation test `'republishes once after a burst of model setting changes'` (fake timers):
1. Activate.
2. `__fireConfigurationChange('9router-copilot.models')` twice, then `__fireConfigurationChange('9router-copilot.usageCompact')`.
3. Advance 100 ms.
4. Expect `providerStub.refreshFromSnapshot` to have been called once.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/unit/runtime/settings-refresh.test.ts test/integration/extension/settings-refresh.test.ts test/unit/runtime/activate.test.ts`
Expected: FAIL. The module is missing, and the burst test sees 2 refresh calls.

- [ ] **Step 3: Implement `settings-refresh.ts` and wire it**

In `activate.ts`, create a coalescer whose callback runs `provider?.refreshFromSnapshot(buildSnapshot())`. Push it into `context.subscriptions`. The configuration listener calls `handleConfigurationChange(event, () => coalescer.schedule())`.

- [ ] **Step 4: Run the tests to verify they pass**

Same command as Step 2. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/settings-refresh.ts src/runtime/activate.ts test/unit/runtime/settings-refresh.test.ts test/integration/extension/settings-refresh.test.ts test/unit/runtime/activate.test.ts
git commit -m "perf(runtime): republish the picker once per burst of snapshot setting changes"
```

---

### Task 3: Republish on API key change

Covers spec goal 1.

**Files:**
- Modify: `src/config/secret-store.ts`
- Modify: `src/runtime/activate.ts`
- Test: `test/unit/config/secret-store.test.ts` (new)
- Test: `test/unit/runtime/activate.test.ts`

**Interfaces:**
- Consumes: the `createContext()` emitter from Task 1.
- Produces: `export function isApiKeyChange(event: Pick<vscode.SecretStorageChangeEvent, 'key'>): boolean`. It returns true iff `event.key === '9router.apiKey'`.

- [ ] **Step 1: Write the failing tests**

- Unit: `isApiKeyChange({ key: '9router.apiKey' })` → `true`, and `isApiKeyChange({ key: 'other.secret' })` → `false`.
- Activation test `'republishes immediately when the API key changes'`: fire `{ key: '9router.apiKey' }` on the context emitter, then expect `providerStub.refreshFromSnapshot` to have been called once with no timer advance. Fire `{ key: 'other.secret' }` and the call count stays 1.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/unit/config/secret-store.test.ts test/unit/runtime/activate.test.ts`
Expected: FAIL (`isApiKeyChange` is not exported; refresh is called 0 times).

- [ ] **Step 3: Implement**

Add `isApiKeyChange`. In `activate.ts`, push `context.secrets.onDidChange((event) => { if (isApiKeyChange(event)) provider?.refreshFromSnapshot(buildSnapshot()); })` into `context.subscriptions`.

- [ ] **Step 4: Run the tests to verify they pass**

Same command as Step 2. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/secret-store.ts src/runtime/activate.ts test/unit/config/secret-store.test.ts test/unit/runtime/activate.test.ts
git commit -m "feat(runtime): refresh model catalog metadata when the API key changes"
```

---

### Task 4: Settings health notice and activation summary log

Covers spec goals 4 and 8.

**Files:**
- Create: `src/runtime/snapshot-health.ts`
- Modify: `src/runtime/activate.ts`
- Test: `test/unit/runtime/snapshot-health.test.ts` (new)
- Test: `test/unit/runtime/activate.test.ts`

**Interfaces:**
- Consumes: `SettingsSnapshot` from `@/config/settings`; `getApiKey` from `@/config/secret-store`; the Task 2 coalescer callback.
- Produces:
  - `export interface SnapshotHealthNotice { signature: string; message: string }`
  - `export function describeSnapshotHealth(snapshot: SettingsSnapshot): SnapshotHealthNotice | undefined`
  - `export interface SnapshotHealthReporter { report(snapshot: SettingsSnapshot): void }`
  - `export function createSnapshotHealthReporter(show: (notice: SnapshotHealthNotice) => void): SnapshotHealthReporter`. It calls `show` only when the notice is defined and its signature differs from the last one recorded. It records `undefined` for healthy snapshots, so the same breakage shows again after a fix.

**Rules for `describeSnapshotHealth`:**
- **`state === 'invalid-runtime'`.** Collect `paths` = the sorted, unique `path` of the runtime-scope issues.
  - message: `` `9router settings are invalid (${paths.join(', ')}). All 9router models are hidden from the Copilot Chat model picker.` ``
  - signature: `` `runtime:${paths.join(',')}` ``
- **Otherwise.** Take `rejected` = `snapshot.rejectedModels` without code `INVALID_MODEL_MAPPING`, and let `n = rejected.length`. If `n === 0`, return `undefined`.
  - message: `` `9router hid ${n} model ${n === 1 ? 'entry' : 'entries'} with invalid settings from the Copilot Chat model picker.` ``
  - signature: `` `models:` `` followed by the sorted `` `${sourceIndex ?? '?'}:${code}` `` values joined by `,`.
- Capability-scope issues never produce a notice.

- [ ] **Step 1: Write the failing unit tests**

Build snapshots with `buildSettingsSnapshot({ get } as never, 'Default Vision prompt.')`:
- `baseUrl: 'not-a-url'` → message equals `9router settings are invalid (9router-copilot.baseUrl). All 9router models are hidden from the Copilot Chat model picker.`
- models `[{ id: 'coder', name: 'Coder', modelId: 'router/coder' }, { id: 'bad', name: '', modelId: 'router/bad' }]` → message equals `9router hid 1 model entry with invalid settings from the Copilot Chat model picker.`
- models `[{ id: 'agent', name: 'Agent', modelId: '' }, { id: 'coder', name: 'Coder', modelId: 'router/coder' }]` → `undefined`.
- models `[{ id: 'coder', name: 'Coder', modelId: 'router/coder', visionMode: 'proxy' }]` with no Vision proxy model → `undefined`.
- Reporter: report the same broken snapshot twice → `show` called once. Then a healthy snapshot, then the broken one again → `show` called twice in total.

- [ ] **Step 2: Write the failing activation tests**

The context's `secrets.get` returns `'sk-secret'` unless stated.
- `'logs one activation summary without secrets'`: config `models: [{ id: 'coder', name: 'Coder', modelId: 'router/coder' }]`. Exactly one output line starts with `9router extension activated`. It contains `"snapshotState":"valid"`, `"publishedModelCount":1`, and `"apiKeyConfigured":true`. No output line contains `sk-secret`.
- `'warns about invalid runtime settings at activation and opens diagnostics'`: config `baseUrl: 'not-a-url'`. `__getWarningMessages()` equals the invalid-runtime message, and (with `vi.waitFor`) `__getExecutedCommands()` contains `9routerCopilot.showDiagnostics`. The mock returns the first action.
- `'does not warn at activation without an API key'`: `secrets.get` returns `undefined` with config `baseUrl: 'not-a-url'`. `__getWarningMessages()` is `[]`.
- `'warns once when a settings change hides a model'` (fake timers): start with a valid config. Then, twice: set a config with a nameless model, fire `9router-copilot.models`, and advance 100 ms. Expect exactly one warning message.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run test/unit/runtime/snapshot-health.test.ts test/unit/runtime/activate.test.ts`
Expected: FAIL (module missing; no warning or log lines).

- [ ] **Step 4: Implement**

In `snapshot-health.ts`, implement the rules above.

In `activate.ts`:
- **Reporter.** Create the reporter with
  `show = (notice) => void vscode.window.showWarningMessage(notice.message, 'Show Diagnostics', 'Manage Models').then(choice => ...)`.
  The handler maps `'Show Diagnostics'` → `9routerCopilot.showDiagnostics` and `'Manage Models'` → `9routerCopilot.manageModels`, then runs `vscode.commands.executeCommand`.
- **Config path only.** The Task 2 coalescer callback becomes: build the snapshot, `refreshFromSnapshot` it, then `reporter.report(snapshot)`. The Task 3 secret path does not report.
- **At activation, after provider registration:**
  1. `apiKeyConfigured = (await getApiKey(context.secrets)) !== undefined`.
  2. If true, `reporter.report(initialSnapshot)`.
  3. Log with threshold `'minimal'`: `logDebugEvent(initialSnapshot.runtime?.debugMode ?? 'minimal', '9router extension activated', { snapshotState, publishedModelCount, rejectedModelCount, issueCount, apiKeyConfigured, durationMs }, 'minimal')`. `durationMs` is measured from the start of `activateExtension`.

- [ ] **Step 5: Run the tests to verify they pass**

Same command as Step 3. Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/snapshot-health.ts src/runtime/activate.ts test/unit/runtime/snapshot-health.test.ts test/unit/runtime/activate.test.ts
git commit -m "feat(runtime): warn once when settings hide 9router models and log activation summary"
```

---

### Task 5: First-run guidance

Covers spec goal 6.

**Files:**
- Create: `src/runtime/welcome.ts`
- Modify: `src/runtime/commands.ts:65-75` (the `setApiKey` handler)
- Modify: `src/runtime/activate.ts`
- Test: `test/unit/runtime/welcome.test.ts` (new)
- Test: `test/integration/extension/api-key-command.test.ts` (new)

**Interfaces:**
- Consumes: the mock's `__setInformationResponse` and `__getExecutedCommands` (Task 1); `getSettingsSnapshot` from `CommandDependencies`.
- Produces:
  - `export const WELCOME_SHOWN_KEY = '9router-copilot.welcomeShown'`
  - `export async function showWelcomeIfNeeded(context: Pick<vscode.ExtensionContext, 'secrets' | 'globalState'>): Promise<void>`

Exact copy:
- Welcome: `Connect 9router to use its models in GitHub Copilot Chat.` with the button `Set API Key`.
- After saving a key: `9router API key saved. Add a model to show it in Copilot Chat.` with the button `Add Model`.

- [ ] **Step 1: Write the failing tests**

Unit tests (`globalState` stub backed by a `Map`):
- **No key, flag unset:** `__getInformationMessages()` equals `['Connect 9router to use its models in GitHub Copilot Chat.']` and `WELCOME_SHOWN_KEY` is `true`. A second call adds no message.
- **API key present:** no message, and the flag is not set.
- **Button chosen:** `__setInformationResponse('Set API Key')` → `__getExecutedCommands()` equals `['9routerCopilot.setApiKey']`.

Integration tests (`registerCommands` with `secrets.store = vi.fn()` and `__setInputBoxValue('sk-new')`):
- `'offers Add Model after saving a key while no model is published'`: `getSettingsSnapshot` returns `buildSettingsSnapshot` of `[{ id: 'agent', name: 'Agent', modelId: '' }]`, and `__setInformationResponse('Add Model')`. Expect `store` to have been called with `('9router.apiKey', 'sk-new')`, and `__getExecutedCommands()` to equal `['9routerCopilot.addModel']`.
- `'stays quiet after saving a key when models are published'`: the snapshot has `router/coder` published. `__getInformationMessages()` is `[]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/unit/runtime/welcome.test.ts test/integration/extension/api-key-command.test.ts`
Expected: FAIL (module missing; no Add Model prompt).

- [ ] **Step 3: Implement**

- **`showWelcomeIfNeeded`:** return if a key exists or the flag is set. Otherwise `await globalState.update(WELCOME_SHOWN_KEY, true)` *before* showing the message, then dispatch the chosen command.
- **`setApiKey` handler:** after storing, if `dependencies.getSettingsSnapshot?.()?.publishedModels.length === 0`, show the follow-up and run `9routerCopilot.addModel` when it is chosen.
- **`activate.ts`:** after registration, call `void showWelcomeIfNeeded(context).catch(...)`. The catch logs `'9router welcome message failed'` at `'minimal'`.

- [ ] **Step 4: Run the tests to verify they pass**

Same command as Step 2, plus `pnpm vitest run test/integration/extension/diagnostics-command.test.ts`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/welcome.ts src/runtime/commands.ts src/runtime/activate.ts test/unit/runtime/welcome.test.ts test/integration/extension/api-key-command.test.ts
git commit -m "feat(runtime): guide first-run setup from API key to first model"
```

---

### Task 6: Lazy activation (needs a human check)

Covers spec goal 7.

**Files:**
- Modify: `package.json:24-26` (`activationEvents`)
- Test: `test/integration/extension/release-guardrails.test.ts`

- [ ] **Step 1: Write the failing guardrail test**

```ts
it('activates lazily when the 9router provider is requested', () => {
  expect(manifest.activationEvents).toEqual(['onLanguageModelChatProvider:9router']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/integration/extension/release-guardrails.test.ts`
Expected: FAIL (it receives `['onStartupFinished']`).

- [ ] **Step 3: Change `activationEvents` to `["onLanguageModelChatProvider:9router"]` and re-run**

Expected: PASS.

- [ ] **Step 4: Manual check in the Extension Development Host**

The human partner runs this. Launch **Build Once and Debug Extension** (F5), then check:
1. In a fresh window, open Copilot Chat. 9router models appear in the picker without running any 9router command.
2. Send a message to a 9router model. It streams a reply; there is no hang.
3. Reload the window without opening Chat, and run `9router: Show Usage`. The panel opens.
4. In Chat, `@9router /usage` answers.
5. The `9router Copilot` output channel shows exactly one `9router extension activated` line per window.

If check 1 or 2 fails, revert Steps 1–3 (`git checkout -- package.json test/integration/extension/release-guardrails.test.ts`). Record the observed behavior under "Decisions" in the spec, and skip the commit.

- [ ] **Step 5: Commit (only if every check passed)**

```bash
git add package.json test/integration/extension/release-guardrails.test.ts
git commit -m "perf(activation): activate on 9router provider demand instead of startup"
```

---

### Task 7: Docs and the verification gate

**Files:**
- Modify: `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md:137-145` (Activation)
- Modify: `docs/9router-copilot-chat-provider-system-design.md:191-198` (Activation)
- Modify: `README.md` (troubleshooting list near the `9router: Show Diagnostics` bullet)

- [ ] **Step 1: Update both Activation sections**

Add:
- Copilot Chat activation is non-blocking and its failures are logged.
- The picker republishes on API-key changes and on snapshot-setting changes (coalesced).
- Settings that hide models raise one warning.
- The activation event: `onLanguageModelChatProvider:9router`, or `onStartupFinished` if Task 6 was reverted.

- [ ] **Step 2: Add one README troubleshooting bullet**

Text: `- **A warning says models were hidden** — choose **Show Diagnostics** to see which setting is invalid, or **Manage Models** to fix the entry.`

- [ ] **Step 3: Run the full gate**

Run, in order: `pnpm run build`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run package`.
Expected: each exits 0, and `package` writes `9router-copilot-chat-provider-0.15.0.vsix`.

- [ ] **Step 4: Commit**

```bash
git add docs README.md
git commit -m "docs: describe hardened activation behavior"
```
