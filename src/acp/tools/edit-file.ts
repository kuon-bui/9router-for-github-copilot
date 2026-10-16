import { assertPathWithinCwd } from './path-guard';
import { MAX_FILE_MUTATION_BYTES } from './output-limits';
import type { WorkspaceFs } from './workspace-fs';
import type { ToolResult } from './read-file';

export interface EditFileInput {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export function generateDiffPreview(oldText: string, newText: string): string {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);

  const diffParts: string[] = [];
  diffParts.push('@@ -1 +1 @@');
  for (const line of oldLines) {
    diffParts.push(`-${line}`);
  }
  for (const line of newLines) {
    diffParts.push(`+${line}`);
  }

  return diffParts.join('\n');
}

export async function executeEditFile(
  input: EditFileInput,
  fs: WorkspaceFs,
  cwd: string
): Promise<ToolResult> {
  try {
    const fullPath = assertPathWithinCwd(input.path, cwd, false);
    const content = await fs.readText(fullPath);

    if (new TextEncoder().encode(content).byteLength > MAX_FILE_MUTATION_BYTES) {
      return {
        ok: false,
        output: `File exceeds maximum editable size of 1 MiB: "${input.path}"`
      };
    }

    if (!content.includes(input.old_string)) {
      return {
        ok: false,
        output: `Could not find exact match for old_string in "${input.path}"`
      };
    }

    if (!input.replace_all) {
      const firstIndex = content.indexOf(input.old_string);
      const lastIndex = content.lastIndexOf(input.old_string);
      if (firstIndex !== lastIndex) {
        return {
          ok: false,
          output: `Found multiple occurrences of old_string in "${input.path}". Set replace_all: true or include more surrounding context.`
        };
      }
    }

    const updated = input.replace_all
      ? content.replaceAll(input.old_string, input.new_string)
      : content.replace(input.old_string, input.new_string);

    await fs.writeText(fullPath, updated);
    const diff = generateDiffPreview(input.old_string, input.new_string);

    return {
      ok: true,
      output: `Successfully updated ${input.path}`,
      diff
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      output: `Error editing file "${input.path}": ${message}`
    };
  }
}
