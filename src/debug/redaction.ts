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

// Transport failures can quote outbound request headers back at us (proxy and TLS errors do),
// so any string headed for a user-visible message gets the credential stripped inline.
const INLINE_AUTHORIZATION_PATTERN = /\bBearer\s+[^\s'"]+/gi;

export function redactBearerTokens(value: string): string {
  return value.replace(INLINE_AUTHORIZATION_PATTERN, 'Bearer [REDACTED]');
}
