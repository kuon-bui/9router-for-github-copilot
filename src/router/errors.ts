import { redactBearerTokens } from '@/debug/redaction';
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

// ponytail: 8 nodes covers undici's deepest observed chain (fetch -> aggregate -> socket -> TLS);
// the bound only exists so a self-referential chain cannot spin.
const MAX_CAUSE_NODES = 8;

// A rejected `fetch` reports only "fetch failed"; the actionable reason (ECONNREFUSED, ENOTFOUND,
// a TLS code, every address happy-eyeballs tried) lives on the cause chain, so it is walked
// depth-first: each error, then an AggregateError's branches in order, then its own cause.
function collectCauseChain(root: unknown): Error[] {
  const collected: Error[] = [];
  const seen = new Set<unknown>();

  const visit = (value: unknown): void => {
    if (!(value instanceof Error) || seen.has(value) || collected.length >= MAX_CAUSE_NODES) {
      return;
    }

    seen.add(value);
    collected.push(value);

    if (value instanceof AggregateError && Array.isArray(value.errors)) {
      for (const nested of value.errors as unknown[]) {
        visit(nested);
      }
    }

    visit(value.cause);
  };

  visit(root);
  return collected;
}

// `code` is renamed so diagnostics never confuse the OS-level code with ExtensionErrorCode.
const TRANSPORT_CAUSE_FIELDS = [
  ['code', 'transportCode'],
  ['syscall', 'syscall'],
  ['address', 'address'],
  ['hostname', 'hostname'],
  ['port', 'port']
] as const;

// Node spreads system-error fields across the chain (an AggregateError carries none of its own),
// so the first defined value wins for each field.
function extractTransportCauseFields(causes: Error[]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const cause of causes) {
    const source = cause as unknown as Record<string, unknown>;
    for (const [sourceKey, targetKey] of TRANSPORT_CAUSE_FIELDS) {
      const value = source[sourceKey];
      const usable = typeof value === 'string' ? value.length > 0 : typeof value === 'number';
      if (usable && fields[targetKey] === undefined) {
        fields[targetKey] = value;
      }
    }
  }

  return fields;
}

export function toTransportError(error: Error): NineRouterError {
  const causes = collectCauseChain(error.cause);
  const baseMessage = redactBearerTokens(error.message);
  const detail = causes
    .map((cause) => redactBearerTokens(cause.message).trim())
    .filter((message) => message.length > 0 && message !== baseMessage)
    .join('; ');
  const details = extractTransportCauseFields(causes);

  return new NineRouterError(
    'TRANSPORT_ERROR',
    appendErrorDetail(baseMessage, detail),
    Object.keys(details).length > 0 ? { details } : undefined
  );
}
