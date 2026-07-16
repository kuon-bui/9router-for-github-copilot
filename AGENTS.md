# Agent Guidance for 9router Copilot Extension

## Purpose

This repository builds a VS Code extension that exposes `9router` as a custom provider inside GitHub Copilot Chat.

The extension must preserve the native Copilot Chat experience and stay aligned with the production system design in:

- `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`
- `CODE_CONVENTION.md`

If there is any conflict between implementation ideas and the design spec, follow the design spec unless the user explicitly changes it.

## Code Convention

All implementation work must follow `CODE_CONVENTION.md`.

`CODE_CONVENTION.md` is the canonical source of truth for:

- TypeScript rules
- module boundaries
- naming and file structure
- error handling
- security and secret handling
- testing expectations
- prohibited patterns

## Architecture Rule

This project uses a **thin provider adapter** architecture.

The extension is responsible for:

- registering a `9router` language model provider in VS Code
- exposing Copilot-facing display models
- storing secrets securely
- mapping display models to `9router` combo ids
- adapting host requests into the `9router` API format
- streaming responses back to the host
- exposing safe diagnostics and configuration behavior

`9router` is responsible for:

- routing logic
- combo definitions
- fallback policy
- quota-aware provider switching
- upstream model execution
- request-level operational behavior at the router tier

Do not move `9router` business logic into the extension.

## Product Model

The extension should expose curated product models in Copilot Chat, not raw upstream model ids.

Current product model:

- `Daily`
- `Agent`
- `Fallback`

These are presentation-layer models only. Each one maps to a `9router` combo id through local per-user VS Code settings.

## Configuration Rules

Use local per-user VS Code settings for:

- which display models appear in the picker
- labels and ordering if supported
- mapping from display models to `9router` combo ids
- non-secret runtime settings such as base URL, timeout, and debug mode

Use `SecretStorage` only for:

- `9router` API key

Never store secrets in:

- `settings.json`
- logs
- request dumps without explicit redaction

## Required Technical Boundaries

### Must do

- keep the extension streaming-first
- treat `9router` as the single routing backend
- use the OpenAI-compatible `/v1` contract unless the user explicitly changes direction
- keep capability exposure conservative
- isolate request conversion, tool adaptation, and vision proxy logic into focused modules
- degrade one broken model mapping without breaking the whole provider

### Must not do

- do not intercept or patch internal `github.copilot` traffic
- do not reimplement routing or fallback policy locally
- do not expose raw provider ids as the main product experience unless requested
- do not build a separate chat UI for the main flow
- do not assume every mapped combo supports tools or vision

## Request Flow

Target request path:

`Copilot Chat UI -> VS Code LanguageModelChatProvider -> extension adapter -> 9router /v1 API -> 9router combo routing -> upstream provider`

Implementation should preserve this shape. Avoid side paths that blur ownership.

## Tools and Vision

Treat both as compatibility layers.

### Tool calling

- convert host tool definitions into the request format expected by `9router`
- keep translation logic isolated and testable
- degrade safely if a combo should not expose tools

### Vision

- prefer native support only when confirmed
- otherwise use a vision proxy path
- make proxy behavior diagnosable because it affects latency and cost

## Error Handling

The extension should primarily handle:

- missing API key
- invalid local configuration
- invalid combo mapping
- network failure to `9router`
- timeout or cancellation
- malformed streaming responses

One failed model or request must not poison the entire provider state.

## Observability

Support explicit debug levels:

- `minimal`
- `metadata`
- `verbose`

Rules:

- default to safe logging
- redact secrets everywhere
- do not persist sensitive prompt content unless explicitly allowed by verbose debug behavior

## Testing Expectations

Prefer tests around the adapter boundaries:

- display model resolution
- combo mapping validation
- request conversion
- stream parsing
- error classification
- redaction

If changing tools or vision logic, add focused tests around those adapters rather than broad unrelated refactors.

## Change Discipline

When making changes:

1. Preserve the thin-adapter architecture.
2. Keep user-visible product models curated.
3. Keep `9router` as the source of truth for routing behavior.
4. Avoid scope creep into new UI or duplicated backend logic.
5. Update the design doc if a decision materially changes the architecture.

## Default Decision Heuristics

If multiple implementation options exist, prefer the one that:

- keeps the extension smaller
- keeps routing intelligence in `9router`
- preserves Copilot Chat UX
- minimizes secret exposure
- improves testability of adapter logic

If a change would violate any of those points, pause and revise the design before implementing.

## Verification Gate

Before claiming the extension is merge-ready, release-ready, or complete, run:

- `pnpm run build`
- `pnpm run lint`
- `pnpm run test:unit`
- `pnpm run test:integration`
- `pnpm run package`

Do not skip any of these commands when source code, configuration, transport, provider logic, or packaging behavior changes.
