import { assertPathWithinCwd } from './path-guard';
import { MAX_FILE_MUTATION_BYTES } from './output-limits';
import { generateDiffPreview } from './edit-file';
import type { WorkspaceFs } from './workspace-fs';
import type { ToolResult } from './read-file';

export interface WriteFileInput {
  path: string;
  content: string;
}

export async function executeWriteFile(
  input: WriteFileInput,
  fs: WorkspaceFs,
  cwd: string
): Promise<ToolResult> {
  try {
    const fullPath = assertPathWithinCwd(input.path, cwd, false);
    const contentBytes = new TextEncoder().encode(input.content).byteLength;
    if (contentBytes > MAX_FILE_MUTATION_BYTES) {
      return {
        ok: false,
        output: `Content exceeds maximum write size of 1 MiB: "${input.path}"`
      };
    }

    let previousContent = '';
    try {
      previousContent = await fs.readText(fullPath);
    } catch {
      // New file
    }

    await fs.writeText(fullPath, input.content);
    const diff = generateDiffPreview(previousContent, input.content);

    return {
      ok: true,
      output: `Successfully wrote ${input.path}`,
      diff
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output: `Error writing file "${input.path}": ${message}`
    };
  }
}
