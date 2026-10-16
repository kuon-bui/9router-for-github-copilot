export type DebugMode = 'minimal' | 'metadata' | 'verbose';

export const DEBUG_RANK: Record<DebugMode, number> = {
  minimal: 0,
  metadata: 1,
  verbose: 2
};

export function shouldLogDebug(
  configured: DebugMode,
  threshold: DebugMode = 'metadata'
): boolean {
  return DEBUG_RANK[configured] >= DEBUG_RANK[threshold];
}

export function isAllowedDebugLevel(value: unknown): value is DebugMode {
  return value === 'minimal' || value === 'metadata' || value === 'verbose';
}
