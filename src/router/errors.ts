import type { ExtensionError, ExtensionErrorCode } from '@/types/error';

export class NineRouterError extends Error implements ExtensionError {
  public readonly code: ExtensionErrorCode;
  public readonly requestId: string | undefined;
  public readonly details: Record<string, unknown> | undefined;

  public constructor(
    code: ExtensionErrorCode,
    message: string,
    options?: { requestId?: string; details?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'NineRouterError';
    this.code = code;
    this.requestId = options?.requestId;
    this.details = options?.details;
  }
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
