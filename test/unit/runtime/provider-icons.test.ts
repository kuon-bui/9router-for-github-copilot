import { describe, expect, it } from 'vitest';
import { resolveProviderIcon } from '@/runtime/provider-icons';

describe('resolveProviderIcon', () => {
  it.each([
    ['antigravity', 'antigravity'],
    ['claude', 'claude'],
    ['codebuddy-cn', 'codebuddy'],
    ['codebuddy-intl', 'codebuddy'],
    ['codex', 'codex'],
    ['deepseek', 'deepseek'],
    ['gemini-cli', 'gemini'],
    ['github', 'copilot'],
    ['glm', 'zai'],
    ['glm-cn', 'zhipu'],
    ['grok-cli', 'grok'],
    ['kimi', 'kimi'],
    ['kiro', 'kiro'],
    ['minimax', 'minimax'],
    ['minimax-cn', 'minimax'],
    ['ollama', 'ollama'],
    ['qoder', 'qoder'],
    ['vercel-ai-gateway', 'vercel']
  ])('maps 9router provider %s to Lobe icon %s', (provider, expectedSlug) => {
    const icon = resolveProviderIcon(provider);

    expect(icon?.slug).toBe(expectedSlug);
    expect(icon?.url).toMatch(
      new RegExp(
        `^https://unpkg\\.com/@lobehub/icons-static-svg@latest/icons/${expectedSlug}(?:-color)?\\.svg$`
      )
    );
  });

  it.each([
    ['cx', 'codex'],
    ['cbcn', 'codebuddy'],
    ['cbai', 'codebuddy'],
    ['cc', 'claude'],
    ['gc', 'gemini'],
    ['gh', 'copilot'],
    ['grok-build', 'grok'],
    ['kimi-coding', 'kimi'],
    ['vercel', 'vercel'],
    ['xai', 'xai'],
    ['openai', 'openai'],
    ['trae', 'trae']
  ])('supports provider alias %s with Lobe icon %s', (provider, expectedSlug) => {
    expect(resolveProviderIcon(` ${provider.toUpperCase()} `)?.slug).toBe(expectedSlug);
  });

  it('uses color variants when available and mono variants otherwise', () => {
    expect(resolveProviderIcon('codex')?.url).toBe(
      'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/codex-color.svg'
    );
    expect(resolveProviderIcon('grok')?.url).toBe(
      'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/grok.svg'
    );
  });

  it.each(['zed', 'custom-router', ''])('falls back when %s has no Lobe icon', (provider) => {
    expect(resolveProviderIcon(provider)).toBeUndefined();
  });
});
