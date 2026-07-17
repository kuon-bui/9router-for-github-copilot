import { createThinkingEffortConfigurationSchema } from './thinking-effort';
import type { DisplayModelSetting, PublishedModel } from '../types/product-model';

export interface PublishedModelOptions {
  visionProxyConfigured?: boolean;
}

export function createPublishedModel(
  setting: DisplayModelSetting,
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
    id: setting.key,
    name: setting.label,
    vendor: '9router',
    family: setting.key,
    version: '1',
    maxInputTokens: 128_000,
    maxOutputTokens: 8_192,
    capabilities,
    configurationSchema: createThinkingEffortConfigurationSchema(setting.thinkingMode)
  };
}

export function resolvePublishedModels(
  settings: DisplayModelSetting[],
  options: PublishedModelOptions = {}
): PublishedModel[] {
  return settings
    .filter((setting) => setting.enabled && setting.comboId.trim().length > 0)
    .map((setting) => createPublishedModel(setting, options));
}
