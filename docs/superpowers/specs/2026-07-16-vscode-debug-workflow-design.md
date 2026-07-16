# VS Code Debug Workflow Design

## Goal

Add first-class VS Code debugging support for this extension repository so local development is faster and more repeatable.

The workflow should let a developer:

- press `F5` and start an `Extension Development Host`
- attach the debugger to the extension automatically
- choose between a watch-based debug loop and a build-once debug run
- run common project tasks from VS Code without memorizing shell commands

This change is a developer-experience improvement only. It must not change runtime extension behavior, routing behavior, or packaging behavior.

## Constraints

- Follow the thin-adapter architecture already defined for the extension.
- Keep the change limited to workspace tooling and documentation.
- Preserve the existing release guardrails and packaging boundaries.
- Avoid introducing debug-only behavior into production source paths.

## Proposed Approach

Use workspace-local VS Code configuration files:

- `.vscode/launch.json`
- `.vscode/tasks.json`

Update `README.md` with a short “Debug in VS Code” section describing how to use those configurations.

## Debug Configurations

### Default `F5`: Watch And Debug Extension

This will be the default launch configuration.

Behavior:

- start a background TypeScript watch task
- launch an `Extension Development Host`
- attach the debugger to the extension host process

Why this is the default:

- best fit for active extension development
- code edits rebuild automatically
- matches the user’s preferred workflow

### Secondary Config: Build Once And Debug Extension

This configuration is for cleaner one-shot runs.

Behavior:

- run a normal build task once
- launch an `Extension Development Host`
- attach the debugger to the extension host process

Why this exists:

- useful when watch mode noise is undesirable
- useful for verifying a clean startup from a fresh build

## Task Definitions

`tasks.json` will expose small, explicit tasks:

- `build`: runs `pnpm run build`
- `watch`: runs the TypeScript compiler in watch mode via `pnpm exec tsc -p tsconfig.json --watch`
- `test:unit`: runs `pnpm run test:unit`
- `test:integration`: runs `pnpm run test:integration`
- `package`: runs `pnpm run package`

The `watch` task will be marked as a background task so VS Code can use it as a `preLaunchTask`.

## README Changes

Add a short section that explains:

- use `F5` for the default watch-and-debug flow
- choose the build-once configuration from the Run and Debug panel when needed
- use the provided VS Code tasks for build, test, and package commands
- inspect the `9router Copilot` output channel for extension diagnostics

The README update should stay short and practical.

## Testing And Guardrails

Add a lightweight integration test that confirms:

- `.vscode/launch.json` exists
- `.vscode/tasks.json` exists
- the launch configuration includes both debug flows

This protects the intended developer workflow from accidental removal.

No production runtime tests are required because the change is limited to repository tooling and documentation.

## Risks

### Watch Task Mismatch

If the watch task shape does not match VS Code’s background-task expectations, `F5` can hang waiting for readiness.

Mitigation:

- use a standard background matcher for TypeScript watch output
- verify the default debug configuration starts successfully

### Overly Broad Workspace Tasks

Too many tasks can make the VS Code task picker noisy.

Mitigation:

- only include the small set of tasks that map to existing package scripts

## Out Of Scope

- changing extension runtime logic
- adding new commands to the extension itself
- adding debug-only settings to extension configuration
- changing release packaging rules beyond ensuring `.vscode` remains a repo-level developer aid
