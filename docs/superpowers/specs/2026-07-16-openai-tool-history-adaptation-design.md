# OpenAI Tool History Adaptation Design

## Problem

VS Code represents tool history with structured content parts:

- An assistant message contains one or more `LanguageModelToolCallPart` values.
- A later user message contains one or more matching
  `LanguageModelToolResultPart` values.

The current request adapter recognizes tool-result parts but does not serialize
tool-call parts. It therefore sends OpenAI-compatible history containing a
`role: tool` message without a preceding assistant `tool_calls` entry. DeepSeek
rejects that history with HTTP 400.

## Decision

The adapter will preserve complete OpenAI-compatible tool history.

### Assistant tool calls

For an assistant message containing valid tool-call parts, emit one assistant
message with:

- `role: assistant`
- textual content when the host message also contains text, otherwise `null`
- one `tool_calls` entry per valid tool-call part
- each entry containing the original `callId`, tool name, and JSON-serialized
  input arguments

Invalid tool-call parts with empty ids or names will not become structured tool
calls. Their presence must not create invalid upstream history.

### Tool results

For a user message containing valid tool-result parts:

- emit one `role: tool` message per result
- copy the result's `callId` into `tool_call_id`
- serialize result content into text
- preserve the original result order

The adapter may therefore expand one host message into multiple router
messages.

### Orphan handling

A tool result is valid only when a preceding assistant tool call with the same
id exists in the request history.

If no match exists, degrade the result content to a normal user message rather
than emitting an invalid `role: tool` message. The adapter will not invent a
tool call or drop the content.

## Data Flow

Message adaptation will become history-aware:

1. Iterate host messages in order.
2. Convert assistant tool-call parts and record their call ids.
3. Convert matching tool-result parts into tool messages.
4. Convert orphaned or malformed tool results into user text.
5. Preserve existing text, native-vision, tool-definition, and model-mapping
   behavior.

## Router Contract

`RouterMessage` will support:

- nullable assistant content
- optional `tool_calls`
- existing `tool_call_id` for tool results

The tool-call shape will remain the OpenAI chat-completions function-call
format. No provider-specific DeepSeek fields will be added.

## Error Handling

- JSON serialization of ordinary tool input objects is deterministic through
  `JSON.stringify`.
- Invalid ids or names do not produce structured tool calls.
- An orphaned result remains visible to the model as user text.
- One malformed tool part does not invalidate unrelated messages.

## Testing

- Reproduce a complete assistant tool-call followed by its result.
- Assert the assistant message includes matching `tool_calls`.
- Assert the result includes the matching `tool_call_id`.
- Cover multiple tool calls/results and ordering.
- Cover an orphaned result degrading to user content.
- Keep existing plain-text role and valid tool-result regression tests.
- Run the full repository verification gate.

## Non-Goals

- Executing tools inside the extension
- Changing stream parsing or host tool invocation
- Provider-specific DeepSeek payload branches
- Adding local routing or fallback policy
