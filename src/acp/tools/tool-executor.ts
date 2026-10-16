import { executeReadFile } from './read-file';
import { executeListDirectory } from './list-directory';
import { executeSearchFiles } from './search-files';
import { executeEditFile } from './edit-file';
import { executeWriteFile } from './write-file';
import { executeUpdatePlan } from './update-plan';
import { executeRunCommand } from './run-command';
import type { WorkspaceFs } from './workspace-fs';
import type { ToolResult } from './read-file';
import type { ReadFileInput } from './read-file';
import type { ListDirectoryInput } from './list-directory';
import type { SearchFilesInput } from './search-files';
import type { EditFileInput } from './edit-file';
import type { WriteFileInput } from './write-file';
import type { UpdatePlanInput } from './update-plan';
import type { RunCommandInput } from './run-command';
import type { ClientTerminalDelegate } from './client-terminal-runner';

export interface ToolExecutionContext {
  cwd: string;
  fs: WorkspaceFs;
  signal?: AbortSignal | undefined;
  clientTerminal?: ClientTerminalDelegate | undefined;
}

export async function executeBuiltinTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolResult> {
  switch (toolName) {
    case 'read_file':
      return executeReadFile(args as unknown as ReadFileInput, context.fs, context.cwd);
    case 'list_directory':
      return executeListDirectory(args as unknown as ListDirectoryInput, context.fs, context.cwd);
    case 'search_files':
      return executeSearchFiles(args as unknown as SearchFilesInput, context.fs, context.cwd);
    case 'edit_file':
      return executeEditFile(args as unknown as EditFileInput, context.fs, context.cwd);
    case 'write_file':
      return executeWriteFile(args as unknown as WriteFileInput, context.fs, context.cwd);
    case 'update_plan':
      return executeUpdatePlan(args as unknown as UpdatePlanInput);
    case 'run_command':
      return executeRunCommand(args as unknown as RunCommandInput, {
        cwd: context.cwd,
        signal: context.signal,
        clientTerminal: context.clientTerminal
      });
    default:
      return {
        ok: false,
        output: `Unknown tool: "${toolName}"`
      };
  }
}
