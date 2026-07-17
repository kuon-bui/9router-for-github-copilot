# Shared 9router Vision Proxy Design

## Document Status

- Status: Approved draft
- Date: 2026-07-17
- Scope: Production Vision support for the VS Code provider adapter
- Language: English

## Objective

Replace the current placeholder Vision proxy with a production two-stage flow. A
single user-configured 9router combo analyzes image attachments, and the selected
`Daily`, `Agent`, or `Fallback` combo receives the resulting textual context.

The feature must preserve the thin-adapter architecture. The extension adapts
image inputs and coordinates two requests, while 9router remains responsible for
combo definitions, routing, fallback, provider compatibility, and upstream
execution.

## Confirmed Decisions

- Use a dedicated 9router combo for Vision analysis instead of a host Copilot
  model.
- Use one shared Vision combo for all curated display models.
- Configure that combo through
  `9router-copilot.visionProxyComboId`.
- Fail closed when Vision analysis cannot complete. Never send the primary
  request without the image context the user supplied.
- Keep `native`, `proxy`, and `off` as the three per-model Vision modes.
- Reuse the existing 9router API key, base URL, request timeout, router client,
  SSE parser, and cancellation path.
- Do not send tools, tool choice, or Thinking Effort to the Vision combo.
- Never log image bytes, data URLs, original prompt text, or generated Vision
  summaries.

## Context and Current Gap

The existing provider already detects non-text input, exposes a `visionMode`
setting, supports a native pass-through branch, and records a Vision outcome.
However, the default proxy summarizer returns only a placeholder message.

The current native branch also preserves unknown attachment objects without
converting real VS Code `LanguageModelDataPart` instances. VS Code represents an
image attachment with `data: Uint8Array` and `mimeType`. The 9router request must
receive an OpenAI-compatible image content part instead of a serialized
`Uint8Array` object.

Current 9router documentation confirms that combo ids are supplied unchanged in
the OpenAI-compatible `model` field and that chat completions stream through
SSE. It does not explicitly guarantee an image payload contract. This design
therefore uses the standard `image_url` data-URL content shape and requires a
live compatibility check with the configured Vision combo in addition to mocked
automated coverage.

## Non-Goals

- Discovering or creating Vision combos remotely
- Selecting upstream Vision providers inside the extension
- Adding a fourth curated display model
- Falling back to a host Copilot model
- Continuing without image context after a Vision failure
- Persisting image or summary content for diagnostics
- Adding OCR, image resizing, transcoding, caching, or local image processing
- Adding per-display-model Vision proxy mappings

## Architecture

Introduce a focused Vision proxy service between provider request validation and
the primary request adapter.

```text
Copilot Chat request
    -> resolve selected display model
    -> classify image attachments
       -> native: normalize images and send to selected combo
       -> off: reject image request
       -> proxy:
          -> VisionProxyService
          -> 9router /v1/chat/completions
             model = visionProxyComboId
          -> collect textual description
          -> replace images with textual Vision context
          -> send transformed request to selected combo
```

The provider remains the request orchestrator. Image classification and
serialization live in a dedicated adapter, while the secondary 9router call and
summary collection live in `VisionProxyService`. `RouterClient` remains the only
HTTP/SSE boundary.

## Components and Boundaries

### Image input adapter

The image adapter owns structural recognition and OpenAI-compatible
serialization.

It recognizes an image only when an object has:

- `mimeType` as a string beginning with `image/`
- `data` as a `Uint8Array`

It converts a recognized image to:

```json
{
  "type": "image_url",
  "image_url": {
    "url": "data:<mimeType>;base64,<encoded bytes>"
  }
}
```

Tool calls, tool results, text parts, and unknown non-image parts are not
classified as images. The same adapter is used by both the proxy request and the
existing native Vision path.

The adapter does not maintain its own MIME allowlist or resize images. Explicit
`visionMode` and the configured 9router combo are the capability declaration;
9router and its selected upstream provider remain responsible for rejecting
unsupported image formats or sizes.

### Vision proxy service

`VisionProxyService` receives:

- the original host messages
- the shared Vision combo id
- runtime `baseUrl`, API key, `maxTokens`, and `requestTimeoutMs`
- the request-scoped abort signal

For every message containing one or more recognized images, the service makes
one Vision request. Multiple images in the same message are batched into that
request. Messages containing images are processed sequentially in conversation
order to keep load predictable and preserve deterministic failure behavior.

Each Vision request contains:

- a fixed instruction to describe the supplied images faithfully, including
  visible text, code, tables, diagrams, layout, and uncertainty
- the text parts from the same source message as local context
- the normalized image content parts
- `model` set to the exact shared Vision combo id
- `stream: true`
- the existing runtime `max_tokens` value when configured

It does not contain tools, `tool_choice`, or `reasoning_effort`.

The service collects normal text deltas internally. It never forwards Vision
response parts to Copilot Chat. A successful summary is trimmed and must be
non-empty.

### Message transformation

After one message has been analyzed, its recognized image parts are removed.
All original non-image parts remain in their original order. One internal text
part is appended to that same message:

```text
[Vision proxy summary]
<generated description>
```

This keeps the description associated with the message that supplied the images
without requiring a fragile structured-output contract from the Vision model.
The main request adapter then handles the transformed message through its normal
text and tool-history paths.

No primary request is created until every image-bearing message has a non-empty
summary.

### Provider orchestration

The provider creates one request-scoped abort signal before starting Vision
preparation and cleans it up only after the complete Vision-plus-primary flow.

The provider selects behavior as follows:

- no recognized image: preserve the existing text/tool flow
- `visionMode: native`: normalize real VS Code image data and send it to the
  selected combo
- `visionMode: off`: return the existing actionable configuration error
- `visionMode: proxy`: require the shared combo, call `VisionProxyService`, then
  submit the transformed primary request

## Configuration and Publication

Add one user setting:

```text
9router-copilot.visionProxyComboId
```

The value is a non-secret string, trimmed during settings loading. Its manifest
default is empty. The extension does not guess, create, or remotely discover the
combo id.

An empty shared combo is a non-fatal settings issue when at least one enabled
display model uses `visionMode: proxy`:

- the display model remains published for text requests
- diagnostics report a missing Vision proxy combo
- the model does not advertise `imageInput: true`
- an image request that still reaches the provider fails with an actionable
  `CONFIGURATION_ERROR`

Published image capability is conservative:

- `native`: advertise image input
- `proxy` with a non-empty shared combo: advertise image input
- `proxy` without a shared combo: do not advertise image input
- `off`: do not advertise image input

Changing `visionProxyComboId` follows the existing settings refresh path and
republishes model information without requiring a reload where the host supports
refresh.

## Cancellation and Timeout Semantics

The same abort signal covers every secondary Vision request and the primary
request. Cancellation during Vision analysis aborts the active router stream,
prevents remaining Vision calls, and prevents the primary call.

`requestTimeoutMs` continues to describe one HTTP request sent to 9router. It is
applied independently to each Vision request and to the primary request. With
multiple image-bearing messages, total wall-clock time can therefore exceed one
timeout interval. This behavior avoids silently changing the existing router
client contract.

Before beginning each secondary request and before beginning the primary
request, orchestration checks for cancellation.

## Error Handling

Vision analysis is fail-closed.

- Missing `visionProxyComboId`: return `CONFIGURATION_ERROR` naming the exact
  setting.
- Explicit missing-combo response from the Vision request: map to
  `CONFIGURATION_ERROR` naming `visionProxyComboId`, not the selected display
  model's primary mapping.
- Authentication error: preserve `AUTHENTICATION_ERROR`.
- Cancellation: preserve `CANCELLATION_ERROR`.
- Timeout: preserve `TIMEOUT_ERROR`.
- Transport or upstream failure: preserve the existing error code and add safe
  phase metadata.
- Empty or malformed Vision stream: return `MALFORMED_STREAM_ERROR` with an
  actionable Vision-analysis message.

Errors originating in the Vision stage include `phase: vision-proxy` in their
safe details. Existing request ids are preserved. Details must not contain the
Vision request body, image data, source text, or generated summary.

If any Vision request fails, the service stops immediately and the primary combo
is never called.

## Observability and Security

Settings diagnostics report a `visionProxyConfigured` boolean and never print
the combo value. Request diagnostics may report, according to the selected debug
level:

- selected display model
- Vision outcome
- number of image-bearing messages
- total recognized image count
- duration
- safe request id
- failure phase and error code

The following are forbidden at every debug level, including `verbose`:

- image bytes
- base64 strings or data URLs
- original message or prompt text
- generated Vision summaries
- authorization headers or API keys

The Vision request uses the existing API key from `SecretStorage`. No new secret
or credential setting is introduced.

## Testing Strategy

### Unit tests

- recognize real `LanguageModelDataPart`-shaped image objects
- reject malformed images and avoid misclassifying tool/data parts
- convert image bytes and MIME types to the exact data-URL `image_url` shape
- preserve text and non-image parts
- batch multiple images from one message into one Vision request
- process multiple image-bearing messages in order
- append each summary to its source message
- reject empty Vision output
- map a missing Vision combo without blaming the primary model mapping
- advertise image input only under the configuration rules above
- preserve the native Vision path with normalized image payloads

### Integration tests

- successful mocked SSE Vision request followed by the primary request
- exact shared combo id in the Vision `model` field
- no tools, tool choice, or Thinking Effort in the Vision request
- tools and Thinking Effort remain present where appropriate in the primary
  request
- missing shared combo prevents all router calls
- Vision 404, authentication failure, upstream failure, malformed stream, and
  timeout prevent the primary call
- cancellation during Vision streaming prevents the primary call
- diagnostics and errors do not expose image or summary content
- settings changes refresh published image capability

### Compatibility check

Because current 9router documentation does not explicitly specify image input,
perform a manual request through the packaged extension or an equivalent live
adapter request using a real configured Vision combo. Confirm at least PNG and
JPEG inputs for the chosen combo. A combo-specific failure is actionable
configuration or backend compatibility information; the extension must not add
local provider fallback logic in response.

### Verification gate

After implementation, run:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

## Expected File-Level Impact

Expected additions and changes include:

- add the focused image input adapter
  `src/provider/image-input-adapter.ts`
- replace the placeholder implementation in `src/provider/vision-proxy.ts` with
  `VisionProxyService`
- update provider orchestration and cancellation lifetime
- extend runtime settings and snapshot diagnostics
- update model capability publication
- add router request fixtures for normalized image content
- add focused unit and integration coverage
- update README and the canonical production design to describe the shared
  9router Vision combo

## Acceptance Criteria

- A configured proxy-mode model accepts actual VS Code image attachments.
- The shared 9router Vision combo receives normalized OpenAI-compatible image
  content and returns a textual description.
- The selected primary combo receives the original non-image context plus the
  summary, and receives no raw image in proxy mode.
- Native Vision receives normalized image content without using the proxy combo.
- Missing configuration or any Vision-stage failure prevents the primary call
  and returns an actionable error.
- Cancellation stops the full two-stage flow.
- Text-only, tool, Thinking Effort, streaming, and per-model degradation behavior
  remain unchanged.
- No sensitive Vision content appears in logs or diagnostics.
- All required verification commands pass.
