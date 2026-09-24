# Codex Config Export Design

## Document Status

- Status: Approved draft
- Date: 2026-09-21
- Scope: Export configured 9router models into Codex `config.toml` / profile artifacts and a `model_catalog_json` catalog
- Language: English

## Objective

Add a Command Palette action that turns the extension's validated `9router-copilot` model configuration into Codex-compatible files so users can run the same curated 9router models from Codex CLI without hand-editing TOML.

The feature preserves the thin-adapter architecture. The extension only maps local settings into Codex configuration shapes. `9router` remains the routing authority. Secrets stay out of exported files.

## Confirmed Decisions

- Export every publishable configured model through Codex `model_catalog_json`, not one model-only profile.
- Never write the API key into exported files. Provider auth uses `env_key = "NINE_ROUTER_API_KEY"` plus setup instructions.
- Support two destinations via Quick Pick: a user-chosen folder, or the resolved Codex home directory.
- When installing into Codex home and `config.toml` already exists, ask each time whether to create a profile file or merge into `config.toml`.
- Default Codex `model` is the first publishable configured model in settings array order.
- Duplicate `modelId` values keep the first entry and warn about later display models that were dropped from the catalog, because Codex catalog `slug` is also the opaque model id sent upstream.
- Implementation is a pure config adapter plus a thin runtime command. No new webview.

## Context

Codex user config lives under `CODEX_HOME` (default `~/.codex`). Custom providers are defined under `[model_providers.<id>]` with `base_url`, `env_key`, and `wire_api = "responses"`. Profile overlays live beside `config.toml` as `$CODEX_HOME/<name>.config.toml` and are selected with `codex --profile <name>`.

`model_catalog_json` points at a JSON file whose root is `{ "models": ModelInfo[] }`. Each model requires at least:

- `slug`
- `display_name`
- `supported_reasoning_levels`
- `shell_type`
- `visibility`
- `supported_in_api`
- `priority`
- `availability_nux`
- `upgrade`
- either legacy `base_instructions` or `model_messages.instructions_template`
- `support_verbosity`
- `default_verbosity`
- `apply_patch_tool_type`
- `truncation_policy`

This extension already stores an ordered `9router-copilot.models` array, validates it through `parseModelSettings`, and keeps the API key in `SecretStorage`. Runtime `baseUrl` is normalized by stripping a trailing `/v1`. Codex custom-provider examples expect a `/v1` base URL, so export must reattach `/v1` when writing Codex provider config.

Existing command patterns in `src/runtime/commands.ts` and thin runtime modules such as `test-connection.ts` are the template for this feature.

## Non-Goals

- Writing API keys, bearer tokens, or other secrets into any exported file
- Reimplementing Codex routing, sandbox, approval, MCP, hooks, or profile management
- Building a webview wizard or a second chat UI
- Auto-merging without an explicit user choice when `config.toml` already exists
- Supporting project-local `.codex/config.toml` as a write target for provider keys
- Guaranteeing lossless comment/formatting preservation across TOML merge round-trips
- Syncing Codex config continuously as VS Code settings change
- Exporting Vision proxy settings or other extension-only runtime knobs into Codex

## Architecture

A new command `9routerCopilot.exportCodexConfig` ("9router: Export Codex Config") is contributed in `package.json`, registered in `src/runtime/commands.ts`, and wired in `src/runtime/activate.ts`.

Two modules own the feature:

| Module | Responsibility |
| --- | --- |
| `src/config/codex-export.ts` | Pure adapter: select exportable models, dedupe by `modelId`, build catalog JSON, build profile TOML text, build Codex provider `base_url`, describe warnings |
| `src/runtime/export-codex-config.ts` | Runtime flow: destination Quick Pick, folder / `CODEX_HOME` resolution, profile-vs-merge choice, overwrite confirmation, filesystem writes, user-facing success/error messages |

`registerCommands` gains an optional `exportCodexConfig` dependency, matching `testConnection` / `showUsage`. Activation constructs the exporter with `getSettingsSnapshot` and lazy prompt loader `loadCodexInstructions: () => readDefaultCodexInstructions(context.extensionPath)`.

Codex instructions are loaded lazily only when executing the export command, after destination and overwrite confirmations. Any prompt loading failure (missing file, unreadable file, or blank content) fails only the export command with `CONFIGURATION_ERROR` without writing files, and never blocks extension activation or Copilot Chat provider operations.

No provider, router transport, webview, or secret-store changes are required.

## User Flow

```
Command Palette: 9router: Export Codex Config
  -> load SettingsSnapshot
  -> fail closed if runtime unusable or no publishable models
  -> Quick Pick destination:
       - Choose folder…
       - Install into Codex home
  -> if Codex home and config.toml exists:
       Quick Pick: Create profile / Merge into config.toml
  -> confirm overwrite for any existing target file
  -> load Codex instructions template (lazy; fails closed on read/empty error)
  -> write 9router-models.json
  -> write 9router.config.toml or merge into config.toml
  -> show success message with paths, env-key reminder, and launch hint
```

Cancel at any prompt exits without writes.

## Artifact Contract

### Files

Always written:

- `9router-models.json`

Also written depending on mode:

- Profile mode: `9router.config.toml`
- Merge mode: patch existing `config.toml`

### Catalog JSON

Root shape:

```json
{
  "models": [ /* ModelInfo objects */ ]
}
```

Per configured publishable model, after `modelId` dedupe:

| Field | Source / rule |
| --- | --- |
| `slug` | `ConfiguredModel.modelId` |
| `display_name` | `ConfiguredModel.name` |
| `description` | `"9router model exported from VS Code"` |
| `default_reasoning_level` | `thinkingMode` when not `off`; otherwise omit |
| `supported_reasoning_levels` | one `{ effort, description }` per `thinkingEfforts` entry; empty array when none |
| `shell_type` | `"unified_exec"` |
| `visibility` | `"list"` |
| `supported_in_api` | `true` |
| `priority` | 1-based order after dedupe |
| `additional_speed_tiers` | `["fast"]` when `serviceTier === "fast"`, else `[]` |
| `service_tiers` | `[{ "id": "priority", "name": "Fast", "description": "Faster tier" }]` when fast, else `[]` |
| `availability_nux` | `null` |
| `upgrade` | `null` |
| `model_messages.instructions_template` | contents of bundled `prompts/codex/default-codex-instructions.md` |
| `support_verbosity` | `false` |
| `default_verbosity` | `null` |
| `apply_patch_tool_type` | `null` |
| `truncation_policy` | `{ "mode": "tokens", "limit": 10000 }` |
| `context_window` | `maxInputTokens + maxOutputTokens` |
| `input_modalities` | `["text","image"]` when `visionMode !== "off"`, else `["text"]` |

Rejected / unpublished settings entries are not exported.

Duplicate `modelId` handling:

1. Keep the first publishable model for that `modelId`.
2. Skip later models with the same `modelId`.
3. Surface a warning listing skipped display model ids.

### Profile / provider TOML

```toml
model = "<first exported slug>"
model_provider = "9router"
model_catalog_json = "<absolute path to 9router-models.json>"

[model_providers.9router]
name = "9router"
base_url = "<codexBaseUrl>"
env_key = "NINE_ROUTER_API_KEY"
env_key_instructions = "Set NINE_ROUTER_API_KEY to your 9router API key."
wire_api = "responses"
```

`codexBaseUrl` is the runtime normalized base URL with a single trailing `/v1` appended. Example: settings `http://127.0.0.1:20128/v1` → normalized `http://127.0.0.1:20128` → Codex export `http://127.0.0.1:20128/v1`.

`model_catalog_json` must be an absolute filesystem path for the destination being written.

## Destination Rules

### Choose folder

1. `showOpenDialog` with folders only.
2. Write both `9router-models.json` and `9router.config.toml` into the selected folder.
3. Success message recommends `codex --profile 9router` after copying/moving the profile into `CODEX_HOME`, or using the folder contents manually.

The folder export still emits a profile-shaped `9router.config.toml`. It does not silently mutate an arbitrary destination `config.toml`.

### Install into Codex home

Resolve Codex home as:

1. `process.env.CODEX_HOME` when non-empty after trim
2. otherwise `<os.homedir()>/'.codex'`

Create the directory if missing.

Always write/overwrite `9router-models.json` there after overwrite confirmation when the file already exists.

If `config.toml` is absent:

- write `9router.config.toml` (profile mode)

If `config.toml` is present:

- ask: **Create profile** or **Merge into config.toml**

#### Create profile

Write/overwrite `$CODEX_HOME/9router.config.toml` after overwrite confirmation.
Success hint: `codex --profile 9router`.

#### Merge into config.toml

1. Warn that merge rewrites the TOML document and may not preserve comments/formatting.
2. Parse existing `config.toml`; fail closed with a clear configuration error if parsing fails.
3. Upsert `[model_providers.9router]` with the provider fields above.
4. Set/overwrite top-level `model_provider`, `model`, and `model_catalog_json`.
5. Leave all other keys untouched in the parsed object model.
6. Write the merged document back to `config.toml` after overwrite confirmation.

Merge never writes secrets.

## Validation and Errors

Fail closed before any write when:

- settings snapshot runtime is missing / unusable
- no publishable models remain after validation
- destination selection is cancelled
- profile/merge choice is cancelled
- overwrite is declined
- destination directory cannot be created
- a target file cannot be written
- merge parse fails

Continue with warnings when:

- duplicate `modelId` entries caused catalog skips
- merge will rewrite TOML formatting/comments

User-facing errors use concise messages. Deep detail stays out of notifications. No API key values appear in messages, logs, or artifacts.

## Security

- Do not call `getApiKey` for this feature.
- Do not embed tokens in TOML, JSON, diagnostics, or clipboard helpers.
- Exported files intentionally contain only non-secret connection metadata and model catalog fields.

## Testing

### Unit

- catalog generation for reasoning, vision, and fast-tier mappings
- `/v1` reattachment for Codex `base_url`
- first-model default selection
- duplicate `modelId` keep-first + warning payload
- empty / invalid snapshot rejection
- TOML profile rendering with absolute catalog path
- merge upsert of provider table and top-level keys while preserving unrelated keys
- merge parse failure classification

### Command / integration

- command registration
- cancel destination writes nothing
- folder destination writes both files
- Codex-home profile path writes `9router.config.toml` + catalog
- Codex-home merge path patches `config.toml` and writes catalog
- empty publishable models surfaces an error

## Documentation Updates

- README Everyday Commands: add `9router: Export Codex Config`
- Brief note that Codex needs `NINE_ROUTER_API_KEY` in the environment and uses `codex --profile 9router` for the profile path

## Open Questions

None. All product decisions for this scope are confirmed above.

## Approval Gate

This design is ready for an implementation plan after review. Implementation must not start until the written plan is approved and an execution method is chosen.
