export function buildResponsesUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  const versionedBaseUrl = normalizedBaseUrl.endsWith('/v1')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1`;

  return `${versionedBaseUrl}/responses`;
}

export function buildModelsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  const versionedBaseUrl = normalizedBaseUrl.endsWith('/v1')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1`;

  return `${versionedBaseUrl}/models`;
}

export function buildUsageUrl(_baseUrl: string): string {
  // const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  // const versionedBaseUrl = normalizedBaseUrl.endsWith('/v1')
  //   ? normalizedBaseUrl
  //   : `${normalizedBaseUrl}/v1`;

  // return `${versionedBaseUrl}/usage`;
  return 'http://localhost:20129/quotas'
}
