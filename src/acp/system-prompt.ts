import defaultPromptText from '@root/prompts/acp/system-prompt.md?raw';
import type { AcpAgentMode } from '@/types/acp-agent-contract';
import type { RouterResponseMessage } from '@/types/router-contract';

export interface SystemPromptContext {
  cwd: string;
  mode: AcpAgentMode;
}

export function buildSystemPrompt(context: SystemPromptContext): RouterResponseMessage {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'powershell.exe' : '/bin/sh';

  const modeInstructions = context.mode === 'read-only'
    ? 'Operating Mode: Read-Only. You may only inspect files and project state. Do NOT propose file edits or command execution.'
    : context.mode === 'auto-edit'
    ? 'Operating Mode: Auto-Edit. File modifications within the workspace do not require approval. Commands still require confirmation.'
    : 'Operating Mode: Ask. File modifications and command executions require user permission.';

  const runtimeSection = [
    '## Workspace Environment',
    `- Workspace Root (cwd): ${context.cwd}`,
    `- Platform: ${process.platform}`,
    `- Shell: ${shell}`,
    `- ${modeInstructions}`
  ].join('\n');

  const fullPrompt = `${defaultPromptText.trim()}\n\n${runtimeSection}`;

  return {
    role: 'system',
    content: [{ type: 'input_text', text: fullPrompt }]
  };
}
