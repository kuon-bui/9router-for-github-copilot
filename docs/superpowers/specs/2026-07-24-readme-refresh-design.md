# README Refresh Design

**Date:** 2026-07-24

## Goal

Rewrite the repository README for end users, using the product-first presentation of `Vizards/deepseek-v4-for-copilot` as structural inspiration without copying its wording. Keep the main README short and move detailed reference material into focused documentation.

## Audience and Language

- Primary audience: extension users.
- Language: English.
- Contributor details remain available but do not dominate the main README.

## Main README Structure

`README.md` will contain:

1. Product name and a concise value proposition.
2. **Why this extension?** covering native Copilot Chat integration, curated `9router` models, tools, vision proxy, Thinking Effort, and secure API-key storage.
3. **Getting Started** covering prerequisites, local VSIX installation, API-key setup, minimum model configuration, and model selection.
4. A short feature summary.
5. Links to detailed configuration, troubleshooting, development, architecture, and license information.

The README will use only verified repository facts. Package version will be updated from `0.1.0` to `0.3.0`, and examples will use current user-facing defaults from `package.json`.

## Supporting Documentation

Create `docs/configuration.md` containing detailed material moved from the current README:

- complete settings example
- model field reference
- tool behavior
- vision proxy behavior and failure handling
- Thinking Effort behavior
- debug modes and diagnostics
- common fixes
- development verification commands
- thin-adapter architecture boundary

`README.md` will link to this document instead of duplicating those details.

## Images and Badges

Do not add placeholder images, invented Marketplace links, or badges without a real data source. Screenshots may be added later under a dedicated asset directory after real Extension Development Host captures exist.

## Security and Architecture

Preserve these user-visible guarantees:

- API keys live only in VS Code `SecretStorage`.
- Sensitive values must not appear in settings, logs, examples, or documentation.
- The extension remains a thin adapter; `9router` owns routing, fallback, quota policy, and upstream execution.
- Vision proxy failures remain fail-closed.

## Validation

Documentation-only checks:

- confirm every command, setting name, enum value, default, package version, and file link against repository sources
- scan for stale `0.1.0` and `127.0.0.1:3456` user-facing examples
- run Markdown link/path checks available locally, if any
- inspect the final diff for copied wording, placeholders, contradictions, and accidental removal of security guidance

No source tests are required unless implementation files change.
