export function buildResponsesUrl(baseUrl: string): string {
  return `${baseUrl}/v1/responses`;
}

export function buildModelsUrl(baseUrl: string): string {
  return `${baseUrl}/v1/models`;
}

export function buildUsageUrl(baseUrl: string): string {
  return `${baseUrl}/tools/quotas`;
}
