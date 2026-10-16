import type { Session } from './session-store';

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

export interface CheckPermissionInput {
  session: Session;
  toolName: string;
  args: Record<string, unknown>;
  isOutsideCwd?: boolean;
  diffPreview?: { oldText: string; newText: string; path: string };
  requestPermission: (request: {
    sessionId: string;
    toolCall: {
      toolCallId: string;
      title: string;
      kind: 'read' | 'edit' | 'execute' | 'search' | 'think' | 'other';
      status: 'pending';
      rawInput: unknown;
      content?: unknown[];
    };
    options: Array<{
      kind: 'allow_once' | 'allow_always' | 'reject_once';
      name: string;
      optionId: string;
    }>;
  }) => Promise<{
    outcome:
      | { outcome: 'cancelled' }
      | { outcome: 'selected'; optionId: string };
  }>;
}

function getToolKind(toolName: string): 'read' | 'edit' | 'execute' | 'search' | 'think' | 'other' {
  if (toolName === 'read_file' || toolName === 'list_directory') {
    return 'read';
  }
  if (toolName === 'search_files') {
    return 'search';
  }
  if (toolName === 'edit_file' || toolName === 'write_file') {
    return 'edit';
  }
  if (toolName === 'run_command') {
    return 'execute';
  }
  if (toolName === 'update_plan') {
    return 'think';
  }
  return 'other';
}

export async function checkToolPermission(input: CheckPermissionInput): Promise<PermissionDecision> {
  const { session, toolName, args, isOutsideCwd, diffPreview, requestPermission } = input;
  const kind = getToolKind(toolName);

  // 1. Read-only mode restrictions
  if (session.mode === 'read-only') {
    if (kind === 'edit' || kind === 'execute' || kind === 'other') {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not permitted in read-only mode`
      };
    }
  }

  // 2. Check session-level grants
  const grantKey = toolName === 'run_command' && typeof args['command'] === 'string'
    ? `run_command:${args['command']}`
    : toolName;

  if (session.grants.has(grantKey)) {
    return { allowed: true };
  }

  // 3. Determine if confirmation is needed
  let needsPrompt = false;

  if (isOutsideCwd) {
    if (kind === 'edit') {
      return {
        allowed: false,
        reason: `Modifications outside workspace directory are strictly forbidden: "${String(args['path'] ?? '')}"`
      };
    }
    needsPrompt = true;
  } else if (session.mode === 'auto-edit') {
    if (kind === 'execute' || kind === 'other') {
      needsPrompt = true;
    }
  } else if (session.mode === 'ask') {
    if (kind === 'edit' || kind === 'execute' || kind === 'other') {
      needsPrompt = true;
    }
  }

  if (!needsPrompt) {
    return { allowed: true };
  }

  // 4. Prompt client/user for permission
  const title = toolName === 'run_command'
    ? `Execute command: ${String(args['command'] ?? '')}`
    : toolName === 'edit_file' || toolName === 'write_file'
    ? `Modify file: ${String(args['path'] ?? '')}`
    : `Run ${toolName}`;

  const options = [
    {
      kind: 'allow_once' as const,
      name: 'Allow once',
      optionId: 'allow'
    },
    {
      kind: 'allow_always' as const,
      name: 'Always allow in this session',
      optionId: 'allow_always'
    },
    {
      kind: 'reject_once' as const,
      name: 'Reject',
      optionId: 'reject'
    }
  ];

  const content: unknown[] = [];
  if (diffPreview) {
    content.push({
      type: 'diff',
      path: diffPreview.path,
      oldText: diffPreview.oldText,
      newText: diffPreview.newText
    });
  }

  const response = await requestPermission({
    sessionId: session.sessionId,
    toolCall: {
      toolCallId: `call_${Date.now()}`,
      title,
      kind,
      status: 'pending',
      rawInput: args,
      ...(content.length > 0 ? { content } : {})
    },
    options
  });

  if (response.outcome.outcome === 'cancelled') {
    return { allowed: false, reason: 'User rejected this action' };
  }

  if (response.outcome.optionId === 'reject') {
    return { allowed: false, reason: 'User rejected this action' };
  }

  if (response.outcome.optionId === 'allow_always') {
    session.grants.add(grantKey);
  }

  return { allowed: true };
}
