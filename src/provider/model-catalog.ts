import { createThinkingEffortConfigurationSchema } from './thinking-effort';
import type { ConfiguredModel, PublishedModel } from '../types/product-model';

export interface PublishedModelOptions {
  visionProxyConfigured?: boolean;
}

export function createPublishedModel(
  setting: ConfiguredModel,
  options: PublishedModelOptions = {}
): PublishedModel {
  const exposesImageInput =
    setting.visionMode === 'native' ||
    (setting.visionMode === 'proxy' && options.visionProxyConfigured === true);
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
    maxInputTokens: setting.maxInputTokens,
    maxOutputTokens: setting.maxOutputTokens,
    capabilities,
    configurationSchema: createThinkingEffortConfigurationSchema(setting.thinkingMode)
  };
}

export function resolvePublishedModels(
  settings: ConfiguredModel[],
  options: PublishedModelOptions = {}
): PublishedModel[] {
  return settings.map((setting) => createPublishedModel(setting, options));
}
