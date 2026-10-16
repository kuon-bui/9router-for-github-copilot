import type { ToolResult } from './read-file';

export interface PlanTaskInput {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
}

export interface UpdatePlanInput {
  entries: PlanTaskInput[];
}

export function executeUpdatePlan(input: UpdatePlanInput): ToolResult {
  if (!Array.isArray(input.entries)) {
    return {
      ok: false,
      output: 'Invalid plan: entries must be an array'
    };
  }

  const validStatuses = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
  const normalizedEntries = input.entries.map((entry) => ({
    content: String(entry.content ?? '').trim(),
    status: validStatuses.has(entry.status) ? entry.status : 'pending',
    priority: entry.priority ?? 'medium'
  }));

  const summary = normalizedEntries
    .map((e, i) => `${i + 1}. [${e.status}] ${e.content}`)
    .join('\n');

  return {
    ok: true,
    output: `Plan updated with ${normalizedEntries.length} tasks:\n${summary}`
  };
}
