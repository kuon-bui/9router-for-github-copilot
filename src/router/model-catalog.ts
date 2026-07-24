import { NineRouterError } from './errors';

export interface RouterModelMetadata {
  id: string;
  ownedBy?: string;
  vision?: true;
  contextWindow?: number;
  maxOutput?: number;
}

export interface RouterVisionModel {
  id: string;
  ownedBy?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCatalogPayload(payload: unknown): payload is { data: unknown[] } {
  return isRecord(payload) && Array.isArray(payload.data);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function malformedCatalogError(): NineRouterError {
  return new NineRouterError(
    'UPSTREAM_UNAVAILABLE',
    '9router model catalog response is malformed',
    { details: { phase: 'model-catalog-discovery' } }
  );
}

function parseCatalogItem(item: unknown): RouterModelMetadata | undefined {
  if (!isRecord(item) || typeof item.id !== 'string') {
    return undefined;
  }

  const id = item.id;
  if (id.trim().length === 0) {
    return undefined;
  }

  const capabilities = isRecord(item.capabilities) ? item.capabilities : undefined;
  const ownedBy = typeof item.owned_by === 'string' ? item.owned_by.trim() : '';

  return {
    id,
    ...(ownedBy.length > 0 ? { ownedBy } : {}),
    ...(capabilities?.vision === true ? { vision: true as const } : {}),
    ...(isPositiveSafeInteger(capabilities?.contextWindow)
      ? { contextWindow: capabilities.contextWindow }
      : {}),
    ...(isPositiveSafeInteger(capabilities?.maxOutput)
      ? { maxOutput: capabilities.maxOutput }
      : {})
  };
}

function mergeCatalogItems(
  existing: RouterModelMetadata,
  candidate: RouterModelMetadata
): RouterModelMetadata {
  const ownedBy = existing.ownedBy ?? candidate.ownedBy;
  const contextWindow = existing.contextWindow ?? candidate.contextWindow;
  const maxOutput = existing.maxOutput ?? candidate.maxOutput;

  return {
    id: existing.id,
    ...(ownedBy ? { ownedBy } : {}),
    ...(existing.vision === true || candidate.vision === true
      ? { vision: true as const }
      : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutput !== undefined ? { maxOutput } : {})
  };
}

export function parseRouterModels(payload: unknown): RouterModelMetadata[] {
  if (!isCatalogPayload(payload)) {
    throw malformedCatalogError();
  }

  const byId = new Map<string, RouterModelMetadata>();
  for (const item of payload.data) {
    const parsed = parseCatalogItem(item);
    if (!parsed) {
      continue;
    }

    const existing = byId.get(parsed.id);
    byId.set(parsed.id, existing ? mergeCatalogItems(existing, parsed) : parsed);
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function toVisionModels(
  models: readonly RouterModelMetadata[]
): RouterVisionModel[] {
  return models
    .filter((model) => model.vision === true)
    .map((model) =>
      model.ownedBy ? { id: model.id, ownedBy: model.ownedBy } : { id: model.id }
    );
}

export function parseVisionModels(payload: unknown): RouterVisionModel[] {
  return toVisionModels(parseRouterModels(payload));
}
