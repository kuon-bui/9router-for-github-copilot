import { createThinkingEffortConfigurationSchema } from './thinking-effort';
import type { DisplayModelSetting, PublishedModel } from '../types/product-model';

export function createPublishedModel(setting: DisplayModelSetting): PublishedModel {
  const capabilities: PublishedModel['capabilities'] = {
    ...(setting.toolMode === 'auto' ? { toolCalling: 32 } : {}),
    ...(setting.visionMode === 'native' ? { imageInput: true } : {})
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

export function resolvePublishedModels(settings: DisplayModelSetting[]): PublishedModel[] {
  return settings
    .filter((setting) => setting.enabled && setting.comboId.trim().length > 0)
    .map(createPublishedModel);
}
