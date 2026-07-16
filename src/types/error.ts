export type ExtensionErrorCode =
  | 'AUTHENTICATION_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'COMBO_MAPPING_ERROR'
  | 'TRANSPORT_ERROR'
  | 'TIMEOUT_ERROR'
  | 'CANCELLATION_ERROR'
  | 'MALFORMED_STREAM_ERROR'
  | 'UPSTREAM_UNAVAILABLE';

export interface ExtensionError extends Error {
  code: ExtensionErrorCode;
  requestId: string | undefined;
  details: Record<string, unknown> | undefined;
}
