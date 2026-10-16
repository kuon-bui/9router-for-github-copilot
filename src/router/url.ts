export function buildResponsesUrl(baseUrl: string): string {
  return `${baseUrl}/v1/responses`;
}

export function buildModelsUrl(baseUrl: string): string {
  return `${baseUrl}/v1/models`;
}

export function buildUsageUrl(baseUrl: string): string {
  return `${baseUrl}/tools/quotas`;
}

export function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/v1\/*$|\/+$/, '');
}

export function isHttpBaseUrl(input: string): boolean {
  if (!input) {
    return false;
  }
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

