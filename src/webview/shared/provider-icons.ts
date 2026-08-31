const LOBE_ICON_CDN_BASE =
  'https://unpkg.com/@lobehub/icons-static-svg@latest/icons';

type ProviderIconSlug =
  | 'antigravity'
  | 'claude'
  | 'codebuddy'
  | 'codex'
  | 'copilot'
  | 'deepseek'
  | 'gemini'
  | 'grok'
  | 'kimi'
  | 'kiro'
  | 'minimax'
  | 'ollama'
  | 'openai'
  | 'qoder'
  | 'trae'
  | 'vercel'
  | 'xai'
  | 'zai'
  | 'zhipu';

const COLOR_ICON_SLUGS = new Set<ProviderIconSlug>([
  'antigravity', 'claude', 'codebuddy', 'codex', 'copilot', 'deepseek', 'gemini',
  'kimi', 'kiro', 'minimax', 'qoder', 'trae', 'zhipu'
]);

export interface ProviderIconDescriptor {
  slug: ProviderIconSlug;
  url: string;
}

const PROVIDER_ICON_BY_ID: Readonly<Record<string, ProviderIconSlug>> = {
  ag: 'antigravity', antigravity: 'antigravity', cbai: 'codebuddy', cbcn: 'codebuddy',
  cc: 'claude', claude: 'claude', codebuddy: 'codebuddy', 'codebuddy-cn': 'codebuddy',
  'codebuddy-intl': 'codebuddy', codex: 'codex', copilot: 'copilot', cx: 'codex',
  deepseek: 'deepseek', gc: 'gemini', gemini: 'gemini', 'gemini-cli': 'gemini',
  gh: 'copilot', github: 'copilot', glm: 'zai', 'glm-cn': 'zhipu', grok: 'grok',
  'grok-build': 'grok', 'grok-cli': 'grok', kimi: 'kimi', 'kimi-coding': 'kimi',
  kiro: 'kiro', minimax: 'minimax', 'minimax-cn': 'minimax', ollama: 'ollama',
  openai: 'openai', qoder: 'qoder', trae: 'trae', vercel: 'vercel',
  'vercel-ai-gateway': 'vercel', xai: 'xai'
};

export function resolveProviderIcon(provider: string): ProviderIconDescriptor | undefined {
  const slug = PROVIDER_ICON_BY_ID[provider.trim().toLowerCase()];
  if (!slug) {
    return undefined;
  }

  const variant = COLOR_ICON_SLUGS.has(slug) ? '-color' : '';
  return { slug, url: `${LOBE_ICON_CDN_BASE}/${slug}${variant}.svg` };
}
