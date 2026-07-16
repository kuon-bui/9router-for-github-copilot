const AUTHORIZATION_PATTERN = /^Bearer\s+.+$/i;

export function redactBearerToken(value: string): string {
  return AUTHORIZATION_PATTERN.test(value) ? 'Bearer [REDACTED]' : value;
}

export function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (key.toLowerCase().includes('token') || key.toLowerCase().includes('authorization')) {
        return [key, '[REDACTED]'];
      }

      if (typeof value === 'string') {
        return [key, redactBearerToken(value)];
      }

      return [key, value];
    })
  );
}
