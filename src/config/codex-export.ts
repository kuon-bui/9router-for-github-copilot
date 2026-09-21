import type { ConfiguredModel } from '@/types/product-model';

export interface CodexCatalogReasoningLevel {
  effort: string;
  description: string;
}

export interface CodexCatalogServiceTier {
  id: string;
  name: string;
  description: string;
}

export interface CodexCatalogModel {
  slug: string;
  display_name: string;
  description: string;
  default_reasoning_level?: string;
  supported_reasoning_levels: CodexCatalogReasoningLevel[];
  shell_type: 'unified_exec';
  visibility: 'list';
  supported_in_api: true;
  priority: number;
  additional_speed_tiers: string[];
  service_tiers: CodexCatalogServiceTier[];
  availability_nux: null;
  upgrade: null;
  model_messages: {
    instructions_template: string;
  };
  support_verbosity: false;
  default_verbosity: null;
  apply_patch_tool_type: null;
  truncation_policy: {
    mode: 'tokens';
    limit: number;
  };
  context_window: number;
  input_modalities: string[];
}

export interface CodexExportResult {
  models: ConfiguredModel[];
  catalog: { models: CodexCatalogModel[] };
  catalogJson: string;
  profileToml: string;
  defaultModel: string;
  codexBaseUrl: string;
  warnings: string[];
}

export function toCodexBaseUrl(normalizedBaseUrl: string): string {
  const trimmed = normalizedBaseUrl.trim().replace(/\/+$/, '');
  const withoutV1 = trimmed.replace(/\/v1$/i, '');
  return `${withoutV1}/v1`;
}

export function selectExportModels(models: readonly ConfiguredModel[]): {
  models: ConfiguredModel[];
  skippedDisplayIds: string[];
} {
  const seen = new Set<string>();
  const selected: ConfiguredModel[] = [];
  const skippedDisplayIds: string[] = [];

  for (const entry of models) {
    if (seen.has(entry.modelId)) {
      skippedDisplayIds.push(entry.id);
      continue;
    }

    seen.add(entry.modelId);
    selected.push(entry);
  }

  return { models: selected, skippedDisplayIds };
}

export function buildCodexCatalogModels(
  models: readonly ConfiguredModel[]
): CodexCatalogModel[] {
  return models.map((entry, index) => {
    const fast = entry.serviceTier === 'fast';
    const catalogModel: CodexCatalogModel = {
      slug: entry.modelId,
      display_name: entry.name,
      description: '9router model exported from VS Code',
      supported_reasoning_levels: entry.thinkingEfforts.map((effort) => ({
        effort,
        description: effort
      })),
      shell_type: 'unified_exec',
      visibility: 'list',
      supported_in_api: true,
      priority: index + 1,
      additional_speed_tiers: fast ? ['fast'] : [],
      service_tiers: fast
        ? [{ id: 'priority', name: 'Fast', description: 'Faster tier' }]
        : [],
      availability_nux: null,
      upgrade: null,
      model_messages: {
        instructions_template: 'You are a coding agent connected through 9router.'
      },
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: null,
      truncation_policy: { mode: 'tokens', limit: 10000 },
      context_window: entry.maxInputTokens + entry.maxOutputTokens,
      input_modalities: entry.visionMode === 'off' ? ['text'] : ['text', 'image']
    };

    if (entry.thinkingMode !== 'off') {
      catalogModel.default_reasoning_level = entry.thinkingMode;
    }

    return catalogModel;
  });
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildCodexProfileToml(input: {
  defaultModel: string;
  catalogAbsolutePath: string;
  codexBaseUrl: string;
}): string {
  const model = escapeTomlBasicString(input.defaultModel);
  const catalog = escapeTomlBasicString(input.catalogAbsolutePath);
  const baseUrl = escapeTomlBasicString(input.codexBaseUrl);
  return [
    `model = "${model}"`,
    `model_provider = "9router"`,
    `model_catalog_json = "${catalog}"`,
    '',
    '[model_providers.9router]',
    'name = "9router"',
    `base_url = "${baseUrl}"`,
    'env_key = "NINE_ROUTER_API_KEY"',
    'env_key_instructions = "Set NINE_ROUTER_API_KEY to your 9router API key."',
    'wire_api = "responses"',
    ''
  ].join('\n');
}

export function buildCodexExport(input: {
  models: readonly ConfiguredModel[];
  normalizedBaseUrl: string;
  catalogAbsolutePath: string;
}): CodexExportResult {
  const selected = selectExportModels(input.models);
  const catalogModels = buildCodexCatalogModels(selected.models);
  const defaultModel = selected.models[0]?.modelId ?? '';
  const codexBaseUrl = toCodexBaseUrl(input.normalizedBaseUrl);
  const catalog = { models: catalogModels };
  const warnings =
    selected.skippedDisplayIds.length > 0
      ? [
          `Skipped display models with duplicate modelId values: ${selected.skippedDisplayIds.join(', ')}`
        ]
      : [];

  return {
    models: selected.models,
    catalog,
    catalogJson: `${JSON.stringify(catalog, null, 2)}\n`,
    profileToml: buildCodexProfileToml({
      defaultModel,
      catalogAbsolutePath: input.catalogAbsolutePath,
      codexBaseUrl
    }),
    defaultModel,
    codexBaseUrl,
    warnings
  };
}

export async function mergeCodexConfigToml(
  existingToml: string,
  input: {
    defaultModel: string;
    catalogAbsolutePath: string;
    codexBaseUrl: string;
  }
): Promise<string> {
  // Dynamic import keeps Node16 CJS typechecking happy: smol-toml ships ESM-first types.
  const { parse, stringify } = await import('smol-toml');
  let parsed: Record<string, unknown>;
  try {
    const value = parse(existingToml);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('root must be a table');
    }
    parsed = value as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown parse error';
    throw new Error(`Failed to parse Codex config.toml: ${detail}`, { cause: error });
  }

  const providers =
    typeof parsed.model_providers === 'object' &&
    parsed.model_providers !== null &&
    !Array.isArray(parsed.model_providers)
      ? { ...(parsed.model_providers as Record<string, unknown>) }
      : {};

  providers['9router'] = {
    name: '9router',
    base_url: input.codexBaseUrl,
    env_key: 'NINE_ROUTER_API_KEY',
    env_key_instructions: 'Set NINE_ROUTER_API_KEY to your 9router API key.',
    wire_api: 'responses'
  };

  parsed.model = input.defaultModel;
  parsed.model_provider = '9router';
  parsed.model_catalog_json = input.catalogAbsolutePath;
  parsed.model_providers = providers;

  return `${stringify(parsed).trimEnd()}\n`;
}
