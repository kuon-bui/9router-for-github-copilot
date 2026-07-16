import { describe, expect, it, vi } from 'vitest';
import { prepareVisionCompatibleMessages } from '../../../src/provider/vision-proxy';

describe('prepareVisionCompatibleMessages', () => {
  it('injects a generated image summary when visionMode is proxy', async () => {
    const summarizeImageInputs = vi.fn().mockResolvedValue('Image summary: architecture diagram');

    const output = await prepareVisionCompatibleMessages({
      selectedModel: {
        key: 'agent',
        label: 'Agent',
        comboId: 'combo/agent',
        enabled: true,
        toolMode: 'off',
        visionMode: 'proxy',
        thinkingMode: 'off'
      },
      messages: [{ role: 1, content: [{ mimeType: 'image/png' }] }],
      summarizeImageInputs
    });

    expect(output.outcome).toBe('vision-proxied');
    expect(String(output.messages[0]?.content)).toContain('Image summary: architecture diagram');
  });

  it('keeps image inputs untouched when the selected model supports native vision', async () => {
    const summarizeImageInputs = vi.fn().mockResolvedValue('should not be used');
    const imagePart = { mimeType: 'image/png', data: 'base64-image' };

    const output = await prepareVisionCompatibleMessages({
      selectedModel: {
        key: 'agent',
        label: 'Agent Vision',
        comboId: 'combo/agent-vision',
        enabled: true,
        toolMode: 'off',
        visionMode: 'native',
        thinkingMode: 'off'
      },
      messages: [{ role: 1, content: ['Inspect this image', imagePart] }],
      summarizeImageInputs
    });

    expect(output.outcome).toBe('native-vision');
    expect(output.messages[0]?.content).toEqual(['Inspect this image', imagePart]);
    expect(summarizeImageInputs).not.toHaveBeenCalled();
  });

  it('marks image inputs as blocked when vision is disabled for the selected model', async () => {
    const output = await prepareVisionCompatibleMessages({
      selectedModel: {
        key: 'daily',
        label: 'Daily',
        comboId: 'combo/daily',
        enabled: true,
        toolMode: 'off',
        visionMode: 'off',
        thinkingMode: 'off'
      },
      messages: [{ role: 1, content: [{ mimeType: 'image/png' }] }]
    });

    expect(output.outcome).toBe('vision-blocked');
    expect(output.blockReason).toContain('visionMode is off');
  });
});
