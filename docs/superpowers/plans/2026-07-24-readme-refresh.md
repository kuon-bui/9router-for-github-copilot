# README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the technical-first README with a short end-user guide and move detailed configuration, diagnostics, development, and architecture reference into `docs/configuration.md`.

**Architecture:** Keep product discovery and first-run setup in `README.md`. Put detailed, change-prone setting reference in one linked document, using `package.json`, `src/config/defaults.ts`, and command registrations as sources of truth.

**Tech Stack:** Markdown, VS Code extension manifest, pnpm, VS Code Extension Manager (`vsce`)

## Global Constraints

- Primary audience: extension users.
- Documentation language: English.
- Use `Vizards/deepseek-v4-for-copilot` only as structural inspiration; copy no wording.
- Use package version `0.3.0` and user-facing default base URL `http://127.0.0.1:20128/v1` from `package.json`.
- Add no placeholder image, invented Marketplace link, unsupported badge, or new dependency.
- API keys live only in VS Code `SecretStorage`; never suggest settings, files, logs, or examples for secret storage.
- Preserve thin-adapter ownership: extension adapts Copilot Chat requests; `9router` owns routing, fallback, quotas, and upstream execution.
- Describe only behavior implemented in current source. Do not present approved but unimplemented design documents as released behavior.
- Keep Vision proxy failure behavior fail-closed.

---

## File Map

- Create `docs/configuration.md`: complete setting reference, diagnostics, troubleshooting, development commands, and architecture boundary.
- Modify `README.md`: concise product pitch, verified feature summary, prerequisites, local installation, minimum setup, and links.
- Read only `package.json`, `src/config/defaults.ts`, `src/config/model-settings.ts`, and `src/runtime/commands.ts`: fact sources; do not modify them.

### Task 1: Extract Detailed User Reference

**Files:**
- Create: `docs/configuration.md`
- Read: `package.json`
- Read: `src/config/defaults.ts`
- Read: `src/config/model-settings.ts`
- Read: `src/runtime/commands.ts`

**Interfaces:**
- Consumes: command titles and setting contracts from repository source.
- Produces: stable relative link target `docs/configuration.md` for `README.md`.

- [ ] **Step 1: Create detailed configuration guide**

Create `docs/configuration.md` with this content:

````markdown
# 9router Copilot Configuration

This guide covers advanced setup, model fields, Vision proxy behavior, diagnostics, development, and the extension's architecture boundary.

## Settings

Configuration is local per user under the `9router-copilot` namespace. Array order controls model-picker order. Removing an object removes that display model.

```json
{
  "9router-copilot.baseUrl": "http://127.0.0.1:20128/v1",
  "9router-copilot.models": [
    {
      "id": "agent",
      "name": "Agent",
      "modelId": "replace-with-existing-9router-model-id",
      "toolMode": "auto",
      "visionMode": "off",
      "thinkingMode": "off",
      "maxInputTokens": 264000,
      "maxOutputTokens": 264000
    }
  ],
  "9router-copilot.visionProxySource": "9router",
  "9router-copilot.visionProxyModelId": "provider/vision-model",
  "9router-copilot.visionProxyPrompt": "Describe the supplied images faithfully for another language model. Include visible text, code, tables, diagrams, layout, and uncertainty. Do not answer the user request; provide only image context.",
  "9router-copilot.maxTokens": 0,
  "9router-copilot.requestTimeoutMs": 60000,
  "9router-copilot.debugMode": "minimal"
}
```

### Runtime settings

| Setting | Default | Purpose |
|---|---:|---|
| `9router-copilot.baseUrl` | `http://127.0.0.1:20128/v1` | OpenAI-compatible `9router` API base URL. |
| `9router-copilot.models` | One unpublished `agent` entry | Ordered curated models exposed in Copilot Chat. |
| `9router-copilot.maxTokens` | `0` | Positive values send `max_tokens`; `0` omits the field. |
| `9router-copilot.requestTimeoutMs` | `60000` | Request timeout in milliseconds. |
| `9router-copilot.debugMode` | `minimal` | Diagnostic level: `minimal`, `metadata`, or `verbose`. |
| `9router-copilot.visionProxySource` | unset | Shared Vision analyzer source: `9router` or `copilot`. |
| `9router-copilot.visionProxyModelId` | empty | Opaque analyzer model ID from the selected source. |
| `9router-copilot.visionProxyPrompt` | built in | Complete instruction used to describe images. |

`9router-copilot.maxTokens` controls request output limits. It is independent from each display model's Context Window metadata. A malformed value or `0` omits `max_tokens`; `9router` or an upstream provider may still enforce its own limit.

## Model fields

| Field | Values | Purpose |
|---|---|---|
| `id` | `[a-z0-9][a-z0-9._-]*` | Stable Copilot-facing ID. |
| `name` | Non-empty string | Name shown in the model picker. |
| `modelId` | Existing `9router` model ID | Opaque backend ID sent unchanged as the OpenAI-compatible `model` field. |
| `toolMode` | `auto`, `off` | Expose supported host tools or disable tools. |
| `visionMode` | `native`, `proxy`, `off` | Send images directly, describe them through a proxy, or reject them. |
| `thinkingMode` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` | Default Thinking Effort when the host supplies no valid selection. |
| `maxInputTokens` | Positive safe integer | Input Context Window metadata published to VS Code. |
| `maxOutputTokens` | Positive safe integer | Output Context Window metadata published to VS Code. |

Unknown fields, duplicate display IDs, invalid values, and empty mappings reject only the affected model. One broken entry does not hide unrelated valid entries. The default `agent` entry remains unpublished until `modelId` names an existing `9router` model.

The old fixed-model settings are not read or migrated. Recreate desired picker entries as objects in `9router-copilot.models`.

## Tools

Models default to `toolMode: "off"`; the manifest's initial `agent` example uses `auto`. When enabled, the extension converts supported Copilot host tool definitions to the OpenAI-compatible request format. `9router` remains responsible for routing and upstream tool compatibility.

## Vision

- `native`: send image input directly to the selected model.
- `proxy`: summarize image-bearing messages with one shared analyzer, replace raw images with `[Vision proxy summary]`, then call the selected model.
- `off`: reject image input.

Run `9router: Configure Vision Proxy` to choose source and model. The extension also opens the same setup flow when a proxy request needs missing configuration.

For source `9router`, authenticated `GET /v1/models` discovery keeps models where `capabilities.vision === true`. For source `copilot`, selection uses native VS Code language models; compatibility is enforced at runtime rather than guessed from model names.

Proxy mode is fail-closed. Discovery errors, missing or stale analyzer IDs, consent or quota rejection, timeout, cancellation, malformed streams, and upstream failures stop the request before the primary model runs.

Diagnostics never include image data, prompts, source message text, API keys, raw response bodies, or proxy summaries.

## Thinking Effort

Each configured display model uses Copilot Chat's native Thinking Effort picker. `None` omits a reasoning override. `Minimal`, `Low`, `Medium`, `High`, `XHigh`, and `Max` send the selected value as `reasoning_effort` while leaving `modelId` unchanged.

The model object's `thinkingMode` is the fallback when the host supplies no valid selection. `9router` owns provider-specific reasoning translation.

## API key and diagnostics

Run these commands from the Command Palette:

- `9router: Set API Key`: save the key in VS Code `SecretStorage`.
- `9router: Clear API Key`: delete the stored key.
- `9router: Show Diagnostics`: report runtime settings, published models, rejected entries, and validation issues with sensitive values redacted.
- `9router: Configure Vision Proxy`: select the shared analyzer source and model.

Never place API keys in `settings.json`, `.env`, logs, or documentation.

Debug levels:

- `minimal`: safe default.
- `metadata`: operational metadata without prompt bodies or secrets.
- `verbose`: deeper diagnostics; avoid with sensitive prompts.

## Troubleshooting

- Missing API key: run `9router: Set API Key`.
- Invalid base URL: use an `http` or `https` URL ending at, or normalizable to, `/v1`.
- Missing model: set the affected object's `modelId` to an existing `9router` model.
- Image input blocked: use `visionMode: "native"` or `"proxy"` only when the selected path supports it.
- Missing Vision proxy: run `9router: Configure Vision Proxy`; proxy mode stays fail-closed until setup completes.
- Invalid thinking mode: use `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
- Suffixed model ID: remove the `(level)` suffix and set `thinkingMode` separately.

## Development

Press `F5` and choose `Watch and Debug Extension` to start the TypeScript watcher and open an Extension Development Host. Choose `Build Once and Debug Extension` for a clean one-shot build. Runtime diagnostics appear in the `9router Copilot` output channel.

Before release, run:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

The VSIX excludes source, tests, and internal docs through `.vscodeignore`.

## Architecture boundary

The extension owns provider registration, curated display-model publication, secure local configuration, request and stream adaptation, compatibility layers, and safe diagnostics.

`9router` owns model definitions, routing, fallback, quota-aware provider switching, and upstream execution. Configured `modelId` values are opaque to the extension; router business logic does not belong here.
````

- [ ] **Step 2: Verify setting and command names against source**

Run:

```bash
for value in \
  '9router-copilot.baseUrl' \
  '9router-copilot.models' \
  '9router-copilot.maxTokens' \
  '9router-copilot.requestTimeoutMs' \
  '9router-copilot.debugMode' \
  '9router-copilot.visionProxySource' \
  '9router-copilot.visionProxyModelId' \
  '9router-copilot.visionProxyPrompt'; do
  grep -Fq "$value" package.json || exit 1
done
for value in \
  '9router: Set API Key' \
  '9router: Clear API Key' \
  '9router: Show Diagnostics' \
  '9router: Configure Vision Proxy'; do
  grep -Fq "$value" package.json || exit 1
done
```

Expected: exit code `0`, no output.

- [ ] **Step 3: Scan detailed guide for forbidden placeholders and stale defaults**

Run:

```bash
! grep -En 'TBD|TODO|127\.0\.0\.1:3456|9router-copilot-chat-provider-0\.1\.0\.vsix' docs/configuration.md
```

Expected: exit code `0`, no output.

- [ ] **Step 4: Review guide diff**

Run:

```bash
git --no-pager diff --check && git --no-pager diff -- docs/configuration.md
```

Expected: no whitespace errors; guide contains no secret value, copied wording, unsupported feature, or architecture ownership change.

- [ ] **Step 5: Commit detailed guide**

```bash
git add docs/configuration.md
git commit -m "docs: add configuration guide"
```

### Task 2: Rewrite Main README

**Files:**
- Modify: `README.md:1-174`
- Read: `docs/configuration.md`
- Read: `package.json`
- Read: `LICENSE`

**Interfaces:**
- Consumes: relative documentation target `docs/configuration.md` from Task 1.
- Produces: end-user entry point with one minimum settings example and verified links.

- [ ] **Step 1: Replace README with concise product-first content**

Replace `README.md` with:

````markdown
<h1 align="center">9router Copilot Chat Provider</h1>

**Use curated `9router` models inside GitHub Copilot Chat without replacing Copilot's native interface.**

This extension connects Copilot Chat's model picker to one OpenAI-compatible `9router` endpoint. Copilot keeps the chat experience, tools, streaming, Vision input, Thinking Effort, and Context Window presentation; `9router` keeps ownership of routing, fallback, quotas, and upstream execution.

## Why this extension?

- **Stay inside Copilot Chat.** No separate chat UI or patched Copilot traffic.
- **Publish only models you choose.** Stable display names map to opaque `9router` model IDs, in your preferred picker order.
- **Keep agent workflows.** Enable supported host tools per display model with `toolMode: "auto"`.
- **Bridge model capabilities.** Use native Vision, a shared Vision proxy, or fail closed; select Thinking Effort from Copilot's native picker.
- **Keep secrets out of settings.** The API key is stored only in VS Code `SecretStorage`.

## Features

| Capability | Behavior |
|---|---|
| Curated model picker | User-defined display models, names, membership, and order |
| Streaming | Streaming-first OpenAI-compatible `/v1/chat/completions` adapter |
| Tools | Per-model `auto` or `off` exposure |
| Vision | Per-model `native`, `proxy`, or `off` mode |
| Thinking Effort | `None`, `Minimal`, `Low`, `Medium`, `High`, `XHigh`, and `Max` |
| Context Window | Per-model input and output metadata published to VS Code |
| Diagnostics | Safe `minimal`, `metadata`, and `verbose` levels |

## Getting Started

### Prerequisites

- VS Code `1.125.0` or later
- GitHub Copilot Chat
- A reachable `9router` OpenAI-compatible `/v1` endpoint
- A `9router` API key and at least one existing model ID
- Node.js and pnpm for local packaging

### Install local VSIX

```bash
pnpm install
pnpm run package
code --install-extension 9router-copilot-chat-provider-0.3.0.vsix
```

Reload VS Code if `9router` does not appear in Copilot Chat.

### Configure

1. Run `9router: Set API Key` from the Command Palette.
2. Open user `settings.json` and add a display model:

```json
{
  "9router-copilot.baseUrl": "http://127.0.0.1:20128/v1",
  "9router-copilot.models": [
    {
      "id": "agent",
      "name": "Agent",
      "modelId": "replace-with-existing-9router-model-id",
      "toolMode": "auto",
      "visionMode": "off",
      "thinkingMode": "off"
    }
  ]
}
```

3. Open Copilot Chat and select `Agent` from the model picker.
4. For image support through another model, set `visionMode` to `proxy` and run `9router: Configure Vision Proxy`.

Array order controls picker order. Empty or invalid `modelId` values leave only the affected entry unpublished.

## Documentation

- [Configuration, Vision, diagnostics, troubleshooting, and development](https://github.com/kuon-bui/9router-for-github-copilot/blob/main/docs/configuration.md)
- [System design](https://github.com/kuon-bui/9router-for-github-copilot/blob/main/docs/9router-copilot-chat-provider-system-design.md)
- [Code conventions](https://github.com/kuon-bui/9router-for-github-copilot/blob/main/CODE_CONVENTION.md)

## Security

Never put API keys in `settings.json`, `.env`, logs, or documentation. Use `9router: Set API Key`; the extension stores the value in VS Code `SecretStorage`.

Vision proxy diagnostics exclude image data, prompt content, source message text, API keys, raw response bodies, and proxy summaries.

## License

[UNLICENSED](LICENSE). Copying, modification, distribution, sublicensing, and production use require explicit written permission from the copyright holder.
````

- [ ] **Step 2: Verify README facts and relative links**

Run:

```bash
grep -Fq '"version": "0.3.0"' package.json && \
grep -Fq '"default": "http://127.0.0.1:20128/v1"' package.json && \
for file_path in docs/configuration.md docs/9router-copilot-chat-provider-system-design.md CODE_CONVENTION.md LICENSE; do
  test -f "$file_path" || exit 1
done && \
grep -Fq 'https://github.com/kuon-bui/9router-for-github-copilot/blob/main/docs/configuration.md' README.md
```

Expected: exit code `0`, no output.

- [ ] **Step 3: Scan README for stale values, placeholders, and invented distribution links**

Run:

```bash
! grep -En 'TBD|TODO|127\.0\.0\.1:3456|0\.1\.0|marketplace\.visualstudio\.com|open-vsx\.org|shields\.io' README.md
```

Expected: exit code `0`, no output.

- [ ] **Step 4: Check package contents and README formatting**

Run:

```bash
pnpm exec vsce ls | grep -Fx 'README.md'
git --no-pager diff --check
```

Expected: output contains `README.md`; diff check exits `0` with no whitespace errors. `docs/configuration.md` remains absent from VSIX because `.vscodeignore` intentionally excludes internal docs; README uses an absolute GitHub link so installed-extension readers can still open it after merge.

- [ ] **Step 5: Review complete documentation diff**

Run:

```bash
git --no-pager diff HEAD~1 -- README.md docs/configuration.md
```

Expected: main README is shorter and end-user-first; detailed behavior remains in `docs/configuration.md`; security and thin-adapter boundaries remain explicit.

- [ ] **Step 6: Commit README rewrite**

```bash
git add README.md
git commit -m "docs: rewrite README for users"
```

### Task 3: Final Documentation Verification

**Files:**
- Verify: `README.md`
- Verify: `docs/configuration.md`
- Verify: `docs/superpowers/specs/2026-07-24-readme-refresh-design.md`

**Interfaces:**
- Consumes: completed README and configuration guide.
- Produces: clean documentation-only branch ready for review.

- [ ] **Step 1: Confirm spec coverage and absence of stale copy**

Run:

```bash
grep -Fq 'Why this extension?' README.md && \
grep -Fq 'Getting Started' README.md && \
grep -Fq 'https://github.com/kuon-bui/9router-for-github-copilot/blob/main/docs/configuration.md' README.md && \
grep -Fq 'Architecture boundary' docs/configuration.md && \
! grep -En 'TBD|TODO|9router-copilot-chat-provider-0\.1\.0\.vsix|127\.0\.0\.1:3456' README.md docs/configuration.md
```

Expected: exit code `0`, no output.

- [ ] **Step 2: Inspect branch and commit scope**

Run:

```bash
git status --short --branch
git --no-pager log -3 --oneline --decorate
git --no-pager diff main...HEAD --stat
git --no-pager diff --check main...HEAD
```

Expected: clean worktree; branch contains design, plan, configuration-guide, and README commits; only documentation files changed; no whitespace errors.

- [ ] **Step 3: Record verification result**

No source, configuration, transport, provider, or packaging behavior changed, so source test suites are not required by `AGENTS.md`. Report exact checks run and note that screenshots remain deferred until real Extension Development Host captures exist.
