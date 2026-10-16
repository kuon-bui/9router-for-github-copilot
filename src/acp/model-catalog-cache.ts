import type { RouterClient } from '@/router/client';
import type { RouterModelMetadata } from '@/router/model-catalog';

export const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ModelCatalogCache {
  getModels(client: RouterClient, apiKey: string, baseUrl: string): Promise<RouterModelMetadata[]>;
  clear(): void;
}

export function createModelCatalogCache(ttlMs = CATALOG_CACHE_TTL_MS): ModelCatalogCache {
  let cachedModels: RouterModelMetadata[] = [];
  let lastFetchTime = 0;
  let inFlightPromise: Promise<RouterModelMetadata[]> | null = null;

  return {
    async getModels(client: RouterClient, apiKey: string, baseUrl: string): Promise<RouterModelMetadata[]> {
      const now = Date.now();
      if (cachedModels.length > 0 && now - lastFetchTime < ttlMs) {
        return cachedModels;
      }

      if (inFlightPromise) {
        return inFlightPromise;
      }

      inFlightPromise = (async () => {
        try {
          const controller = new AbortController();
          const models = await client.listModels({
            baseUrl,
            apiKey,
            timeoutMs: 15000,
            signal: controller.signal
          });
          if (models.length > 0) {
            cachedModels = models;
            lastFetchTime = Date.now();
          }
          return cachedModels.length > 0 ? cachedModels : models;
        } catch {
          // If fetch fails but we have stale cache, return it
          return cachedModels;
        } finally {
          inFlightPromise = null;
        }
      })();

      return inFlightPromise;
    },

    clear(): void {
      cachedModels = [];
      lastFetchTime = 0;
      inFlightPromise = null;
    }
  };
}
