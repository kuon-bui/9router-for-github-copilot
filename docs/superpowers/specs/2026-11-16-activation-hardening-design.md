# Activation Hardening Design

## Document Status

- Status: Implemented on `feat/activation-hardening`; lazy activation awaiting manual check
- Date: 2026-11-16
- Scope: `src/runtime/activate.ts` lifecycle wiring, first-run guidance, activation event
- Language: English

## Intent

Activation is pure wiring today, but it has gaps that users feel. The picker keeps stale catalog metadata after the API key changes. A failure in Copilot Chat or in the bundled prompt file can break the whole extension. A broken setting hides models without telling anyone. A fresh install gives no hint about what to do first. This change closes those gaps and keeps the extension a thin adapter. It adds no new UI surface beyond standard VS Code notifications.

## Goals

1. Republish the picker when the 9router API key is set, changed, or cleared, in this window or another.
2. Keep the provider and commands working when `GitHub.copilot-chat` activation rejects or hangs.
3. Keep text chat working when the bundled Vision proxy prompt cannot be read.
4. Tell the user once when a settings change hides models, with a path to diagnostics.
5. Republish only for settings that affect the provider snapshot, and coalesce bursts of writes.
6. Guide a fresh install from "no API key" to "first model in the picker".
7. Activate on `onLanguageModelChatProvider:9router` instead of `onStartupFinished`, if a manual check confirms it works.
8. Log one safe activation summary line.

## Non-Goals

- Moving the API key into VS Code's provider `configuration` schema (`secret: true`). It would change secret ownership and the provider-group model, so it needs its own design.
- Status bar items, new panels, or new views.
- Changing request, stream, tool, or Vision adapter behavior.

## Anti-Goals

- Notifications that fire on every settings save, or for states the user created on purpose.
- Any secret value in logs or messages.

## Decisions

- **`managementCommand` is rejected.** VS Code 1.146 marks it deprecated: "Use the new configuration property instead."
- **The `silent: false` API-key prompt is rejected.** VS Code passes `silent: false` only while it adds a provider group through the configuration flow, which this extension does not use.
- **Copilot Chat activation becomes fire-and-forget, with the error logged.** This guards against the lazy-activation cycle: Copilot Chat resolving vendors → activating us → us awaiting Copilot Chat.
- **The Vision prompt read failure falls back to `''`.** The existing snapshot logic already treats an empty prompt as "proxy Vision unavailable" (the `MISSING_VISION_PROXY_PROMPT` issue, and no `imageInput` capability).
- **Settings refresh allowlist:** `baseUrl`, `models`, `visionProxyModelId`, `visionProxySource`, `visionProxyPrompt`, `maxTokens`, `requestTimeoutMs`, `debugMode`. `usageCompact` is excluded. Bursts are coalesced with a 100 ms trailing timer.
- **API-key changes refresh immediately** (no coalescing), because there is one event per change.
- **Health notices:**
  - Raised only for runtime-scope issues (`invalid-runtime`) and for rejected model entries.
  - Rejections coded `INVALID_MODEL_MAPPING` are excluded. An empty `modelId` is the documented "unpublished" draft state, and the shipped default entry is one of these. Thinking-suffix mistakes share that code; they stay visible in diagnostics and in the Manage Models badge.
  - Capability-scope issues (Vision proxy not yet configured) are excluded, because guided setup handles them on first image.
  - A notice shows only when its signature differs from the last one shown, and resets once the snapshot is healthy.
  - It is raised on settings changes, and at activation or after an API-key change only when an API key exists. (Amended after review: a fresh install that saves its first key with a broken `baseUrl` would otherwise never be warned.)
  - Buttons: `Show Diagnostics`, `Manage Models`.
- **First-run guidance:**
  - A one-time information message is shown when no API key exists. The `globalState` flag `9router-copilot.welcomeShown` is set before the message is shown, so dismissing it also counts.
  - After `Set API Key` stores a key while the snapshot state is `empty`, an `Add Model` prompt follows. (Amended after review: `invalid-runtime` also has no published models, but adding a model cannot fix it.)
- **Lazy activation is gated** on a manual Extension Development Host check. If the picker does not populate, or a chat request hangs, keep `onStartupFinished`.
  - Outcome: **pending**. The change is committed on `feat/activation-hardening` (0cdfb0a) so it can be checked before merge.
  - The plan's five checks apply, plus a sixth: in a fresh profile with no key, install without reloading and run `9router: Set API Key` first.
  - Two side effects are accepted:
    - After installing into a running window, the welcome appears only once something activates the extension.
    - If `Set API Key` is what activates it, the welcome toast can stay visible behind the input box.
  - To revert: `git revert 0cdfb0a`, then restore the activation-event wording in both design docs.

## Approaches Considered

1. **Harden in place, with small focused runtime modules (chosen).** New `settings-refresh.ts`, `snapshot-health.ts`, and `welcome.ts` under `src/runtime`, wired by `activate.ts`. Small, testable, and consistent with the existing `create*` factory pattern.
2. **Move the refresh and health logic into the provider.** Rejected. The provider would gain UI concerns (notifications), which crosses the `src/provider` boundary.
3. **Adopt the VS Code provider `configuration` flow for onboarding.** Rejected for this change; see Non-Goals.

## Left to the Builder

- Exact internal helper names inside `activate.ts`.
- Test fixture shapes beyond the assertions the plan pins.
