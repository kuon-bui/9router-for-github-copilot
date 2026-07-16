# VS Code Debug Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class VS Code debug workflow for this extension with default watch-and-debug `F5`, a build-once alternative, supporting tasks, and concise developer documentation.

**Architecture:** Keep the change entirely in repository-local developer tooling. Add `.vscode/launch.json` and `.vscode/tasks.json`, protect them with a lightweight integration guardrail, and document the workflow in `README.md` without changing runtime extension behavior.

**Tech Stack:** VS Code workspace configuration (`launch.json`, `tasks.json`), TypeScript compiler watch mode, `pnpm` scripts, Vitest integration tests, Markdown documentation.

## Global Constraints

- Follow the thin-adapter architecture already defined for the extension.
- Keep the change limited to workspace tooling and documentation.
- Preserve the existing release guardrails and packaging boundaries.
- Avoid introducing debug-only behavior into production source paths.
- The workflow must support both watch-based debugging and build-once debugging.
- The default `F5` path must launch an `Extension Development Host` and attach the debugger automatically.

---

### Task 1: Add Guardrail Coverage For VS Code Debug Assets

**Files:**
- Modify: `test/integration/extension/release-guardrails.test.ts`
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`

**Interfaces:**
- Consumes: existing Vitest integration test structure and `node:fs/promises` reads from repository-relative paths
- Produces: a guardrail test that asserts `.vscode/launch.json` and `.vscode/tasks.json` exist and that `launch.json` contains both named debug flows

- [ ] **Step 1: Write the failing test**

```ts
it('keeps VS Code debug workspace assets available for local extension development', async () => {
  const launchPath = resolve(process.cwd(), '.vscode/launch.json');
  const tasksPath = resolve(process.cwd(), '.vscode/tasks.json');

  await expect(access(launchPath, constants.R_OK)).resolves.toBeUndefined();
  await expect(access(tasksPath, constants.R_OK)).resolves.toBeUndefined();

  const launchJson = JSON.parse(await readFile(launchPath, 'utf8')) as {
    configurations?: Array<{ name?: string }>;
  };

  expect(launchJson.configurations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'Watch and Debug Extension'
      }),
      expect.objectContaining({
        name: 'Build Once and Debug Extension'
      })
    ])
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test:integration -- test/integration/extension/release-guardrails.test.ts`
Expected: FAIL because `.vscode/launch.json` and `.vscode/tasks.json` do not exist yet

- [ ] **Step 3: Add the test to `test/integration/extension/release-guardrails.test.ts`**

```ts
it('keeps VS Code debug workspace assets available for local extension development', async () => {
  const launchPath = resolve(process.cwd(), '.vscode/launch.json');
  const tasksPath = resolve(process.cwd(), '.vscode/tasks.json');

  await expect(access(launchPath, constants.R_OK)).resolves.toBeUndefined();
  await expect(access(tasksPath, constants.R_OK)).resolves.toBeUndefined();

  const launchJson = JSON.parse(await readFile(launchPath, 'utf8')) as {
    configurations?: Array<{ name?: string }>;
  };

  expect(launchJson.configurations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'Watch and Debug Extension'
      }),
      expect.objectContaining({
        name: 'Build Once and Debug Extension'
      })
    ])
  );
});
```

- [ ] **Step 4: Run test to verify the new assertion still fails for the intended reason**

Run: `pnpm run test:integration -- test/integration/extension/release-guardrails.test.ts`
Expected: FAIL with file access errors or missing debug configuration names

- [ ] **Step 5: Commit**

```bash
git add test/integration/extension/release-guardrails.test.ts
git commit -m "test: add vscode debug workflow guardrails"
```

### Task 2: Add VS Code Launch And Task Configurations

**Files:**
- Create: `.vscode/launch.json`
- Create: `.vscode/tasks.json`
- Test: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Consumes: existing `package.json` scripts `build`, `test:unit`, `test:integration`, and `package`
- Produces: two launch configurations named `Watch and Debug Extension` and `Build Once and Debug Extension`; named tasks `build`, `watch`, `test:unit`, `test:integration`, and `package`

- [ ] **Step 1: Create `.vscode/tasks.json` with explicit named tasks**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "build",
      "type": "shell",
      "command": "pnpm run build",
      "problemMatcher": ["$tsc"]
    },
    {
      "label": "watch",
      "type": "shell",
      "command": "pnpm exec tsc -p tsconfig.json --watch",
      "isBackground": true,
      "problemMatcher": {
        "owner": "typescript",
        "fileLocation": "relative",
        "pattern": "$tsc",
        "background": {
          "activeOnStart": true,
          "beginsPattern": "Starting compilation in watch mode",
          "endsPattern": "Watching for file changes"
        }
      },
      "presentation": {
        "reveal": "always",
        "panel": "dedicated"
      }
    },
    {
      "label": "test:unit",
      "type": "shell",
      "command": "pnpm run test:unit"
    },
    {
      "label": "test:integration",
      "type": "shell",
      "command": "pnpm run test:integration"
    },
    {
      "label": "package",
      "type": "shell",
      "command": "pnpm run package"
    }
  ]
}
```

- [ ] **Step 2: Create `.vscode/launch.json` with both debug flows**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Watch and Debug Extension",
      "type": "extensionHost",
      "request": "launch",
      "runtimeExecutable": "${execPath}",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "watch"
    },
    {
      "name": "Build Once and Debug Extension",
      "type": "extensionHost",
      "request": "launch",
      "runtimeExecutable": "${execPath}",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "build"
    }
  ]
}
```

- [ ] **Step 3: Run the focused guardrail test to verify the files satisfy the contract**

Run: `pnpm run test:integration -- test/integration/extension/release-guardrails.test.ts`
Expected: PASS

- [ ] **Step 4: Validate the JSON structure manually through VS Code conventions**

Run: `pnpm run build`
Expected: PASS; no source build regressions because the change is workspace tooling only

- [ ] **Step 5: Commit**

```bash
git add .vscode/launch.json .vscode/tasks.json
git commit -m "chore: add vscode debug workflow configs"
```

### Task 3: Document The Workflow In README

**Files:**
- Modify: `README.md`
- Test: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Consumes: the launch configuration names `Watch and Debug Extension` and `Build Once and Debug Extension`, and the output channel name `9router Copilot`
- Produces: a short `Debug in VS Code` section that explains `F5`, selecting the build-once config, running tasks, and checking diagnostics output

- [ ] **Step 1: Write the failing documentation expectation as an assertion**

```ts
it('documents the VS Code debug workflow for local development', async () => {
  const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');

  expect(readme).toContain('## Debug in VS Code');
  expect(readme).toContain('Watch and Debug Extension');
  expect(readme).toContain('Build Once and Debug Extension');
  expect(readme).toContain('9router Copilot');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm run test:integration -- test/integration/extension/release-guardrails.test.ts`
Expected: FAIL because the README section does not exist yet

- [ ] **Step 3: Add the README section with concise usage instructions**

```md
## Debug in VS Code

Use `F5` to start the default `Watch and Debug Extension` flow. VS Code starts the TypeScript watch task, opens an `Extension Development Host`, and attaches the debugger to the extension automatically.

If you want a clean one-shot startup instead of watch mode, open the Run and Debug panel and choose `Build Once and Debug Extension`.

The workspace also exposes VS Code tasks for `build`, `test:unit`, `test:integration`, and `package`, so you can run the same project commands without leaving the editor.

For extension-side diagnostics while debugging, inspect the `9router Copilot` output channel.
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm run test:integration -- test/integration/extension/release-guardrails.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md test/integration/extension/release-guardrails.test.ts
git commit -m "docs: add vscode debug workflow guide"
```

### Task 4: Run Full Verification For Tooling And Docs Changes

**Files:**
- Verify: `.vscode/launch.json`
- Verify: `.vscode/tasks.json`
- Verify: `README.md`
- Verify: `test/integration/extension/release-guardrails.test.ts`

**Interfaces:**
- Consumes: repository verification scripts from `package.json`
- Produces: fresh evidence that the workspace debug tooling and docs change did not break build, lint, tests, or packaging

- [ ] **Step 1: Run the full build**

Run: `pnpm run build`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `pnpm run lint`
Expected: PASS

- [ ] **Step 3: Run unit tests**

Run: `pnpm run test:unit`
Expected: PASS

- [ ] **Step 4: Run integration tests**

Run: `pnpm run test:integration`
Expected: PASS

- [ ] **Step 5: Run packaging verification**

Run: `pnpm run package`
Expected: PASS and produces a local `.vsix` artifact

- [ ] **Step 6: Commit**

```bash
git add .vscode/launch.json .vscode/tasks.json README.md test/integration/extension/release-guardrails.test.ts
git commit -m "chore: verify vscode debug workflow"
```
