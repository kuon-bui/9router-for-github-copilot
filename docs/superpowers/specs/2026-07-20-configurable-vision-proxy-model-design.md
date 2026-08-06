# Configurable Vision Proxy Model Design

## Document Status

- Status: Approved draft
- Date: 2026-07-20
- Scope: Shared Vision proxy prompt, source selection, model discovery, and guided setup
- Language: English

## Objective

Let users configure one shared image-description prompt and choose whether proxy-mode image analysis runs through a Vision-capable 9router model or a native GitHub Copilot model. Model selection uses VS Code Quick Pick. When an image request needs proxying but no usable analyzer is configured, the extension opens the same guided setup and continues the current request after successful configuration.

The feature preserves the thin-adapter architecture. 9router remains responsible for routing its own models and combos. The extension only discovers declared capabilities, stores the selected opaque model id, invokes the selected analyzer, and transforms image input into text context for the primary 9router request.

## Confirmed Decisions

- Use one shared Vision proxy configuration for every curated display model.
- Keep flat settings instead of introducing a nested configuration object.
- Add `9router-copilot.visionProxySource` with supported values `9router` and `copilot`.
- Keep `9router-copilot.visionProxyModelId` as the selected opaque model id.
- Add `9router-copilot.visionProxyPrompt` with the current built-in instruction as its manifest default.
- Treat the configured prompt as the complete analyzer instruction, not an addition to a hidden instruction.
- Discover 9router choices through authenticated `GET /v1/models` and retain only entries declaring `capabilities.vision === true`.
- Discover native choices through `vscode.lm.selectChatModels({ vendor: 'copilot' })`.
- Do not guess Vision support from model names.
- Open guided setup immediately when a proxy image request has no usable analyzer configuration.
- Continue that request after successful setup; cancellation stops it with an actionable configuration error.
- Keep Vision analysis fail-closed. Never submit the primary request without context for supplied images.

## Context

The previous implementation supported one shared 9router Vision model through `9router-copilot.visionProxyModelId`. It used a fixed source-code prompt and required users to edit the model id manually. Guided setup now keeps proxy image input available when source or model configuration is missing, allowing the request path to open VS Code Quick Pick before analysis.

Current 9router model-list implementation returns OpenAI-compatible entries and may attach a `capabilities` object. Vision-capable LLM entries declare `capabilities.vision`. Entries without an explicit true value are not safe Vision choices and must be excluded. Combo entries currently may omit capabilities, so they are excluded rather than inspected or guessed locally.

VS Code exposes native models through `vscode.lm.selectChatModels`. Returned `LanguageModelChat` values provide opaque identity and request methods, but the stable VS Code 1.125 consumer API does not expose `LanguageModelChatInformation.capabilities` on those values. The picker therefore lists Copilot models returned by the native selector; actual image compatibility remains enforced by the native model request. No model-name allowlist or unsupported proposed API is introduced.

## Non-Goals

- Per-display-model Vision analyzer settings
- Local fallback between 9router and Copilot sources
- Guessing capabilities from model or provider names
- Creating, editing, or reordering 9router combos
- Moving 9router routing policy into the extension
- A custom webview or separate chat UI
- Image resizing, transcoding, OCR, caching, or summary persistence
- Preserving separate remembered model ids for each source
- Sending tools or Thinking Effort to either Vision analyzer

## Configuration Contract

### `9router-copilot.visionProxySource`

Optional non-secret string with allowed configured values:

- `9router`
- `copilot`

No source is selected on a fresh install. For backward compatibility, an existing non-empty `visionProxyModelId` with an absent source is interpreted as `9router`. Once guided setup succeeds, both source and model id are written explicitly.

### `9router-copilot.visionProxyModelId`

Existing non-secret string. Meaning depends on source:

- `9router`: exact `id` returned by `GET /v1/models`
- `copilot`: exact opaque `LanguageModelChat.id` returned by `vscode.lm.selectChatModels`

The value remains opaque. It is not parsed, derived, or rewritten.

### `9router-copilot.visionProxyPrompt`

Non-secret string with this default value:

```text
Describe the supplied images faithfully for another language model. Include visible text, code, tables, diagrams, layout, and uncertainty. Do not answer the user request; provide only image context.
```

Whitespace-only values are invalid. The runtime trims surrounding whitespace and uses the result as the full analyzer instruction. No hidden prefix or suffix is added.

All settings use User scope when written by guided setup. The prompt remains editable through normal VS Code Settings UI and JSON editing.

## Guided Configuration

Add command:

```text
9routerCopilot.configureVisionProxy
```

Display title:

```text
9router: Configure Vision Proxy
```

The command and missing-configuration flow call one shared configuration function.

### Step 1: Select source

Show Quick Pick with:

- `9router`
- `GitHub Copilot`

Cancellation returns a typed cancelled result and does not modify settings.

### Step 2A: Select 9router model

1. Read API key from `SecretStorage`.
2. Require valid runtime base URL and timeout settings.
3. Send authenticated `GET <normalized-base-url>/models` through a focused router catalog client.
4. Validate response as untrusted JSON.
5. Require root `data` to be an array.
6. Retain entries only when:
   - `id` is a non-empty string
   - `capabilities` is an object
   - `capabilities.vision === true`
7. Deduplicate by exact `id`.
8. Sort by `id` for deterministic display.
9. Show Quick Pick labels using exact ids.

Malformed items are skipped. Authentication, timeout, cancellation, network, malformed-response, and empty-result failures produce concise messages. No manual-entry fallback is added.

### Step 2B: Select Copilot model

1. Call `vscode.lm.selectChatModels({ vendor: 'copilot' })`.
2. Deduplicate by exact `id`.
3. Sort by display name, then id.
4. Show Quick Pick label from `name`, description from `family`, and detail from opaque `id`.

No stable consumer API exposes image capability metadata on returned `LanguageModelChat` values. Selection therefore does not infer support from names. Native request rejection is mapped to an actionable analyzer error that offers reconfiguration.

### Step 3: Persist atomically from user perspective

After model selection succeeds, update User settings in this order:

1. `visionProxyModelId`
2. `visionProxySource`

The source is written last so partially completed updates never activate a new source with an old model id. If either update fails, report configuration failure and do not claim success. Normal settings-change handling refreshes provider publication.

The prompt is not asked during the wizard. Its safe default already exists, and users can edit it in Settings. This keeps setup short.

## Request Flow

```text
Copilot Chat request
    -> resolve curated 9router display model
    -> inspect image input
       -> no images: existing path
       -> visionMode native: existing native path
       -> visionMode off: existing blocked path
       -> visionMode proxy:
          -> resolve shared Vision source, model id, and prompt
          -> missing source/model:
             -> run guided configuration
             -> cancelled/failed: stop
             -> success: use returned selection for current request
          -> source 9router:
             -> existing 9router streaming Vision request
          -> source copilot:
             -> resolve exact native model id
             -> native Copilot Vision request
          -> require non-empty textual description
          -> replace images with Vision proxy summary
          -> submit transformed request to selected 9router model
```

The request uses the configuration result returned directly by the wizard instead of waiting for asynchronous settings refresh. Future requests use the refreshed snapshot.

## Analyzer Boundaries

### Shared orchestration

`VisionProxyService` remains responsible for:

- classifying text-only, native, proxy, and blocked flows
- processing image-bearing messages sequentially
- preserving non-image message parts
- appending one textual summary to each source message
- preventing the primary request after any analyzer failure
- recording safe outcome metadata

Source-specific execution moves behind a small discriminated input or focused analyzer boundary. It does not become a generic provider framework.

### 9router analyzer

The 9router branch keeps existing behavior:

- use current API key, base URL, timeout, cancellation, and `RouterClient`
- send exact configured model id
- send custom prompt as system content
- send source message text and normalized image parts as user content
- request streaming response
- collect text deltas
- require response completion and non-empty summary
- omit tools, tool choice, and Thinking Effort

### Native Copilot analyzer

The Copilot branch:

1. Resolve the exact configured model with `vscode.lm.selectChatModels({ vendor: 'copilot', id })`.
2. Require exactly one usable match by id; use first exact match if VS Code returns duplicates.
3. Build one `LanguageModelChatMessage.User` containing:
   - one `LanguageModelTextPart` with the configured prompt
   - retained text context from the source message
   - recognized image `LanguageModelDataPart` values
4. Call `LanguageModelChat.sendRequest` with a justification explaining image-description use and the request cancellation token.
5. Consume `response.text` and concatenate streamed text.
6. Require a non-empty trimmed summary.

The extension sends no tools or model-specific options. Native consent may appear because model use is initiated by the user's configuration command or chat request. Rejected consent, missing model, quota blocking, cancellation, and stream failures are mapped to stable extension errors without leaking prompt or image content.

## Missing and Stale Configuration

Guided setup runs automatically only when a proxy image request has:

- no resolved source
- empty model id

A configured but stale model behaves as follows:

- stale 9router id: preserve existing model-mapping error, identify Vision phase, and direct user to `9router: Configure Vision Proxy`
- stale Copilot id: map native `NotFound` to configuration error and direct user to the same command
- Copilot model rejects images: return a configuration/upstream compatibility error and direct user to choose another model

The extension does not silently select another model. Automatic UI is not repeatedly opened after a configured model fails; this avoids loops and unexpected model changes.

## Capability Publication

Proxy image capability is advertised when the prompt is non-empty. Missing or invalid source/model configuration remains recoverable because the provider opens guided setup before analysis.

Publication does not perform network discovery. Doing so would make model publication dependent on network availability and could trigger native model access at refresh time.

A missing source or model id does not hide image input. This lets the host deliver an image request so provider-level guided setup can open VS Code Quick Pick and continue the same request.

## Cancellation and Concurrency

- One request-scoped cancellation path covers wizard, Vision analysis, and primary request.
- Cancellation before or during setup stops the current request.
- 9router discovery receives an abort signal and existing timeout semantics.
- Copilot discovery and requests receive a VS Code cancellation token where supported.
- Image-bearing messages remain sequential.
- Concurrent requests may each notice missing configuration. A module-scoped in-flight configuration promise coalesces setup so only one wizard is shown; all waiters receive the same result.
- No global analyzer request queue is introduced.

## Error Handling

Add or preserve stable mappings:

- missing API key for 9router discovery: `AUTHENTICATION_ERROR`
- invalid runtime settings: `CONFIGURATION_ERROR`
- malformed 9router model catalog: `MALFORMED_RESPONSE_ERROR` if existing error taxonomy supports it; otherwise `UPSTREAM_UNAVAILABLE` with safe `phase: vision-model-discovery`
- no declared 9router Vision models: `CONFIGURATION_ERROR`
- missing or stale analyzer selection: `CONFIGURATION_ERROR`
- native Copilot `NoPermissions`: `AUTHENTICATION_ERROR`
- native Copilot `NotFound`: `CONFIGURATION_ERROR`
- native Copilot `Blocked`: `UPSTREAM_UNAVAILABLE`
- cancellation: `CANCELLATION_ERROR`
- empty or malformed analyzer stream: `MALFORMED_STREAM_ERROR`

Errors include safe phase metadata such as `vision-model-discovery`, `vision-configuration`, or `vision-proxy`. They may include selected source and opaque model id only where current diagnostic policy already permits model ids. They never include image bytes, data URLs, prompt content, source-message text, or summaries.

## Security and Privacy

- Continue storing only API key in `SecretStorage`.
- Store source, model id, and prompt in User Settings as non-secrets.
- Never log prompt text, even though it is configurable.
- Never log image bytes, encoded image data, original message text, or generated summary.
- Native Copilot receives image and local source-message context only for image-bearing messages being summarized.
- 9router receives the same limited analyzer context in its branch.
- Diagnostics expose booleans and safe metadata, not content.

## Components and Expected File Impact

Prefer focused edits over new abstractions:

- configuration defaults and runtime parsing for source and prompt
- manifest settings and configuration command contribution
- command wiring plus one guided configuration module
- router model-catalog fetch and validation near router boundary
- source-aware Vision analyzer logic
- provider orchestration for missing configuration and current-request continuation
- safe diagnostics updates
- focused unit and integration tests
- README and production design updates

Do not create a webview, dependency, factory hierarchy, or generic model-provider registry.

## Testing Strategy

### Unit tests

- load absent, valid, and invalid Vision source values
- migrate absent source plus existing model id to 9router behavior
- load default and custom prompt; reject whitespace-only prompt
- validate 9router model-list root and entries
- retain only `capabilities.vision === true`
- reject truthy non-boolean values and missing capabilities
- deduplicate and sort 9router choices
- build 9router Vision request with exact custom prompt
- resolve native Copilot model by exact id
- build native message with prompt, text context, and image data
- collect native streamed text and reject empty output
- map native permission, missing-model, blocked, cancellation, and stream errors
- coalesce concurrent missing-configuration setup calls
- preserve fail-closed behavior

### Integration tests

- command selects 9router source, fetches `/v1/models`, filters Vision entries, and writes User settings
- command selects Copilot source, lists native models, and writes User settings
- wizard cancellation leaves settings unchanged
- missing proxy configuration opens setup and successful selection continues current image request
- cancelled or failed setup prevents primary request
- configured 9router source follows secondary 9router request then primary request
- configured Copilot source follows native request then primary 9router request
- stale model and native consent/quota failures prevent primary request
- settings refresh updates published image capability
- diagnostics contain no prompt, image, source-message, or summary content

### Verification gate

Run:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

## Acceptance Criteria

- Users can configure one shared prompt for image descriptions.
- Default prompt equals the previous built-in instruction.
- Users can choose `9router` or native GitHub Copilot as analyzer source.
- 9router picker uses `GET /v1/models` and shows only entries with `capabilities.vision === true`.
- Copilot picker uses native model selection API and persists exact selected id.
- Missing source or model during proxy image use opens guided setup.
- Successful setup continues the current request without requiring resubmission.
- Setup cancellation or analyzer failure prevents the primary request.
- 9router remains the only routing authority for primary requests and 9router analyzer requests.
- No model-name guessing, local fallback policy, or hidden prompt augmentation exists.
- No sensitive Vision content appears in logs or diagnostics.
- Required build, lint, tests, and package commands pass.
