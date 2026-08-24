import type { ExtensionError, ExtensionErrorCode } from '@/types/error';

export class NineRouterError extends Error implements ExtensionError {
  public readonly code: ExtensionErrorCode;
  public readonly requestId: string | undefined;
  public readonly details: Record<string, unknown> | undefined;
  // Raw upstream body kept off `details` on purpose: diagnostics may opt into it at the
  // verbose debug level, but it must never ride along in the metadata-level payload.
  public readonly responseBody: string | undefined;

  public constructor(
    code: ExtensionErrorCode,
    message: string,
    options?: {
      requestId?: string;
      details?: Record<string, unknown>;
      responseBody?: string;
    }
  ) {
    super(message);
    this.name = 'NineRouterError';
    this.code = code;
    this.requestId = options?.requestId;
    this.details = options?.details;
    this.responseBody = options?.responseBody;
  }
}

// ponytail: 512 chars keeps a router message readable in the Copilot error surface; the
// untruncated body stays reachable through NineRouterError.responseBody for verbose diagnostics.
const MAX_ERROR_DETAIL_CHARS = 512;

// Appends an upstream explanation to a stable local message so the host shows both the
// classification and what 9router actually complained about, on a single bounded line.
export function appendErrorDetail(baseMessage: string, detail: string): string {
  const collapsed = detail.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return baseMessage;
  }

  const bounded =
    collapsed.length <= MAX_ERROR_DETAIL_CHARS
      ? collapsed
      : `${collapsed.slice(0, MAX_ERROR_DETAIL_CHARS - 3)}...`;

  return `${baseMessage}: ${bounded}`;
}

export function toNineRouterError(error: unknown, fallbackCode: ExtensionErrorCode): NineRouterError {
  if (error instanceof NineRouterError) {
    return error;
  }

  if (error instanceof Error) {
    return new NineRouterError(fallbackCode, error.message);
  }

  return new NineRouterError(fallbackCode, 'Unknown error');
}
