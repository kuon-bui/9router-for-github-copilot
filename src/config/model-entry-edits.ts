export function readModelEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function isInRange(entries: readonly unknown[], sourceIndex: number): boolean {
  return (
    Number.isSafeInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < entries.length
  );
}

export function addModelEntry(value: unknown, entry: Record<string, unknown>): unknown[] {
  return [...readModelEntries(value), entry];
}

export function updateModelEntry(
  value: unknown,
  sourceIndex: number,
  entry: Record<string, unknown>
): unknown[] {
  const entries = readModelEntries(value);
  if (!isInRange(entries, sourceIndex)) {
    return entries;
  }

  entries[sourceIndex] = entry;
  return entries;
}

export function removeModelEntry(value: unknown, sourceIndex: number): unknown[] {
  const entries = readModelEntries(value);
  if (!isInRange(entries, sourceIndex)) {
    return entries;
  }

  entries.splice(sourceIndex, 1);
  return entries;
}

export function moveModelEntry(
  value: unknown,
  sourceIndex: number,
  direction: 'up' | 'down'
): unknown[] {
  const entries = readModelEntries(value);
  const targetIndex = direction === 'up' ? sourceIndex - 1 : sourceIndex + 1;
  if (!isInRange(entries, sourceIndex) || !isInRange(entries, targetIndex)) {
    return entries;
  }

  const moved = entries[sourceIndex];
  entries[sourceIndex] = entries[targetIndex];
  entries[targetIndex] = moved;
  return entries;
}
