import { createThinkingEffortConfigurationSchema } from './thinking-effort';
import type { RouterModelMetadata } from '../router/model-catalog';
import type { ConfiguredModel, PublishedModel } from '../types/product-model';

export interface PublishedModelOptions {
  visionProxyAvailable?: boolean;
  routerModel?: RouterModelMetadata;
}

export interface ResolvePublishedModelsOptions {
  visionProxyAvailable?: boolean;
  routerModels?: readonly RouterModelMetadata[];
}

export function createPublishedModel(
  setting: ConfiguredModel,
  options: PublishedModelOptions = {}
): PublishedModel {
  const maxOutputTokens = options.routerModel?.maxOutput ?? setting.maxOutputTokens;
  const catalogMaxInputTokens = options.routerModel?.contextWindow
    ? options.routerModel.contextWindow - maxOutputTokens
    : undefined;
  const exposesImageInput =
    setting.visionMode === 'native' ||
    (setting.visionMode === 'proxy' && options.visionProxyAvailable === true);
  const capabilities: PublishedModel['capabilities'] = {
    ...(setting.toolMode === 'auto' ? { toolCalling: 32 } : {}),
    ...(exposesImageInput ? { imageInput: true } : {})
  };

  return {
    id: setting.id,
    name: setting.name,
    vendor: '9router',
    family: setting.id,
    version: '1',
    maxInputTokens:
      catalogMaxInputTokens !== undefined && catalogMaxInputTokens > 0
        ? catalogMaxInputTokens
        : setting.maxInputTokens,
    maxOutputTokens,
    capabilities,
    ...(setting.thinkingEfforts.length > 0
      ? {
          configurationSchema: createThinkingEffortConfigurationSchema(
            setting.thinkingMode,
            setting.thinkingEfforts
          )
        }
      : {})
  };
}

export function resolvePublishedModels(
  settings: ConfiguredModel[],
  options: ResolvePublishedModelsOptions = {}
): PublishedModel[] {
  const routerModelsById = new Map(
    options.routerModels?.map((model) => [model.id, model] as const) ?? []
  );

  return settings.map((setting) => {
    const routerModel = routerModelsById.get(setting.modelId);

    return createPublishedModel(setting, {
      ...(options.visionProxyAvailable === true ? { visionProxyAvailable: true } : {}),
      ...(routerModel ? { routerModel } : {})
    });
  });
}
