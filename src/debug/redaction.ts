const AUTHORIZATION_PATTERN = /^Bearer\s+.+$/i;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const DATA_URL_PATTERN = /data:[^;,\s]+;base64,[A-Za-z0-9+/=_-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const LONG_ENCODED_VALUE_PATTERN = /\b[A-Za-z0-9+/_=-]{80,}\b/g;

export function redactBearerToken(value: string): string {
  return AUTHORIZATION_PATTERN.test(value) ? 'Bearer [REDACTED]' : value;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]')
    .replace(DATA_URL_PATTERN, 'data:[REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED]')
    .replace(LONG_ENCODED_VALUE_PATTERN, '[REDACTED]');
}

export function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (key.toLowerCase().includes('token') || key.toLowerCase().includes('authorization')) {
        return [key, '[REDACTED]'];
      }

      if (typeof value === 'string') {
        return [key, redactSensitiveText(redactBearerToken(value))];
      }

      return [key, value];
    })
  );
}
