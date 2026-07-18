# Reasoning Detail Streaming Design

## Document Status

- Status: Approved for implementation
- Date: 2026-07-18
- Scope: Native reasoning-detail rendering for primary chat responses
- Language: English

## Objective

Display reasoning deltas returned by `9router` in Copilot Chat's native,
collapsible thinking detail when the running VS Code host supports it. Keep the
visible answer, tool calls, cancellation, and streaming behavior independent
from reasoning presentation.

The extension remains a thin provider adapter. It forwards only reasoning that
already exists in the `9router` response and does not create, summarize, label,
or interpret model reasoning locally.

## Context

The current OpenAI-compatible stream parser handles visible text, tool-call
deltas, usage, completion, and router errors. It intentionally ignores
`choices[0].delta.reasoning_content`, so models can spend reasoning effort
without exposing any native reasoning detail in Copilot Chat.

Earlier thinking-mode and thinking-effort designs treated reasoning rendering
as a non-goal. This design supersedes only those hidden-reasoning statements.
Their request configuration, provider-compatibility, routing, and fallback
decisions remain unchanged.

VS Code's stable language-model response surface documents text, tool-call, and
data response parts. `LanguageModelThinkingPart` is a proposed API and can be
missing or change independently of the extension's declared stable engine
range. The feature therefore uses a narrow runtime compatibility boundary
instead of making the entire extension depend on the proposal.

## Decisions

- Prefer the canonical `choices[0].delta.reasoning_content` field while also
  accepting non-empty string values from `cot_summary`, `reasoning_text`,
  `reasoning`, and `thinking` at the SSE compatibility boundary. Use the first
  populated field in that precedence order and emit at most one reasoning
  event per choice delta.
- Normalize a non-empty string into a typed `reasoning-delta` router event.
- Accept both LF and CRLF SSE frame separators, including separators split
  across transport chunks.
- Emit reasoning before visible text and tool-call deltas from the same SSE
  frame, preserving the response's semantic order.
- Convert each primary-response reasoning delta immediately into a proposed
  `LanguageModelThinkingPart` when the running host exposes its constructor.
- Drop reasoning deltas when the constructor is unavailable. Never convert
  them to `LanguageModelTextPart` or merge them into the final answer.
- Keep display automatic. Add no setting for showing or hiding reasoning.
- Keep reasoning content out of diagnostics and persisted dumps. Record only
  safe aggregate metadata.
- Do not replay thinking parts into subsequent router requests.

No `enabledApiProposals` manifest entry is added. The compatibility helper
performs a runtime property lookup and confines the structural cast to one
module. This keeps packaging and older-host behavior aligned with the existing
stable extension contract.

## Stream Contract

The normalized router event union adds:

```ts
{ type: 'reasoning-delta'; text: string }
```

The stream path is:

```text
9router SSE reasoning string
  -> validate non-empty string
  -> RouterStreamEvent reasoning-delta
  -> runtime thinking-part compatibility boundary
  -> LanguageModelThinkingPart when supported
  -> safe drop when unsupported
```

Visible output continues through the existing `text-delta` path, and tool
calls continue through the existing accumulator. Reasoning is not buffered
until response completion and is never used as a substitute for visible text.

If one SSE frame contains both a recognized reasoning string and `content`, the
parser emits the reasoning event first and the text event second. Missing,
empty, or non-string reasoning candidates are ignored without failing an
otherwise valid frame. When multiple recognized aliases coexist, precedence is
`cot_summary`, `reasoning_text`, `reasoning_content`, `reasoning`, then
`thinking`; only one normalized event is emitted. This is response-shape
compatibility only and does not move provider reasoning policy into the
extension.

## VS Code Compatibility Boundary

`src/provider/reasoning-part-compat.ts` owns all knowledge of the proposed API.
It describes only the constructor and value shape needed by this feature:

- find `LanguageModelThinkingPart` on the runtime `vscode` module
- construct it from the streamed string when available
- return `undefined` when the constructor is absent
- identify real thinking-part instances when adapting prior host messages
- cast the constructed object to the stable response union only at this
  boundary

The stream adapter treats `undefined` as a supported degradation outcome. It
does not fail the request, buffer the reasoning for later, or expose it as
ordinary assistant text.

The exact presentation remains host-owned. Copilot Chat decides the collapsed
container, labels, animation, and grouping. The extension guarantees native
thinking parts when supported, not pixel-identical rendering or control of
labels such as `Analyzed` or `Optimized tool selection`.

## Automatic Display and Thinking Effort

There is no new configuration setting. Reasoning detail is displayed
automatically when both conditions are true:

1. the primary `9router` stream returns a non-empty recognized reasoning string
2. the running host exposes `LanguageModelThinkingPart`

The existing model `thinkingMode` default and Copilot Chat Thinking Effort
selection continue to control the request's `reasoning_effort` value. They do
not guarantee that a routed model will return reasoning deltas. Conversely, if
`9router` returns a reasoning delta, presentation does not depend on a second
local toggle.

Internal Vision proxy responses are not user-facing primary chat responses.
Any reasoning events from that stage remain unrendered and are not folded into
the generated Vision summary. Thinking parts already present in an
image-bearing history message are removed before that message is submitted to
the Vision proxy model.

## Conversation History

When Copilot Chat sends prior assistant content back to the provider, the
request adapter recognizes runtime thinking-part instances and omits them from
ordinary assistant text. The visible answer and supported tool-call history
continue to be adapted normally. If removing thinking parts leaves an ordinary
assistant turn with no visible content, the adapter omits that empty turn
instead of sending an empty router message. Non-image response data such as
usage metadata is also omitted and does not keep a thinking-only turn alive.

The extension does not serialize prior thinking into `content`, add a
`reasoning_content` field to `RouterMessage`, or reconstruct hidden reasoning.
Replaying reasoning to `9router` is explicitly out of scope until the router
defines a canonical request-history contract that requires it. Such a change
must remain provider-neutral and must not introduce upstream-specific fields
into the extension.

## Diagnostics and Privacy

After every started primary stream, including cancellation and failure, the
provider emits one safe `Reasoning stream diagnostic` event at the minimal
debug threshold with:

- curated display model id
- effective thinking mode
- terminal outcome: completed, cancelled, or failed
- received delta count
- received character count
- emitted delta count
- dropped delta count
- whether the host thinking-part constructor is available

The event never includes delta text, prompt text, the raw SSE frame, or a
serialized thinking part. Reasoning content must not be written at any debug
level, including `verbose`. Counts and support state are operational metadata,
not proof that the model's reasoning is complete or semantically valid. A zero
received count distinguishes an absent backend reasoning payload from a host
rendering failure; cancellation does not discard counts gathered before it.

## Error Handling and Degradation

- Missing host constructor: drop reasoning, continue text and tool streaming.
- Empty or non-string reasoning value: ignore only that value.
- Host supports thinking parts: emit each validated delta without waiting for
  completion.
- Mixed reasoning and visible text: keep both paths and preserve reasoning-first
  order within the frame.
- Malformed SSE JSON: keep the existing malformed-stream error behavior.
- Cancellation or transport failure: keep the existing request termination
  behavior and report safe partial aggregate counts; partial reasoning does not
  alter error classification.
- One request that cannot render reasoning does not affect future provider or
  picker state.

Reasoning rendering is an optional presentation capability, not a requirement
for a successful chat response.

## Testing Strategy

### Stream parsing

- parse reasoning-only frames
- parse the documented reasoning string aliases without duplicating a frame
- parse LF and CRLF frame boundaries, including split boundaries
- emit reasoning before sibling visible text
- ignore empty and non-string reasoning values
- preserve usage, tool calls, completion, errors, and buffered SSE behavior

### Compatibility and response adaptation

- construct a thinking part when the runtime exposes the proposed constructor
- return `undefined` when the runtime does not expose it
- emit native thinking parts without changing visible text or tool calls
- count received, emitted, dropped, and character totals accurately
- omit prior thinking parts from ordinary assistant history
- omit assistant history turns left empty after thinking parts are removed
- keep prior thinking and non-image response metadata out of Vision requests

### Integration and privacy

- stream reasoning and visible text through the provider in order
- continue the final answer when thinking parts are unavailable
- report metadata-only reasoning diagnostics for completed, cancelled, failed,
  and zero-reasoning streams
- assert reasoning text does not appear in diagnostics
- keep Vision proxy reasoning out of the user-facing response

Run the complete verification gate:

- `pnpm run build`
- `pnpm run lint`
- `pnpm run test:unit`
- `pnpm run test:integration`
- `pnpm run package`

## Non-Goals

- Adding a custom chat UI or controlling Copilot Chat's exact reasoning layout
- Generating headings, summaries, or explanations for reasoning deltas
- Exposing raw router state, combo decisions, or upstream fallback traces
- Adding a reasoning visibility setting
- Mapping arbitrary nested or provider-specific reasoning response objects
- Replaying reasoning history without a canonical `9router` contract change
- Making reasoning availability a published model capability guarantee
- Moving reasoning policy, routing, or fallback behavior into the extension

## References

- VS Code Language Model API:
  - https://code.visualstudio.com/api/extension-guides/language-model
- VS Code proposed thinking-part declaration:
  - https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
- Canonical production design:
  - `docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md`
- Thinking-mode configuration design:
  - `docs/superpowers/specs/2026-07-16-thinking-mode-configuration-design.md`
- Copilot Thinking Effort picker design:
  - `docs/superpowers/specs/2026-07-16-copilot-thinking-effort-picker-design.md`
