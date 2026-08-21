# 9router Copilot Chat Provider System Design

## Document Status

- Status: Draft v1
- Scope: VS Code extension architecture
- Language: English

## Objective

Build a VS Code extension that allows GitHub Copilot Chat to use `9router` as a custom model provider while preserving the native Copilot Chat experience, including model selection, agent mode, tools, instructions, MCP integration, and skills where supported by the host.

## Executive Summary

The recommended approach is to implement a custom `vscode.LanguageModelChatProvider` and register it as a new vendor inside VS Code. This is the same general integration direction used by `Vizards.deepseek-v4-for-copilot`, which proves that a third-party model can appear directly in the Copilot Chat model picker instead of requiring a separate chat UI.

This design intentionally avoids:

- intercepting traffic from the official `github.copilot` extension
- patching internal Copilot network requests
- building a separate assistant sidebar for the MVP

Instead, the extension acts as a provider adapter:

```text
Copilot Chat UI
    ->
VS Code LanguageModelChatProvider (vendor = 9router)
    ->
Extension request adapter
    ->
9router client
    ->
9router routing layer
    ->
Target upstream model provider
```

## Design Goals

- Keep the native Copilot Chat experience intact.
- Make `9router` models available from the Copilot Chat model picker.
- Support BYOK authentication with secure local secret storage.
- Preserve compatibility with Copilot Chat features such as streaming and tool-oriented flows.
- Minimize integration complexity by standardizing on an OpenAI-compatible contract with `9router`.
- Create a phased path from text-only MVP to tools, vision proxying, and richer observability.

## Non-Goals

- Replacing the GitHub Copilot extension
- Reverse-proxying or MITM-ing Copilot network traffic
- Building a standalone chat panel for the initial release
- Fully replicating every Copilot-internal behavior on day one

## Assumptions

- Users already have access to GitHub Copilot Chat in VS Code.
- VS Code continues to expose the Language Model provider surface needed to register third-party chat models.
- `9router` can expose an OpenAI-compatible or near-compatible Responses API.
- The host remains responsible for the top-level Copilot Chat UX, while this extension remains responsible only for provider adaptation.

## Functional Requirements

- Expose one or more `9router` models in the Copilot Chat model picker.
- Allow the user to configure and securely store a `9router` API key.
- Send multi-turn chat requests from Copilot Chat to `9router`.
- Stream model output back into Copilot Chat.
- Support model metadata refresh without requiring a separate UI.
- Provide a path to tool-calling support.
- Provide a path to image attachment support through vision proxying when required.

## Non-Functional Requirements

- Startup overhead should be minimal and should not noticeably slow VS Code activation.
- Streaming latency should be good enough to feel interactive in Copilot Chat.
- Secret handling must avoid writing API keys to disk-based configuration.
- Failures should degrade gracefully and present actionable messages.
- The provider adapter should remain thin and testable.
- The extension should support incremental rollout from MVP to advanced features.

## Key Findings

### Findings from Copilot and VS Code documentation

- GitHub Copilot SDK documentation confirms BYOK flows for OpenAI-style providers using `baseUrl` and `apiKey`.
- VS Code exposes a Language Model API that allows extensions to register chat model providers.
- The cleanest path for `9router` is to become a first-class provider in the host rather than modifying the behavior of the official Copilot extension.

### Findings from `Vizards.deepseek-v4-for-copilot`

- The extension contributes `languageModelChatProviders` in `package.json`.
- It registers a provider with `vscode.lm.registerLanguageModelChatProvider(...)`.
- Its provider implements:
  - `provideLanguageModelChatInformation`
  - `provideLanguageModelChatResponse`
  - `provideTokenCount`
  - `onDidChangeLanguageModelChatInformation`
- It activates `github.copilot-chat` and refreshes the model picker after registration.
- It stores API keys in VS Code `SecretStorage`, not in `settings.json`.
- It includes request conversion, streaming, tool-flow handling, token estimation, and a vision proxy path.
- Its README explicitly warns that some Copilot Chat integration behavior depends on host capabilities that may change across VS Code versions.

## Architecture Overview

### High-Level Components

```text
+-----------------------+
| Copilot Chat UI       |
| - model picker        |
| - prompt input        |
| - agent/tool surface  |
+-----------+-----------+
            |
            v
+-----------------------+
| VS Code LM Provider   |
| vendor: 9router       |
+-----------+-----------+
            |
            v
+-----------------------+
| Provider Adapter      |
| - model metadata      |
| - request conversion  |
| - response streaming  |
| - token estimation    |
+-----------+-----------+
            |
            v
+-----------------------+
| 9router Client        |
| - auth                |
| - retries             |
| - SSE streaming       |
| - error mapping       |
+-----------+-----------+
            |
            v
+-----------------------+
| 9router Backend       |
| - model routing       |
| - usage accounting    |
| - upstream abstraction|
+-----------------------+
```

### System Context

```text
+------------------+        +------------------------------+
| End User         |        | VS Code Host                |
| - selects model  |<------>| - Copilot Chat UI           |
| - asks questions |        | - Language Model runtime    |
+------------------+        +---------------+--------------+
                                            |
                                            v
                           +-------------------------------+
                           | 9router VS Code Extension     |
                           | - provider registration       |
                           | - request/response adapter    |
                           | - auth + config               |
                           +---------------+---------------+
                                           |
                                           v
                           +-------------------------------+
                           | 9router API                   |
                           | - model registry              |
                           | - Responses API endpoint      |
                           | - routing and accounting      |
                           +---------------+---------------+
                                           |
                                           v
                           +-------------------------------+
                           | Upstream Model Providers      |
                           | - OpenAI / Anthropic / etc.   |
                           +-------------------------------+
```

## Core Design Principles

- Preserve Copilot UI and workflow instead of recreating it.
- Keep the extension focused on provider adaptation, not agent orchestration.
- Use `SecretStorage` for credentials and keep secrets out of configuration files.
- Prefer streaming-first request handling for responsive chat UX.
- Design around a stable `9router` contract so the VS Code extension stays thin.
- Treat tool calling and vision as explicit compatibility layers, not assumptions.

## Request Lifecycle

### 1. Activation

On extension activation:

- register commands such as `Set API Key`
- register the `9router` language model chat provider
- activate `github.copilot-chat` if available
- trigger a model picker refresh

### 2. Model Discovery

When VS Code asks for available models through `provideLanguageModelChatInformation`, the provider returns one or more `9router` models.

Two model discovery strategies are supported:

- Static discovery for MVP
  - Hard-code a small productized set such as `9router-auto`, `9router-fast`, and `9router-reasoning`
- Dynamic discovery for v2
  - Fetch model metadata from `9router` and expose it in the picker

### 3. User Prompt Submission

When a user submits a prompt in Copilot Chat:

- VS Code invokes `provideLanguageModelChatResponse`
- the extension receives the chat messages and tool context
- the provider classifies the request type
- the adapter converts the request into the `9router` Responses API payload
- the client sends the request to `9router`
- the extension streams the response back as `vscode.LanguageModelResponsePart`

### 4. Streaming Response

The extension should:

- forward text deltas as soon as they arrive
- surface tool-call deltas when supported
- propagate completion state and finish reason
- record request metadata for debugging when enabled

### 5. Failure Handling

If a request fails:

- classify the error as configuration, authentication, transport, timeout, or upstream failure
- return a concise user-facing error
- attach request metadata to logs when available
- avoid logging secrets or full prompt bodies unless explicitly enabled in verbose diagnostics

## Provider Responsibilities

The `9router` provider should implement the following responsibilities.

### Model metadata

- expose vendor and model identifiers
- publish human-readable model names
- indicate authentication status
- optionally surface capabilities and pricing hints

### Request conversion

- convert VS Code message objects into the `9router` message schema
- preserve role ordering and conversational context
- include tool definitions when present
- attach model-level settings such as max tokens or reasoning mode

### Response conversion

- convert `9router` streaming events into VS Code response parts
- map tool call events into host-compatible output
- map usage and completion metadata into debug or telemetry layers

### Token counting

For MVP, token counting can be heuristic.

For later phases, it should be calibrated from actual `9router` usage data.

## Internal Module Design

### Runtime layer

Responsibilities:

- activate the extension
- register commands
- register the language model provider
- refresh model availability when configuration changes

### Provider layer

Responsibilities:

- expose model metadata to VS Code
- receive chat requests from the host
- convert requests and stream responses
- handle capability mapping for tools, vision, and reasoning

### Router client layer

Responsibilities:

- build authenticated HTTP requests
- normalize endpoints and headers
- manage retries and timeouts
- parse streaming events
- convert upstream failures into typed local errors

### Debug layer

Responsibilities:

- output channel logging
- request metadata capture
- optional dump files
- redaction before persistence

## Proposed 9router API Contract

The extension will be much simpler and more reliable if `9router` exposes an OpenAI-compatible or near-compatible API.

### Authentication

Use bearer token authentication:

```http
Authorization: Bearer <api_key>
```

### Model listing

Recommended endpoint:

```http
GET /v1/models
```

Recommended fields:

- `id`
- `display_name`
- `context_window`
- `supports_tools`
- `supports_vision`
- `supports_reasoning`

### Responses API

Recommended endpoint:

```http
POST /v1/responses
```

Recommended request fields:

- `model`
- `input`
- `tools`
- `tool_choice`
- `stream`
- `store`
- `reasoning`
- `max_output_tokens`
- optional metadata such as `conversation_id` or `workspace_id`

Recommended streaming response fields:

- `response.output_text.delta`
- `response.function_call_arguments.delta`
- `response.reasoning_summary_text.delta` when enabled
- terminal `response.completed`, `response.incomplete`, or `response.failed`
- usage and request id from terminal response envelopes

### Compatibility note

If `9router` cannot expose an OpenAI-compatible surface directly, the extension should still preserve the same internal contract and isolate all upstream-specific translation inside `router/client.ts`.

## Authentication and Secret Management

The extension should expose commands for:

- setting the `9router` API key
- clearing the API key
- validating that a key is present

Storage rules:

- Store secrets only in VS Code `SecretStorage`.
- Never write secrets to `settings.json`.
- Keep `baseUrl`, `defaultModel`, and model mappings in configuration.

## Configuration Design

Recommended settings:

- `9router-copilot.baseUrl`
- `9router-copilot.defaultModel`
- `9router-copilot.modelMap`
- `9router-copilot.visionModel`
- `9router-copilot.maxTokens`
- `9router-copilot.debugMode`
- `9router-copilot.requestTimeoutMs`

Recommended debug levels:

- `minimal`
- `metadata`
- `verbose`

## Data Flow and Boundaries

### Inbound data from VS Code

- conversation messages
- selected model information
- tool definitions
- optional image attachments
- cancellation tokens

### Outbound data to 9router

- normalized message history
- model id
- generation settings
- tool schema payload
- optional vision-proxy-generated text

### Returned data to VS Code

- streaming text chunks
- tool call events
- completion metadata
- user-safe error information

## Vision Compatibility Strategy

Some upstream models behind `9router` may not have reliable native vision support. In that case, the extension should use a vision proxy strategy.

Vision proxy flow:

1. Detect image attachments in the chat request.
2. Use an available VS Code or Copilot-compatible vision model to describe the image.
3. Insert the generated description into the text prompt sent to `9router`.
4. Mark the request as vision-proxied in diagnostics when debug mode is enabled.

This keeps the UI experience consistent while avoiding a hard dependency on native multimodal support in the routed model.

## Tool Calling Strategy

Tool calling is the most sensitive integration area.

The extension should treat tools as a compatibility layer:

- collect tool definitions from VS Code
- convert them to the `9router` tool schema
- stream tool calls back to the host in the expected structure
- preserve tool ordering and correlation ids if the host depends on them

Because host-side tool formats may diverge from standard OpenAI tool schemas, the adapter layer must be isolated and testable.

## Deployment and Runtime Model

This design has no separate local daemon in the MVP.

Runtime characteristics:

- the extension runs inside the VS Code extension host
- outbound requests go directly from the extension host to `9router`
- no local proxy process is required
- no container or sidecar is required

This keeps installation simple and reduces operational burden for end users.

## Suggested Repository Structure

```text
src/
  extension.ts
  runtime/
    lifecycle.ts
    provider.ts
    commands.ts
  provider/
    index.ts
    models.ts
    request.ts
    stream.ts
    tools.ts
    vision.ts
    tokens.ts
  router/
    client.ts
    auth.ts
    endpoints.ts
    errors.ts
    models.ts
  config/
    index.ts
  debug/
    logger.ts
    dumps.ts
  types/
    vscode.ts
    router.ts
```

## Reliability and Error Handling

The client layer should handle:

- authentication errors
- invalid model ids
- timeout failures
- transport failures
- malformed streaming events
- upstream rate limits

Error handling rules:

- show concise user-facing errors in the UI
- keep verbose detail in logs only
- attach request ids when available
- never leak secret values into diagnostics

## Performance Considerations

- Avoid expensive model discovery during startup when static metadata is sufficient.
- Cache model metadata when using dynamic discovery.
- Prefer server-sent event streaming or equivalent incremental transport.
- Keep token estimation lightweight and avoid blocking the response path.
- Bound request dump size in verbose mode to prevent runaway storage usage.

## Observability

The design should support three observability layers.

### User-facing diagnostics

- output channel logging
- simple health and configuration messages

### Developer diagnostics

- structured request metadata
- optional request and response dumps
- timing and usage summaries

### Product telemetry

- latency
- stream completion success rate
- tool call success rate
- vision proxy usage frequency

Telemetry must remain optional and must avoid collecting sensitive prompt contents by default.

## Security Considerations

- Store API keys in `SecretStorage`.
- Avoid writing prompt bodies in non-verbose modes.
- Redact secrets from every log path.
- Treat request dump export as an explicitly risky debug feature.
- Assume cross-extension data exposure risks exist and keep secret handling narrow.

## Testing Strategy

### Unit tests

- request conversion
- response stream parsing
- error mapping
- configuration parsing
- redaction logic

### Integration tests

- provider registration
- model picker exposure
- text-only round trip against a mock `9router` endpoint
- streaming cancellation behavior

### Compatibility tests

- selected VS Code versions
- selected Copilot Chat versions where feasible
- fallback behavior when Copilot Chat is unavailable or delayed

## Rollout Strategy

### Milestone 1

- private MVP for text-only prompting

### Milestone 2

- controlled rollout with multiple models and better diagnostics

### Milestone 3

- tool calling support

### Milestone 4

- vision proxy and production hardening

## Compatibility Risks

- `languageModelChatProviders` behavior may evolve across VS Code versions.
- Some “works inside Copilot Chat” behavior may depend on host internals rather than fully stable public APIs.
- Tool calling interoperability is likely the most fragile part of the design.
- Vision proxying increases latency and cost.
- Poor streaming semantics from `9router` will noticeably degrade Copilot Chat UX.

## Delivery Plan

### Phase 1: Text-Only MVP

- Scaffold the TypeScript extension
- Register `languageModelChatProviders`
- Expose one model such as `9router-auto`
- Implement API key storage in `SecretStorage`
- Send text-only requests to `9router`
- Stream plain text back into Copilot Chat

### Phase 2: Model Catalog

- Support multiple models
- Add `GET /v1/models`
- Improve model metadata in the picker
- Add timeout, retry, and request id handling

### Phase 3: Tools and Diagnostics

- Add tool calling pass-through
- Add usage logging
- Add token estimation
- Add output channel and request dump support

### Phase 4: Vision and Reasoning

- Add vision proxy support
- Add model capability flags
- Add reasoning mode mapping

### Phase 5: Hardening

- Add regression tests
- Add compatibility matrix coverage by VS Code version
- Benchmark stream quality, latency, and tool success rate

## Recommended Technical Decisions

- Use `vendor = 9router`.
- Keep `9router` as the single upstream abstraction layer.
- Standardize on an OpenAI-compatible protocol first.
- Ship a text-only MVP before tools and vision.
- Keep debug behavior behind explicit configuration levels.

## Open Questions

- Which exact `9router` model ids should be exposed in the first model picker release?
- Will `9router` support dynamic model listing at launch, or should MVP use a fixed catalog?
- What exact streaming format will `9router` return?
- Does `9router` need to preserve provider-specific reasoning controls, and if so, how should they map into the host UX?
- Which tool schema should be treated as the canonical internal representation?

## Recommended Next Step

The next implementation step is to scaffold the extension for Phase 1 and prove the core loop:

1. register a `9router` provider
2. show one `9router` model in the Copilot Chat picker
3. send a text request to `9router`
4. stream the reply back into Copilot Chat

## References

- GitHub Copilot SDK BYOK setup:
  - https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/backend-services
  - https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/bundled-cli
- GitHub Copilot model selection in VS Code:
  - https://docs.github.com/en/copilot/how-tos/use-ai-models/change-the-chat-model
- Copilot Language Server release docs:
  - https://github.com/github/copilot-language-server-release
- VS Code Language Model API:
  - https://code.visualstudio.com/api/extension-guides/language-model
- Reference extension:
  - https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot
  - https://github.com/Vizards/deepseek-v4-for-copilot
