import type * as acp from '@agentclientprotocol/sdk';
import type { RouterModelMetadata } from '@/router/model-catalog';
import type { AcpAgentMode, AcpReasoningEffort } from '@/types/acp-agent-contract';

export interface BuildAcpConfigOptionsInput {
  models: RouterModelMetadata[];
  currentModel: string;
  currentReasoningEffort: AcpReasoningEffort;
  currentMode: AcpAgentMode;
}

export function buildAcpConfigOptions(input: BuildAcpConfigOptionsInput): acp.SessionConfigOption[] {
  const modelOptions = input.models.map((m) => ({
    value: m.id,
    name: m.id,
    description: m.ownedBy ? `Owner: ${m.ownedBy}` : null
  }));

  // Ensure currentModel is present in options even if catalog is empty or does not include it
  if (!modelOptions.some((o) => o.value === input.currentModel) && input.currentModel) {
    modelOptions.unshift({
      value: input.currentModel,
      name: input.currentModel,
      description: null
    });
  }

  const modelConfigOption: acp.SessionConfigOption = {
    id: 'model',
    name: 'Model',
    type: 'select',
    category: 'model',
    currentValue: input.currentModel,
    options: modelOptions
  };

  const reasoningOptions: acp.SessionConfigSelectOption[] = [
    { value: 'off', name: 'Off (default)', description: 'Disable reasoning' },
    { value: 'minimal', name: 'Minimal', description: 'Lowest reasoning effort' },
    { value: 'low', name: 'Low', description: 'Low reasoning effort' },
    { value: 'medium', name: 'Medium', description: 'Balanced reasoning effort' },
    { value: 'high', name: 'High', description: 'High reasoning effort' },
    { value: 'xhigh', name: 'Extra High', description: 'Very high reasoning effort' },
    { value: 'max', name: 'Max', description: 'Maximum supported reasoning effort' }
  ];

  const reasoningConfigOption: acp.SessionConfigOption = {
    id: 'reasoning_effort',
    name: 'Reasoning Effort',
    type: 'select',
    category: 'thought_level',
    currentValue: input.currentReasoningEffort,
    options: reasoningOptions
  };

  const modeOptions: acp.SessionConfigSelectOption[] = [
    { value: 'ask', name: 'Ask (default)', description: 'Prompt for confirmation before edits and commands' },
    { value: 'auto-edit', name: 'Auto Edit', description: 'Automatically apply edits; prompt for commands' },
    { value: 'read-only', name: 'Read Only', description: 'Only inspect code and state; no modifications' }
  ];

  const modeConfigOption: acp.SessionConfigOption = {
    id: 'mode',
    name: 'Mode',
    type: 'select',
    category: 'mode',
    currentValue: input.currentMode,
    options: modeOptions
  };

  return [modelConfigOption, reasoningConfigOption, modeConfigOption];
}

export function buildLegacyModes(currentMode: AcpAgentMode): acp.SessionModeState {
  const availableModes: acp.SessionMode[] = [
    { id: 'ask', name: 'Ask', description: 'Prompt before edits and commands' },
    { id: 'auto-edit', name: 'Auto Edit', description: 'Auto apply edits; prompt for commands' },
    { id: 'read-only', name: 'Read Only', description: 'Read only access' }
  ];

  return {
    currentModeId: currentMode,
    availableModes
  };
}
