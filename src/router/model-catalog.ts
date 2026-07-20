import { NineRouterError } from './errors';

export interface RouterVisionModel {
  id: string;
  ownedBy?: string;
}

interface VisionModelCatalogItem {
  id: string;
  ownedBy?: string;
}

function isCatalogPayload(payload: unknown): payload is { data: unknown[] } {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    return false;
  }

  return Array.isArray(payload.data);
}

function malformedCatalogError(): NineRouterError {
  return new NineRouterError('UPSTREAM_UNAVAILABLE', '9router model catalog response is malformed', {
    details: { phase: 'vision-model-discovery' }
  });
}

function parseCatalogItem(item: unknown): VisionModelCatalogItem | undefined {
  if (typeof item !== 'object' || item === null) {
    return undefined;
  }

  const candidate = item as Record<string, unknown>;

  if (typeof candidate.id !== 'string') {
    return undefined;
  }

  const id = candidate.id.trim();
  if (id.length === 0) {
    return undefined;
  }

  const capabilities = candidate.capabilities;
  if (typeof capabilities !== 'object' || capabilities === null) {
    return undefined;
  }

  if ((capabilities as Record<string, unknown>).vision !== true) {
    return undefined;
  }

  if (typeof candidate.owned_by === 'string') {
    const ownedBy = candidate.owned_by.trim();
    if (ownedBy.length > 0) {
      return { id, ownedBy };
    }
  }

  return { id };
}

export function parseVisionModels(payload: unknown): RouterVisionModel[] {
  if (!isCatalogPayload(payload)) {
    throw malformedCatalogError();
  }

  const byId = new Map<string, RouterVisionModel>();

  for (const item of payload.data) {
    const parsed = parseCatalogItem(item);
    if (!parsed) {
      continue;
    }

    const existing = byId.get(parsed.id);
    if (!existing) {
      byId.set(parsed.id, parsed.ownedBy ? { id: parsed.id, ownedBy: parsed.ownedBy } : { id: parsed.id });
      continue;
    }

    if (!existing.ownedBy && parsed.ownedBy) {
      byId.set(parsed.id, { id: parsed.id, ownedBy: parsed.ownedBy });
    }
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}