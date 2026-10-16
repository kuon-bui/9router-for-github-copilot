import { describe, expect, it } from 'vitest';
import { buildAcpConfigOptions, buildLegacyModes } from '@/acp/config-options';

describe('buildAcpConfigOptions', () => {
  it('generates model, reasoning_effort, and mode options in correct order', () => {
    const options = buildAcpConfigOptions({
      models: [
        { id: 'gh/gpt-5', ownedBy: 'github', vision: true },
        { id: 'anthropic/claude-3-7-sonnet', ownedBy: 'anthropic', vision: true }
      ],
      currentModel: 'gh/gpt-5',
      currentReasoningEffort: 'off',
      currentMode: 'ask'
    });

    expect(options).toHaveLength(3);

    const [modelOpt, reasoningOpt, modeOpt] = options;
    expect(modelOpt?.id).toBe('model');
    expect(modelOpt?.category).toBe('model');
    expect(modelOpt?.currentValue).toBe('gh/gpt-5');

    expect(reasoningOpt?.id).toBe('reasoning_effort');
    expect(reasoningOpt?.category).toBe('thought_level');
    expect(reasoningOpt?.currentValue).toBe('off');

    expect(modeOpt?.id).toBe('mode');
    expect(modeOpt?.category).toBe('mode');
    expect(modeOpt?.currentValue).toBe('ask');
  });

  it('generates legacy modes list with current active mode', () => {
    const modes = buildLegacyModes('auto-edit');
    expect(modes.currentModeId).toBe('auto-edit');
    expect(modes.availableModes.map((m) => m.id)).toEqual(['ask', 'auto-edit', 'read-only']);
  });
});
