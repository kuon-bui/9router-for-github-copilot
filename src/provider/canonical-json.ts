type CanonicalJsonValue =
  | null
  | string
  | number
  | boolean
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function canonicalizeValue(
  value: unknown,
  seen: WeakSet<object>
): CanonicalJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError('Converting circular structure to JSON');
    }
    seen.add(value);
    try {
      return value.map((item) => {
        const canonical = canonicalizeValue(item, seen);
        return canonical === undefined ? null : canonical;
      });
    } finally {
      seen.delete(value);
    }
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  if (seen.has(value)) {
    throw new TypeError('Converting circular structure to JSON');
  }
  seen.add(value);

  const normalizedEntries: [string, CanonicalJsonValue][] = [];
  for (const key of Object.keys(value).sort()) {
    const normalized = canonicalizeValue(value[key], seen);
    if (normalized !== undefined) {
      normalizedEntries.push([key, normalized]);
    }
  }

  seen.delete(value);
  return Object.fromEntries(normalizedEntries);
}

export function canonicalJsonStringify(value: unknown): string | undefined {
  const normalized = canonicalizeValue(value, new WeakSet<object>());
  return JSON.stringify(normalized);
}

export function canonicalizeJsonObject(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = canonicalizeValue(input, new WeakSet<object>());
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') {
    return {};
  }

  return normalized as Record<string, unknown>;
}
