import * as acp from '@agentclientprotocol/sdk';

export const ACP_ERROR_CODES = {
  AUTH_REQUIRED: -32000,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
} as const;

export function createAuthRequiredError(message = '9router API key is missing or invalid'): acp.RequestError {
  return new acp.RequestError(ACP_ERROR_CODES.AUTH_REQUIRED, message, {
    authRequired: true
  });
}

export function createInvalidParamsError(message: string, data?: unknown): acp.RequestError {
  return acp.RequestError.invalidParams(data, message);
}

export function createInternalError(message: string, code?: string, requestId?: string): acp.RequestError {
  return acp.RequestError.internalError(
    { code, requestId },
    message
  );
}
