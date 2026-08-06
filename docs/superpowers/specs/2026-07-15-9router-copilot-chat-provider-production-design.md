# 9router Copilot Chat Provider Production System Design

## Document Status

- Status: Approved draft
- Date: 2026-07-15
- Scope: Full production architecture
- Language: English

## Objective

Build a VS Code extension that exposes `9router` as a custom provider inside GitHub Copilot Chat while preserving the native Copilot Chat experience. The extension lets users publish an ordered array of user-defined curated models in the Copilot picker, while `9router` continues to own routing combos, fallback policy, quota behavior, and upstream model execution.

## Context

The design is based on two confirmed facts:

- VS Code can register third-party language model chat providers through the Language Model API, which makes it possible to surface custom models directly in Copilot Chat.
- `9router` already documents an OpenAI-compatible `/v1` API surface and a routing model built around provider-prefixed model identifiers, quota-aware fallback, and multi-tier routing.

Documented `9router` behavior that influences this design:

- OpenAI-compatible client usage via `/v1`
- provider-prefixed model ids such as `gh/gpt-5`, `gh/claude-4.5-sonnet`, and similar forms
- tiered routing behavior such as subscription first, then cheaper fallback, then free fallback
- combo-based routing that can switch providers automatically when quota is exhausted or upstream providers fail

## Goals

- Keep the native Copilot Chat user experience intact.
- Expose `9router` models directly in the Copilot Chat model picker.
- Use `9router` as the single routing and execution backend.
- Support local per-user configuration of which display models appear in the picker.
- Allow each local display model to map to an opaque `9router` `modelId`.
- Keep the extension thin, streaming-first, and operationally simple.
- Provide a production path for tools, vision compatibility, diagnostics, and compatibility hardening.

## Non-Goals

- Replacing the official GitHub Copilot extension
- Intercepting or modifying internal Copilot network traffic
- Reimplementing `9router` routing logic in the extension
- Building a standalone chat UI for the initial product direction

## Product Model

The extension registers a `9router` vendor in VS Code and exposes an ordered array of user-defined curated product models in the Copilot Chat picker.

Each presentation object defines a stable Copilot-facing `id`, a user-facing `name`, and an opaque backend `modelId`. The user controls membership, display order, names, and mappings through local per-user settings. The extension sends `modelId` unchanged; `9router` remains the source of truth for routing behavior.

## Control Boundaries

### 9router backend responsibilities

- route requests to upstream providers
- apply quota-aware fallback policy
- enforce combo definitions
- decide provider failover behavior
- handle upstream-specific model execution
- account for usage and request-level operational metadata

### VS Code extension responsibilities

- register the provider with the host
- expose user-defined curated Copilot-facing display models
- store API credentials securely
- map display models to opaque backend `modelId` values
- adapt Copilot Chat requests into the `9router` API format
- stream responses back into the host
- expose safe diagnostics and configuration state

This boundary is intentional. The extension should not duplicate business routing logic that already belongs in `9router`.

## Recommended Architecture

The production architecture follows a thin provider adapter model.

```text
Copilot Chat UI
    ->
VS Code LanguageModelChatProvider (vendor = 9router)
    ->
Extension adapter layer
    ->
9router /v1 API
    ->
9router combo routing
    ->
Upstream provider
```

### High-level component view

```text
+------------------------+
| Copilot Chat UI        |
| - picker               |
| - prompt input         |
| - agent/tool surface   |
+-----------+------------+
            |
            v
+------------------------+
| VS Code LM Provider    |
| vendor: 9router        |
+-----------+------------+
            |
            v
+------------------------+
| Extension Adapter      |
| - display model map    |
| - request conversion   |
| - stream handling      |
| - config + auth        |
+-----------+------------+
            |
            v
+------------------------+
| 9router API            |
| - combos               |
| - fallback policy      |
| - usage metadata       |
+-----------+------------+
            |
            v
+------------------------+
| Upstream Providers     |
| - GitHub Copilot       |
| - OpenAI               |
| - Anthropic            |
| - Others behind router |
+------------------------+
```

## Runtime Request Flow

### 1. Activation

On activation, the extension should:

- register commands such as `Set API Key` and `Clear API Key`
- register the `9router` language model chat provider
- load local model display settings
- activate `github.copilot-chat` when available
- refresh model availability when configuration changes

### 2. Model publication

When VS Code asks for model information through `provideLanguageModelChatInformation`, the extension should:

- read the locally configured display models
- validate their configured `modelId` values
- expose only valid models to the picker
- optionally degrade invalid entries instead of breaking the entire provider

### 3. Request submission

When the user sends a prompt in Copilot Chat:

- VS Code calls `provideLanguageModelChatResponse`
- the extension receives the selected display model, messages, and tool context
- the extension resolves the selected display model to its configured `9router` `modelId`
- the adapter converts the request into the OpenAI-compatible payload used by `9router`
- the request is sent to the configured `9router` `/v1` endpoint

### 4. Streaming response

The extension should:

- forward text deltas immediately to the host
- preserve cancellation behavior
- forward tool-related response parts when supported
- classify request completion and failure outcomes cleanly

## Configuration Model

### Secret state

Secrets must be stored only in VS Code `SecretStorage`.

- `9router` API key

### Per-user settings

Recommended configuration keys:

- `9router-copilot.baseUrl`
- `9router-copilot.models`: ordered objects containing `id`, `name`, `modelId`, `toolMode`, `visionMode`, `thinkingMode`, and optional `maxInputTokens` and `maxOutputTokens` compatibility fallbacks
- `9router-copilot.visionProxySource`
- `9router-copilot.visionProxyModelId`
- `9router-copilot.visionProxyPrompt`
- `9router-copilot.maxTokens`
- `9router-copilot.requestTimeoutMs`
- `9router-copilot.debugMode`

### Native context window metadata

Before returning picker models, the provider attempts one authenticated
`GET /v1/models` refresh. Exact `modelId` matches read
`capabilities.contextWindow` and `capabilities.maxOutput`, validate each as a
positive safe integer, and publish them as `maxInputTokens` and
`maxOutputTokens` through `LanguageModelChatInformation`. The latest successful
catalog stays in RAM. A failed refresh keeps that cache; when metadata is
missing or invalid, each field falls back independently to its optional model
setting, then `264000`. Catalog failure never hides an otherwise valid model.

Configured context-window values are compatibility fallbacks, not the primary
metadata source. The cache is not persisted, no refresh timer is used, and
catalog ids are matched exactly without deriving combo behavior.

For the used-token numerator, every primary streaming request sets
`stream_options.include_usage` to `true`. The SSE boundary validates the final
OpenAI-compatible usage chunk, normalizes `prompt_tokens`, `completion_tokens`,
and `total_tokens`, and forwards it as a `LanguageModelDataPart` with the
Copilot-compatible `usage` MIME type. Malformed or missing usage is ignored
without failing an otherwise valid response.

`provideTokenCount` remains available for host token-count calls, but VS Code
1.129 does not use it as the response usage source for the native Session Info
widget.

The per-model metadata is independent from `9router-copilot.maxTokens`. The
setting's default is `0`. Only a positive safe integer is sent as `max_tokens`;
`0` or a malformed value omits `max_tokens`, so the extension applies no
response-token limit. `9router` or an upstream provider may still enforce its
own limit.

### Native thinking effort picker

Each valid model configures ordered non-`off` choices through `thinkingEfforts`; array order controls picker order after host-only `None`. A missing or empty list means `off` only, omits `configurationSchema`, and hides the picker.

A non-`off` `thinkingMode` must appear in that model's `thinkingEfforts`; invalid or duplicate lists reject only the affected model. A valid host selection overrides the default for the request. `none` maps to internal `off`; enabled values are accepted only when selected model allowlist contains them. Missing, malformed, unsupported, or stale host values fall back to validated `thinkingMode`.

Extension keeps configured `modelId` unchanged. Non-`off` effective levels set OpenAI-compatible `reasoning_effort`; `off` omits it. `9router` owns provider-specific reasoning translation and compatibility policy. Reasoning deltas remain hidden.

### Recommended behavior

- Ship one default `agent` object with an empty `modelId`, so it remains unpublished until configured.
- Require each published display model to reference an existing user-configured `9router` model.
- Let users add, remove, rename, and reorder user-defined curated model objects.
- Refresh the picker when settings change, without requiring reload where possible.
- If a mapping is invalid, degrade that single model entry rather than disabling the whole provider.

## 9router API Contract

The extension should treat `9router` as an OpenAI-compatible backend first.

### Base URL

Configured locally by the user:

- `https://<9router-host>/v1`

### Authentication

Use bearer token authentication:

```http
Authorization: Bearer <9router_api_key>
```

### Model execution contract

Recommended request shape:

- `model`: configured opaque `modelId`
- `messages`
- `stream`
- `tools` when supported
- `max_tokens` when a positive safe integer is configured
- optional generation parameters that `9router` documents as compatible

Thinking preferences are configured per curated display model. The extension keeps `modelId` unchanged and sends a validated non-`off` level through `reasoning_effort`. `9router` owns provider-specific reasoning translation, normalization, limits, and upstream compatibility.

### Compatibility note

The extension should not require `9router` to expose raw internal routing state. It only needs:

- a stable chat-completion surface
- stable combo ids
- predictable streaming behavior
- optional request ids or metadata for diagnostics

## Capability Model

The extension should not assume that every combo supports every capability equally.

### Core principle

Host-visible capabilities should be conservative unless confirmed by `9router`.

### Capability areas

- text generation
- tool calling
- vision input
- reasoning or long-context features

The extension consumes Context Window metadata from `GET /v1/models`. Tools, Vision, and reasoning capability exposure still prefer correctness over optimism and remain conservative unless confirmed by `9router`.

## Tool Calling Strategy

Tool calling is a compatibility layer, not a routing concern.

The extension should:

- collect tool definitions from VS Code
- convert them into the request format expected by `9router`
- stream tool-call response parts back into the host format
- isolate this translation inside a dedicated adapter module

Because Copilot-host tool formats may differ from standard OpenAI tool schemas, this module should be independently testable and version-conscious.

If a mapped combo is not approved for tools, the extension should degrade gracefully and avoid over-advertising support.

## Vision Compatibility Strategy

Some `9router` models may not reliably support native multimodal input. To preserve image workflows while keeping `9router` as the primary routing authority, proxy-mode image analysis uses one shared analyzer selected from either `9router` or native `GitHub Copilot`.

### Shared Vision proxy configuration

Proxy mode uses three flat settings:

- `9router-copilot.visionProxySource`: `9router` or `copilot`
- `9router-copilot.visionProxyModelId`: opaque id from the selected source
- `9router-copilot.visionProxyPrompt`: full analyzer instruction (editable; default prompt is built in)

Legacy migration remains compatibility-safe: if `visionProxySource` is unset and `visionProxyModelId` is non-empty, runtime treats the source as `9router`.

### Guided setup and automatic setup

The extension contributes command `9routerCopilot.configureVisionProxy` with the display title `9router: Configure Vision Proxy`. The same flow is used when proxy-mode image requests arrive without a usable source/model configuration.

1. select source (`9router` or `GitHub Copilot`)
2. select model from that source
3. persist User settings in order: `visionProxyModelId`, then `visionProxySource`

If setup succeeds, the current request continues immediately with the returned selection. If setup is cancelled or fails, the request stops with an actionable configuration error.

Proxy models keep image input published while source or model id is missing, provided the shared prompt is valid. This allows VS Code to deliver the image request and lets the same guided Quick Pick repair configuration before analysis.

### 9router analyzer discovery

For `9router` source, discovery uses authenticated `GET /v1/models` and treats the response as untrusted JSON. Candidates are retained only when:

- `id` is a non-empty string
- `capabilities` is an object
- `capabilities.vision === true`

Results are deduplicated by exact `id` and sorted before Quick Pick display.

### Native Copilot analyzer discovery

For `copilot` source, discovery uses `vscode.lm.selectChatModels({ vendor: 'copilot' })`.

Stable VS Code consumer APIs do not expose image capability metadata on selected models. The extension therefore does not infer support from model names and does not publish guessed capability flags. Compatibility is enforced at runtime by the native request result for the exact selected model id.

### Runtime flow and boundaries

Recommended proxy flow:

1. detect image attachments in the host request
2. check the selected display model's local `visionMode` configuration
3. send image inputs directly to `9router` when `visionMode` is `native`
4. when `visionMode` is `proxy`, run guided setup if source/model is missing
5. run `VisionProxyService` per image-bearing message, sequentially, through the selected analyzer source
6. convert VS Code `LanguageModelDataPart` values into OpenAI-compatible `image_url` data URLs for proxy requests
7. require a non-empty textual summary, replace raw images with `[Vision proxy summary]`
8. send the transformed conversation to the selected display model's primary `9router` combo
9. block image input when `visionMode` is `off`

Tools and Thinking Effort are omitted from Vision-stage analyzer requests and remain primary-request concerns.

### Fail-closed and privacy

Vision analysis is fail-closed across discovery, setup, and execution. Missing or stale model ids, consent/quota rejection, 404, timeout, cancellation, malformed streams, and upstream failures all stop processing before the primary request is submitted.

Diagnostics may include safe metadata such as source, model id, counts, timing, and request ids. Diagnostics must never include prompt content, image bytes, data URLs, source message text, API keys, or proxy summaries.

This keeps UX coherent while preserving explicit operational control and testability through focused vision adapters.

## Reliability and Error Handling

### Error ownership

`9router` should handle:

- upstream provider selection
- fallback logic
- upstream quota exhaustion
- provider-specific retry or health behavior at the router tier

The extension should handle:

- missing API key
- invalid local configuration
- invalid combo mapping
- network failure to `9router`
- request timeout
- malformed streaming data
- user-safe rendering of failures

### Error categories

The extension should classify failures into:

- authentication error
- configuration error
- combo not found
- network or transport error
- timeout or cancellation
- upstream unavailable through `9router`

### Degradation rules

- one broken model mapping must not disable the whole provider
- one failed request must not corrupt future picker state
- settings errors should fail fast with clear UI feedback

## Observability

Recommended debug levels:

- `minimal`
  - provider status
  - timing summaries
  - request success or failure state

- `metadata`
  - request id
  - selected display model
  - configured opaque `modelId`
  - token or latency summaries when available

- `verbose`
  - full request and response dumps
  - only with redaction controls
  - only as an explicit debugging mode

Recommended observability surfaces:

- VS Code output channel
- structured debug events
- optional dump files in extension storage

Secrets must always be redacted from every logging path.

## Security Model

- Store API keys only in `SecretStorage`.
- Never place credentials in `settings.json`.
- Keep verbose request dumps disabled by default.
- Redact secrets and sensitive headers before persistence.
- Assume prompt content can be sensitive and avoid storing it outside explicit debug workflows.

## Performance Considerations

- Keep activation lightweight.
- Avoid blocking picker availability on remote model discovery for the first production release.
- Prefer streaming-first delivery over buffered response handling.
- Bound request timeout defaults to avoid hanging the Copilot UX.
- Isolate token estimation from the critical request path when possible.

## Testing Strategy

### Unit tests

- display model resolution
- combo mapping validation
- request conversion
- streaming parser behavior
- error classification
- redaction logic

### Integration tests

- provider registration
- picker refresh on settings changes
- text-only request round trip against a mocked `9router` endpoint
- timeout and cancellation behavior

### Compatibility tests

- selected VS Code versions
- selected Copilot Chat versions
- degraded behavior when host capabilities evolve

## Deployment and Runtime Model

The production design does not require a local sidecar or proxy process.

- The extension runs inside the VS Code extension host.
- Requests are sent directly from the extension host to `9router`.
- `9router` remains the only routing control plane and data plane for model execution.

This minimizes local operational burden and keeps installation simple for end users.

## Delivery Plan

### Phase 1: Foundation

- register the `9router` provider
- publish validated user-defined curated display models
- implement API key flow
- support text-only streaming through `9router`

### Phase 2: Runtime hardening

- settings-driven picker refresh
- timeout and error handling polish
- metadata diagnostics

### Phase 3: Tool support

- tool schema adapter
- tool streaming support
- failure isolation for unsupported combos

### Phase 4: Vision and advanced capability handling

- vision proxy
- conservative capability gating
- richer observability

### Phase 5: Production hardening

- regression coverage
- compatibility matrix testing
- release guardrails

## Trade-offs

### Why this design is recommended

- It keeps routing logic where it belongs: in `9router`.
- It makes the extension easier to maintain.
- It allows user-visible customization without creating split-brain routing policy.
- It aligns well with the documented OpenAI-compatible surface of `9router`.

### Trade-offs accepted

- The extension depends on stable combo ids from `9router`.
- Capability signaling may be conservative until combo metadata is richer.
- Vision proxying adds latency and operational complexity when enabled.
- Host compatibility may still change across VS Code and Copilot Chat versions.

## References

- `9router` README:
  - https://github.com/decolua/9router/blob/master/README.md
- `9router` smart routing documentation:
  - https://github.com/decolua/9router/blob/master/gitbook/content/en/features/smart-routing.md
- `9router` subscription provider models:
  - https://github.com/decolua/9router/blob/master/gitbook/content/en/providers/subscription.md
- `9router` OpenAI SDK example:
  - https://github.com/decolua/9router/blob/master/skills/9router-chat/SKILL.md
- GitHub Copilot model selection documentation:
  - https://docs.github.com/en/copilot/how-tos/use-ai-models/change-the-chat-model
- Copilot Language Server release docs:
  - https://github.com/github/copilot-language-server-release
- VS Code Language Model API:
  - https://code.visualstudio.com/api/extension-guides/language-model
- Reference extension:
  - https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot
  - https://github.com/Vizards/deepseek-v4-for-copilot
