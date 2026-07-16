# OpenAI Tool History Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve complete OpenAI-compatible assistant tool calls and matching tool results so DeepSeek accepts Copilot Agent history.

**Architecture:** Extend the normalized router contract with OpenAI function tool calls. Make request conversion iterate through history in order, record valid assistant call ids, expand matching result parts into tool messages, and degrade orphaned results into user text.

**Tech Stack:** TypeScript, VS Code Language Model API, OpenAI-compatible chat completions, Vitest, pnpm

## Global Constraints

- Preserve the thin provider adapter architecture.
- Keep tool conversion inside `src/provider`.
- Do not add provider-specific DeepSeek behavior.
- Do not execute tools or invent call ids.
- Preserve message order and tool call/result ordering.
- Preserve unrelated uncommitted workspace changes.
- Follow TDD and observe failures before production edits.

---

### Task 1: Specify Complete Tool History in Tests

**Files:**
- Modify: `test/unit/provider/request-adapter.test.ts`

**Interfaces:**
- Consumes: `adaptMessagesToRouterRequest(input)`
- Produces: Expected OpenAI tool-history payloads

- [ ] **Step 1: Replace the standalone result test with a complete pair**

Use an assistant tool call followed by its user result:

```ts
it('preserves matching assistant tool calls and tool results', () => {
  const request = adaptMessagesToRouterRequest({
    selectedModel: {
      key: 'agent',
      label: 'Agent',
      comboId: '123',
      enabled: true,
      toolMode: 'auto',
      visionMode: 'off'
    },
    messages: [
      {
        role: 2,
        content: [
          new vscode.LanguageModelToolCallPart('call-1', 'lookupUser', {
            id: '42'
          })
        ]
      },
      {
        role: 1,
        content: [
          new vscode.LanguageModelToolResultPart('call-1', [
            new vscode.LanguageModelTextPart('result text')
          ])
        ]
      }
    ]
  });

  expect(request.messages).toEqual([
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'lookupUser',
            arguments: '{"id":"42"}'
          }
        }
      ]
    },
    {
      role: 'tool',
      content: 'result text',
      tool_call_id: 'call-1'
    }
  ]);
});
```

- [ ] **Step 2: Add multiple-call ordering coverage**

Add one assistant message with `call-1` and `call-2`, followed by one user
message containing the matching results in that order. Assert one assistant
message and two ordered tool messages.

- [ ] **Step 3: Strengthen orphan-result coverage**

Change the empty-call-id test into an explicit orphan test with a non-empty
unknown id:

```ts
it('degrades orphaned tool results to user content', () => {
  const request = adaptMessagesToRouterRequest({
    selectedModel: {
      key: 'agent',
      label: 'Agent',
      comboId: '123',
      enabled: true,
      toolMode: 'auto',
      visionMode: 'off'
    },
    messages: [
      {
        role: 1,
        content: [
          new vscode.LanguageModelToolResultPart('missing-call', [
            new vscode.LanguageModelTextPart('orphaned result')
          ])
        ]
      }
    ]
  });

  expect(request.messages).toEqual([
    {
      role: 'user',
      content: 'orphaned result'
    }
  ]);
});
```

- [ ] **Step 4: Run targeted tests and verify RED**

Run:

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts
```

Expected: FAIL because assistant messages lack `tool_calls`, content is not
nullable, one host result message cannot expand into multiple router messages,
and orphaned results currently emit `role: tool`.

### Task 2: Extend the Router Tool-Call Contract

**Files:**
- Modify: `src/types/router-contract.ts`

**Interfaces:**
- Produces: `RouterToolCall`, nullable `RouterMessage.content`, and optional `RouterMessage.tool_calls`

- [ ] **Step 1: Add the normalized function-call type**

Add:

```ts
export interface RouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}
```

- [ ] **Step 2: Extend `RouterMessage`**

Change the interface to:

```ts
export interface RouterMessage {
  role: RouterRole;
  content: RouterMessageContent | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: RouterToolCall[];
}
```

### Task 3: Implement History-Aware Request Adaptation

**Files:**
- Modify: `src/provider/request-adapter.ts`

**Interfaces:**
- Consumes: ordered `HostChatRequestMessage[]`
- Produces: ordered and structurally valid `RouterMessage[]`

- [ ] **Step 1: Define tool-call and tool-result boundary shapes**

Add narrow internal interfaces:

```ts
interface ToolCallLike {
  callId: string;
  name: string;
  input: object;
}

interface ToolResultLike {
  callId: string;
  content: readonly unknown[];
}
```

- [ ] **Step 2: Extract valid assistant tool calls**

Create a helper that accepts only parts with non-empty string `callId`,
non-empty string `name`, and object `input`. Serialize `input` with
`JSON.stringify`; exclude a part if serialization throws or returns
`undefined`.

Return OpenAI-shaped `RouterToolCall` values without provider-specific fields.

- [ ] **Step 3: Extract all valid tool results**

Replace the first-result lookup with a collection helper. Accept non-empty
`callId` and array `content`, preserving input order.

- [ ] **Step 4: Ignore structured tool parts during text extraction**

When extracting ordinary text from array content, skip tool-call and
tool-result-shaped parts instead of emitting
`[Unsupported input part omitted]`. Continue preserving strings and `.value`
text parts.

- [ ] **Step 5: Adapt ordered history**

Replace the one-to-one message mapping with:

```ts
const activeToolCallIds = new Set<string>();
const messages: RouterMessage[] = [];

for (const message of input.messages) {
  const toolCalls = extractRouterToolCalls(message.content);
  if (toolCalls.length > 0) {
    messages.push({
      role: 'assistant',
      content: extractTextContent(message.content).trim() || null,
      tool_calls: toolCalls
    });
    for (const toolCall of toolCalls) {
      activeToolCallIds.add(toolCall.id);
    }
    continue;
  }

  const toolResults = findToolResultParts(message.content);
  if (toolResults.length > 0) {
    for (const toolResult of toolResults) {
      const content = extractToolResultText(toolResult);
      if (activeToolCallIds.delete(toolResult.callId)) {
        messages.push({
          role: 'tool',
          content,
          tool_call_id: toolResult.callId
        });
      } else {
        messages.push({
          role: 'user',
          content
        });
      }
    }

    const ordinaryText = extractTextContent(message.content).trim();
    if (ordinaryText) {
      messages.push({
        role: 'user',
        content: ordinaryText
      });
    }
    continue;
  }

  activeToolCallIds.clear();
  messages.push(adaptOrdinaryMessage(message, input.selectedModel));
}
```

Keep `name`, native vision, max tokens, tool definitions, and tool choice
behavior unchanged for ordinary messages. Matching tool results are emitted
before top-level user text so the OpenAI tool-response sequence remains valid.
An ordinary intervening message clears pending call ids, making later results
orphans instead of linking them across an invalid sequence.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run:

```bash
pnpm exec vitest run test/unit/provider/request-adapter.test.ts
```

Expected: all request-adapter tests pass.

### Task 4: Verify Provider Boundaries and Package

**Files:**
- Verify all source, test, configuration, and packaging changes

**Interfaces:**
- Consumes: completed tool-history adapter
- Produces: fresh verification evidence and updated VSIX

- [ ] **Step 1: Run focused provider/router tests**

Run:

```bash
pnpm exec vitest run test/unit/provider test/unit/router test/integration/extension/text-stream-roundtrip.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Check the worktree**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; unrelated user changes remain preserved.

- [ ] **Step 3: Run the full repository verification gate**

Run each command separately:

```bash
pnpm run build
pnpm run lint
pnpm run test:unit
pnpm run test:integration
pnpm run package
```

Expected: every command exits with status 0.

- [ ] **Step 4: Inspect the built adapter**

Run:

```bash
rg -n "tool_calls|tool_call_id|activeToolCallIds" src/provider/request-adapter.ts dist/src/provider/request-adapter.js
```

Expected: both source and compiled output contain complete tool-history logic.
