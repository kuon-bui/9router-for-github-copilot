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
- Render router-provided reasoning through the native Copilot Chat thinking surface when the host supports it.
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

- normalize the canonical non-empty `delta.reasoning_content` string, plus documented string aliases at the SSE compatibility boundary, into one dedicated reasoning event before sibling visible text
- forward reasoning immediately as a native thinking part when the running host supports it
- drop reasoning safely, without converting it to visible text, when the host lacks the proposed thinking-part API
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
- `9router-copilot.models`: ordered objects containing `id`, `name`, `modelId`, `toolMode`, `visionMode`, `thinkingMode`, `maxInputTokens`, and `maxOutputTokens`
- `9router-copilot.visionProxyModelId`
- `9router-copilot.maxTokens`
- `9router-copilot.requestTimeoutMs`
- `9router-copilot.debugMode`

`9router-copilot.requestTimeoutMs` defaults to `0`. Zero disables the
extension-level timer; a positive finite value limits each primary or Vision
proxy request independently. Host cancellation remains active when the timer is
disabled, and `9router` or network infrastructure may still enforce its own
timeout.

### Native context window metadata

Every valid published model exposes its validated per-model
`maxInputTokens` and `maxOutputTokens` values through
`LanguageModelChatInformation`. These values provide the native Context Window
denominator in Copilot Chat.

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

Every valid published model exposes a `configurationSchema` navigation property named `reasoningEffort`. Copilot Chat renders the property as an independent per-model **Thinking Effort** submenu with `None`, `Minimal`, `Low`, `Medium`, `High`, `XHigh`, and `Max`.

The validated model object's `thinkingMode` value supplies that model's schema default and request fallback. A valid `modelConfiguration.reasoningEffort` value overrides the local default for the current request; `none` maps to internal `off`, while the remaining values map directly.

The extension keeps the configured `modelId` unchanged in `model`. For a non-`off` effective level, it sets the OpenAI-compatible `reasoning_effort` request field. `9router` owns provider-specific reasoning translation and compatibility policy. The request preference does not guarantee that the routed model will return reasoning deltas.

### Native reasoning detail

The primary response parser recognizes a non-empty OpenAI-compatible reasoning string and normalizes it as a `reasoning-delta`. The canonical field is `choices[0].delta.reasoning_content`; compatibility aliases are `cot_summary`, `reasoning_text`, `reasoning`, and `thinking`. The first populated string in the documented precedence order produces at most one event per frame. When a frame contains reasoning and visible content, reasoning is emitted first. Empty, malformed, or non-string reasoning values are ignored without failing otherwise valid response data. Both LF and CRLF SSE boundaries are supported across transport chunks.

`LanguageModelThinkingPart` is a proposed VS Code API. A focused provider compatibility module probes for its constructor at runtime and confines the structural cast to that boundary. When available, every reasoning delta is reported immediately as a native thinking part. When unavailable, the extension drops only the reasoning delta and continues streaming visible text, usage, and tool calls. It never falls back to `LanguageModelTextPart`, adds no `enabledApiProposals` manifest entry, and adds no reasoning-display setting.

Copilot Chat owns the collapsible presentation, grouping, and labels. The extension cannot guarantee a pixel-identical layout or generate host orchestration labels. Internal Vision proxy reasoning is not a primary user-facing response and is not rendered.

Every started primary stream emits a safe minimal-threshold `Reasoning stream diagnostic` event, including streams with zero reasoning and streams terminated by cancellation or failure. The event contains only the effective thinking mode, terminal outcome, aggregate delta/character/emission/drop counts, curated display model id, and runtime thinking-part availability. It never contains reasoning text, prompts, raw SSE frames, or serialized parts.

Thinking parts returned in prior host assistant messages are omitted from ordinary router message content and from image-bearing messages sent to the Vision proxy. Non-image response data such as usage metadata is omitted with them. If that leaves an ordinary assistant turn with no visible content, the empty turn is omitted as well. Replaying reasoning through a request-side `reasoning_content` field is out of scope unless `9router` later defines a canonical, provider-neutral history contract that requires it.

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

If `9router` later exposes per-combo capability metadata, the extension can enrich the picker and request path. Until then, capability exposure should prefer correctness over optimism.

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

Some `9router` models may not reliably support native multimodal input. To avoid blocking image-driven workflows entirely, the extension supports a Vision proxy path through one shared `9router` model configured by `9router-copilot.visionProxyModelId`.

Recommended vision proxy flow:

1. detect image attachments in the host request
2. check the selected display model's local `visionMode` configuration
3. send image inputs directly to `9router` when `visionMode` is `native`
4. when `visionMode` is `proxy`, have `VisionProxyService` process each image-bearing message sequentially through the shared model from `9router-copilot.visionProxyModelId`
5. use `image-input-adapter.ts` to convert each VS Code `LanguageModelDataPart` into an OpenAI-compatible `image_url` data URL; batch multiple images from the same message into one Vision request
6. replace the raw images in each successfully processed message with a `[Vision proxy summary]` text block
7. send the transformed conversation to the selected display model's primary `9router` combo
8. block image inputs when `visionMode` is `off`
9. mark the request as native-vision, vision-proxied, or vision-blocked in diagnostics when debug mode allows it

The shared combo must already exist in `9router` and accept `image_url` data URLs. One sequential Vision request runs per image-bearing message. Tools and Thinking Effort are omitted from Vision-stage requests and apply only to the primary request. Diagnostics may record counts, timing, outcomes, and request ids, but must never contain image data, prompt content, or Vision proxy summary content.

All Vision-stage errors are fail-closed. A missing shared combo, 404, timeout, cancellation, malformed stream, or upstream error stops processing, and the transformed request must not reach the primary combo. The extension must not retry images through the primary combo or create local MIME, size, routing, or fallback policy.

This keeps the UX coherent, but it comes with higher cost and latency. Vision proxying should therefore be explicit, optional, operationally visible, and independently testable through `VisionProxyService` and `image-input-adapter.ts`.

Native vision remains explicit and must be configured only for display models whose mapped `9router` combo is confirmed to accept image inputs directly. Proxy mode is reserved for text-only primary combos that need image inputs converted to textual context before reaching `9router`. In both modes, `9router` retains ownership of combo routing, provider selection, and fallback behavior.

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
  - deeper request and response diagnostics after redaction
  - only with redaction controls
  - only as an explicit debugging mode

Recommended observability surfaces:

- VS Code output channel
- structured debug events
- optional dump files in extension storage

Secrets must always be redacted from every logging path. Reasoning content is never diagnostic payload data, even at `verbose`. After a primary reasoning stream, diagnostics may record only the curated display model, received/emitted/dropped delta counts, received character count, and runtime thinking-part support state.

## Security Model

- Store API keys only in `SecretStorage`.
- Never place credentials in `settings.json`.
- Keep verbose request dumps disabled by default.
- Redact secrets and sensitive headers before persistence.
- Never log, dump, or persist raw reasoning deltas.
- Assume prompt content can be sensitive and avoid storing it outside explicit debug workflows.

## Performance Considerations

- Keep activation lightweight.
- Avoid blocking picker availability on remote model discovery for the first production release.
- Prefer streaming-first delivery over buffered response handling.
- Keep request cancellation active even when the optional extension-level timeout is disabled.
- Isolate token estimation from the critical request path when possible.

## Testing Strategy

### Unit tests

- display model resolution
- combo mapping validation
- request conversion
- streaming parser behavior
- reasoning-part runtime compatibility and safe drop behavior
- omission of thinking parts from replayed assistant text
- error classification
- redaction logic

### Integration tests

- provider registration
- picker refresh on settings changes
- text-only request round trip against a mocked `9router` endpoint
- reasoning followed by visible text with metadata-only diagnostics
- timeout and cancellation behavior

### Compatibility tests

- selected VS Code versions
- selected Copilot Chat versions
- hosts with and without the proposed `LanguageModelThinkingPart` constructor
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
- runtime-gated native reasoning detail
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
- Native reasoning detail depends on a proposed host API and therefore degrades to hidden reasoning on unsupported hosts.
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
- VS Code proposed thinking-part declaration:
  - https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
- Reasoning detail streaming design:
  - `docs/superpowers/specs/2026-07-18-reasoning-detail-streaming-design.md`
- Reference extension:
  - https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot
  - https://github.com/Vizards/deepseek-v4-for-copilot
