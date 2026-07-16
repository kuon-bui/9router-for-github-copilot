# TypeScript Node16 Module Resolution Design

## Problem

The project currently configures:

```json
{
  "module": "commonjs",
  "moduleResolution": "node"
}
```

TypeScript normalizes `moduleResolution: "node"` to the legacy `node10`
strategy. TypeScript 6 reports this strategy as deprecated, and TypeScript 7
will stop supporting it.

VS Code can show the TypeScript 6 diagnostic even though the repository's
current TypeScript 5.6 compiler still builds successfully.

The diagnostic may also remain attached to an editor tab under
`.worktrees/copilot-thinking-effort-picker`. That worktree has already been
merged and removed, so the stale tab is not part of the current project.

## Decision

Change the TypeScript module pair to:

```json
{
  "module": "Node16",
  "moduleResolution": "Node16"
}
```

`module` and `moduleResolution` are changed together because TypeScript's
Node16 resolution mode requires the matching Node16 module mode.

The package does not declare `"type": "module"`, so TypeScript continues to
emit CommonJS JavaScript for the extension's `.ts` source files. The VS Code
extension entry point remains `dist/src/extension.js`.

## Rejected Alternatives

### Suppress the diagnostic

Adding `"ignoreDeprecations": "6.0"` would hide the warning without removing
the dependency on the obsolete Node10 resolver. It would only postpone the
migration until TypeScript 7.

### Use NodeNext

NodeNext tracks the latest Node module behavior and may change across future
TypeScript releases. The extension does not need that moving compatibility
target; Node16 provides the required modern package resolution with more
stable semantics.

### Use Bundler

The extension is compiled directly by TypeScript and executed by VS Code's
Node-based extension host. Bundler resolution is intended for builds whose
bundler resolves imports and is not the best representation of this runtime.

## Scope

Only `tsconfig.json` changes. No source imports, package module type, extension
entry point, runtime behavior, or packaging structure changes.

The stale `.worktrees/copilot-thinking-effort-picker` editor tab should be
closed manually. It is not recreated.

## Verification

Run:

- the repository build with the installed TypeScript version
- a TypeScript 6 compilation to verify the deprecation is removed
- lint
- unit tests
- integration tests
- VSIX packaging

Inspect the compiled extension entry point to confirm it still uses CommonJS
output and remains loadable through the existing `package.json` `main` field.
