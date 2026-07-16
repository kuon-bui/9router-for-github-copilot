# Tool Message Role Adaptation Design

## Problem

VS Code language-model chat messages officially use numeric roles `1` (user)
and `2` (assistant). Tool results are represented by
`LanguageModelToolResultPart` inside a user message, not by a separate numeric
tool role.

The request adapter currently treats numeric role `3` as an OpenAI `tool`
message. Copilot can send internal plain-text messages with that role. The
adapter then emits:

```json
{
  "role": "tool",
  "content": "..."
}
```

This is invalid because OpenAI-compatible tool messages require
`tool_call_id`. DeepSeek rejects the request with HTTP 400.

## Decision

Tool-message classification will be content-driven:

- A message becomes an OpenAI `tool` message only when its content contains a
  valid tool-result part with a non-empty `callId`.
- A tool-result message includes that `callId` as `tool_call_id`.
- Official VS Code user and assistant roles retain their current mapping.
- Unknown numeric roles, including `3`, degrade to `user` when they do not
  contain a valid tool result.

The adapter will not discard internal prompt messages, invent tool call ids, or
depend on undocumented host role values.

## Data Flow

1. Inspect message content for a valid tool-result part.
2. If found, emit an OpenAI `tool` message with `tool_call_id`.
3. Otherwise map only documented VS Code roles.
4. Treat every unrecognized role as `user`.

This keeps real tool-call history compatible while preserving plain-text host
context.

## Error Handling

A malformed tool-result-like part with an empty `callId` will not be promoted
to a tool message. It follows normal text extraction and role fallback, avoiding
an invalid upstream payload.

## Testing

- Add a regression test using numeric role `3` with plain text and assert it
  becomes `role: user` without `tool_call_id`.
- Keep the existing valid `LanguageModelToolResultPart` test and confirm it
  still emits `role: tool` with the matching `tool_call_id`.
- Run the complete repository verification gate after implementation.

## Non-Goals

- Changing combo routing
- Disabling tool support
- Dropping Copilot internal context messages
- Adding provider-specific DeepSeek behavior
