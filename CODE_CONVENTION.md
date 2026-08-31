# Code Convention

## Purpose

This document is the canonical code convention for this repository.

All implementation work must follow this file together with:

- `AGENTS.md`
- `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`

If a code change conflicts with this convention, update the convention explicitly before or together with the implementation. Do not silently violate it.

## Scope

This convention is strict and enforceable.

It applies to:

- TypeScript source code
- VS Code extension structure
- request and response adapters
- configuration and secret handling
- diagnostics and logging
- tests
- code review decisions

## Architecture Constraints

This repository must preserve the approved thin provider adapter architecture.

The extension is allowed to:

- register the `9router` language model provider
- expose user-defined curated display models in Copilot Chat
- map display models to opaque `9router` `modelId` values
- adapt host requests into the `9router` API format
- stream responses back to the host
- expose diagnostics and local configuration behavior

The extension is not allowed to:

- implement `9router` routing or fallback policy locally
- become a second routing engine
- replace the official Copilot Chat UI
- intercept internal `github.copilot` network traffic

`9router` remains the single authority for:

- combo definitions
- upstream provider selection
- quota-aware routing
- fallback behavior
- upstream execution policy

## Repository Structure

Use this structure unless the user explicitly approves a change:

```text
src/
  runtime/
  webview/
  provider/
  router/
  config/
  debug/
  types/
```

### Boundary rules

`src/runtime`

- owns activation, command wiring, lifecycle wiring, and provider registration
- must not contain request adaptation or routing policy

`src/webview`

- owns webview markup, styling, and client-side rendering
- runs in the webview browser sandbox, not the extension host
- must not import `vscode` or any `node:*` module, directly or transitively
- must not import `src/runtime`, directly or transitively
- must not duplicate logic that already exists on the extension side; import the runtime-agnostic module instead
- `src/webview/shared` holds modules only the webview and its own panel need
- shared VS Code tokens and native control presentation live in `src/webview/shared/*.css`
- panel layout and domain-specific visuals stay beside panel components
- host/webview message shapes use neutral contracts under `src/types`
- generic React UI primitives require at least two behaviorally identical consumers; CSS reuse is preferred first

Webview markup and styling live in `.tsx` and `.css` files. They must never be
written as string literals in TypeScript.

`src/provider`

- owns host-facing model publication, request adaptation, response streaming integration, and capability mediation
- must not contain business routing logic

`src/router`

- owns `9router` HTTP client behavior, endpoint normalization, auth headers, retries, timeout handling, and stream parsing
- must not contain Copilot-facing UI behavior

`src/config`

- owns settings lookup and validation
- must not store secrets directly

`src/debug`

- owns diagnostics helpers, redaction, output logging, and optional request dumps
- must default to safe behavior

`src/types`

- owns normalized shared interfaces and compatibility contracts
- must not become a generic dumping ground

## File and Naming Rules

### File responsibility

- Each file must have one clear purpose.
- Split files when they start mixing runtime wiring, transport, parsing, logging, and presentation.
- Do not create god files.
- Do not create broad `utils` or `helpers` files without a narrow, explicit responsibility.

### Naming

- Use consistent lowercase file names inside each folder convention.
- Use PascalCase for exported types, classes, and enums.
- Use camelCase for functions, methods, local variables, and object properties.
- Use UPPER_SNAKE_CASE only for real constants.
- Avoid vague names such as `helper`, `utils`, `service`, or `manager` unless the abstraction is truly cohesive and justified.

### Product naming

User-defined curated model names are allowed and must remain separate from backend or upstream ids. Keep the Copilot-facing `id` and `name` distinct from the opaque backend `modelId`; never derive one from another.

## TypeScript Rules

### Strictness

- TypeScript strict mode must remain enabled.
- Do not use `any` unless there is a narrow interoperability boundary and the reason is documented inline.
- Prefer explicit input and return types on exported functions.
- Prefer typed state transitions, discriminated unions, or typed result objects for streaming and adapter flows.

### External data

- Treat all external data as untrusted.
- Validate unknown API responses before promoting them into internal typed objects.
- Do not pass raw untyped API responses deep into the codebase.
- Keep parsing close to the boundary where data enters the system.

### Function design

- Keep functions small and single-purpose.
- Prefer pure transformation functions for request and response conversion.
- Do not mix parsing, retry logic, logging, and host rendering in one function.
- Avoid hidden mutation across adapter boundaries.

## VS Code Extension Rules

- Keep the native Copilot Chat experience intact.
- Do not create a separate chat UI for the main product path.
- Use `vscode.LanguageModelChatProvider` as the primary integration surface.
- Keep model publication, host request handling, and capability signaling explicit and testable.
- Refresh model availability on settings changes when possible.

### Capability exposure

- Capability exposure must be conservative.
- Do not claim support for tools, vision, or advanced capabilities unless the mapped combo is known to support them.
- Prefer safe degradation over optimistic feature exposure.

## Configuration Rules

### Allowed in settings

The following categories may live in per-user VS Code settings:

- base URL
- display model configuration
- combo mapping configuration
- timeout values
- max tokens
- debug mode

### Forbidden in settings

Never store:

- API keys
- bearer tokens
- secret headers
- hidden credentials of any kind

### Secret storage

Secrets must be stored only in VS Code `SecretStorage`.

## Security Rules

- Never commit secrets.
- Never log secrets.
- Never persist secrets in request dumps.
- Redact secrets before writing diagnostics.
- Assume prompt content may be sensitive.
- Do not persist full prompt content unless explicit verbose debugging requires it and redaction rules still hold.

## Request and Transport Rules

- Treat `9router` as the single backend routing authority.
- Use the OpenAI-compatible `/v1` contract unless the user explicitly changes direction.
- Keep request mapping and stream parsing isolated in adapter modules.
- Preserve cancellation behavior from the host.
- Prefer streaming-first behavior over buffered response handling.

### Forbidden transport behavior

- No local fallback-policy implementation
- No hidden secondary routing logic
- No direct upstream-provider selection in the extension as a product behavior

## Error Handling Rules

### Required behavior

- Classify errors into stable categories.
- Use typed errors or typed result boundaries across modules.
- Show concise user-facing errors.
- Keep deep detail in diagnostics only.
- Attach request ids when available.
- Fail fast on invalid local configuration.

### Forbidden behavior

- No silent error swallowing
- No unbounded retry loops
- No leaking raw secrets or sensitive headers in error paths

### Minimum error categories

- authentication error
- configuration error
- combo mapping error
- transport or network error
- timeout or cancellation
- malformed stream error
- upstream unavailable through `9router`

## Tool and Vision Rules

### Tool calling

- Treat tool calling as an adapter concern.
- Keep tool translation logic isolated and directly testable.
- Do not assume host tool schemas are identical to OpenAI tool schemas.
- Degrade safely if a combo should not expose tools.

### Vision

- Prefer native capability only when confirmed.
- Otherwise use a vision proxy path.
- Make proxy behavior diagnosable because it changes cost and latency.

## Diagnostics and Logging Rules

Supported debug levels:

- `minimal`
- `metadata`
- `verbose`

### Logging rules

- Default to safe logging.
- Redact secrets everywhere.
- Keep user-facing diagnostics concise.
- Keep verbose payload data behind explicit opt-in behavior.
- Do not make verbose dump behavior the default path.

## Testing Rules

Testing is required around adapter boundaries.

### Unit-test priorities

- display model resolution
- combo mapping validation
- request conversion
- stream parsing
- error classification
- redaction behavior

### Integration-test priorities

- provider registration
- picker refresh on settings changes
- text-only request flow against a mocked `9router` endpoint
- timeout behavior
- cancellation behavior

### Change-driven test rules

- If you change request conversion, add or update conversion tests.
- If you change stream parsing, add or update stream tests.
- If you change tool logic, add targeted tool adapter tests.
- If you change vision logic, add targeted vision-path tests.
- If you change diagnostics, add redaction and logging-safety tests.

## Review Checklist

Every significant change should be reviewed against this checklist:

- Does the change preserve the thin adapter architecture?
- Does the change keep `9router` as the only routing authority?
- Does the change keep user-facing display models separate from backend `modelId` values?
- Does the change keep secrets out of settings, logs, and dumps?
- Does the change keep capability exposure conservative?
- Does the change isolate adapter logic enough to test directly?
- Does the change avoid oversized files and mixed responsibilities?
- Does the change require updates to architecture or convention docs?

## Prohibited Patterns

The following patterns are not allowed:

- implementing fallback policy inside the extension
- storing API keys in settings
- logging auth headers or tokens
- passing raw unvalidated external payloads across the codebase
- mixing runtime wiring, transport, parsing, and presentation in one module
- broad generic utility files that obscure ownership
- separate chat UI for the primary Copilot integration path
- optimistic capability claims for tools or vision without confirmation

## Decision Rules

When multiple implementation options are available, choose the option that:

- keeps the extension smaller — this governs the extension host and its runtime dependencies, which are the thin adapter this convention exists to protect. Configuration and diagnostics panels under `src/webview` are exempt: their cost is package size, not adapter complexity.
- keeps routing intelligence in `9router`
- preserves native Copilot Chat UX
- minimizes secret exposure
- improves adapter testability

If an implementation option violates one of those points, revise the design before implementing.
