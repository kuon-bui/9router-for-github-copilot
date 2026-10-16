import { assertPathWithinCwd } from './path-guard';
import { MAX_FILE_READ_BYTES, MAX_FILE_READ_LINES, truncateOutput } from './output-limits';
import type { WorkspaceFs } from './workspace-fs';

export interface ReadFileInput {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  diff?: string;
}

export async function executeReadFile(
  input: ReadFileInput,
  fs: WorkspaceFs,
  cwd: string
): Promise<ToolResult> {
  try {
    const fullPath = assertPathWithinCwd(input.path, cwd, true);
    const content = await fs.readText(fullPath);

    const lines = content.split(/\r?\n/);
    const offset = Math.max(1, input.offset ?? 1);
    const maxLines = Math.min(input.limit ?? MAX_FILE_READ_LINES, MAX_FILE_READ_LINES);

    const startIndex = offset - 1;
    const selectedLines = lines.slice(startIndex, startIndex + maxLines);
    const joined = selectedLines.join('\n');

    return {
      ok: true,
      output: truncateOutput(joined, MAX_FILE_READ_BYTES)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output: `Error reading file "${input.path}": ${message}`
    };
  }
}
