import { describe, expect, it } from 'vitest';
import {
  buildCodexCatalogModels,
  buildCodexExport,
  mergeCodexConfigToml,
  selectExportModels,
  toCodexBaseUrl
} from '@/config/codex-export';
import type { ConfiguredModel } from '@/types/product-model';

function model(
  partial: Partial<ConfiguredModel> & Pick<ConfiguredModel, 'id' | 'name' | 'modelId'>
): ConfiguredModel {
  return {
    sourceIndex: partial.sourceIndex ?? 0,
    id: partial.id,
    name: partial.name,
    modelId: partial.modelId,
    toolMode: partial.toolMode ?? 'off',
    visionMode: partial.visionMode ?? 'off',
    thinkingMode: partial.thinkingMode ?? 'off',
    thinkingEfforts: partial.thinkingEfforts ?? [],
    maxInputTokens: partial.maxInputTokens ?? 128_000,
    maxOutputTokens: partial.maxOutputTokens ?? 8_192,
    ...(partial.serviceTier ? { serviceTier: partial.serviceTier } : {})
  };
}

describe('toCodexBaseUrl', () => {
  it('appends a single /v1 to a normalized base URL', () => {
    expect(toCodexBaseUrl('http://127.0.0.1:20128')).toBe('http://127.0.0.1:20128/v1');
  });

  it('does not duplicate /v1 when the normalized value somehow still ends with it', () => {
    expect(toCodexBaseUrl('http://127.0.0.1:20128/v1')).toBe('http://127.0.0.1:20128/v1');
    expect(toCodexBaseUrl('http://127.0.0.1:20128/v1/')).toBe('http://127.0.0.1:20128/v1');
  });
});

describe('selectExportModels', () => {
  it('keeps the first modelId and warns about later duplicates', () => {
    const result = selectExportModels([
      model({ sourceIndex: 0, id: 'agent', name: 'Agent', modelId: 'router/shared' }),
      model({ sourceIndex: 1, id: 'coder', name: 'Coder', modelId: 'router/coder' }),
      model({
        sourceIndex: 2,
        id: 'agent-fast',
        name: 'Agent Fast',
        modelId: 'router/shared',
        serviceTier: 'fast'
      })
    ]);

    expect(result.models.map((entry) => entry.id)).toEqual(['agent', 'coder']);
    expect(result.skippedDisplayIds).toEqual(['agent-fast']);
  });
});

describe('buildCodexCatalogModels', () => {
  it('maps reasoning, vision, and fast-tier fields', () => {
    const catalog = buildCodexCatalogModels([
      model({
        id: 'vision',
        name: 'Vision',
        modelId: 'router/vision',
        visionMode: 'native',
        thinkingMode: 'high',
        thinkingEfforts: ['low', 'high'],
        serviceTier: 'fast',
        maxInputTokens: 1000,
        maxOutputTokens: 200
      }),
      model({
        id: 'plain',
        name: 'Plain',
        modelId: 'router/plain',
        thinkingMode: 'off',
        thinkingEfforts: []
      })
    ]);

    expect(catalog[0]).toMatchObject({
      slug: 'router/vision',
      display_name: 'Vision',
      description: '9router model exported from VS Code',
      default_reasoning_level: 'high',
      supported_reasoning_levels: [
        { effort: 'low', description: 'low' },
        { effort: 'high', description: 'high' }
      ],
      shell_type: 'unified_exec',
      visibility: 'list',
      supported_in_api: true,
      priority: 1,
      additional_speed_tiers: ['fast'],
      service_tiers: [{ id: 'priority', name: 'Fast', description: 'Faster tier' }],
      availability_nux: null,
      upgrade: null,
      model_messages: {
        instructions_template: 'You are a coding agent connected through 9router.'
      },
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: null,
      truncation_policy: { mode: 'tokens', limit: 10000 },
      context_window: 1200,
      input_modalities: ['text', 'image']
    });
    expect(catalog[1]).toMatchObject({
      slug: 'router/plain',
      priority: 2,
      additional_speed_tiers: [],
      service_tiers: [],
      input_modalities: ['text']
    });
    expect(catalog[1]).not.toHaveProperty('default_reasoning_level');
  });
});

describe('buildCodexExport', () => {
  it('builds catalog JSON, profile TOML, default model, and warnings together', () => {
    const result = buildCodexExport({
      models: [
        model({
          id: 'agent',
          name: 'Agent',
          modelId: 'router/agent',
          thinkingMode: 'medium',
          thinkingEfforts: ['medium']
        }),
        model({ id: 'dup', name: 'Dup', modelId: 'router/agent' })
      ],
      normalizedBaseUrl: 'http://127.0.0.1:20128',
      catalogAbsolutePath: 'C:/Users/me/.codex/9router-models.json'
    });

    expect(result.defaultModel).toBe('router/agent');
    expect(result.codexBaseUrl).toBe('http://127.0.0.1:20128/v1');
    expect(result.warnings).toEqual([
      'Skipped display models with duplicate modelId values: dup'
    ]);
    expect(JSON.parse(result.catalogJson)).toEqual({ models: result.catalog.models });
    expect(result.profileToml).toContain('model = "router/agent"');
    expect(result.profileToml).toContain('model_provider = "9router"');
    expect(result.profileToml).toContain(
      'model_catalog_json = "C:/Users/me/.codex/9router-models.json"'
    );
    expect(result.profileToml).toContain('[model_providers.9router]');
    expect(result.profileToml).toContain('base_url = "http://127.0.0.1:20128/v1"');
    expect(result.profileToml).toContain('env_key = "NINE_ROUTER_API_KEY"');
    expect(result.profileToml).toContain(
      'env_key_instructions = "Set NINE_ROUTER_API_KEY to your 9router API key."'
    );
    expect(result.profileToml).toContain('wire_api = "responses"');
    expect(result.profileToml).not.toMatch(/sk-|api[_-]?key\s*=\s*"[^"]+"/i);
  });
});

describe('mergeCodexConfigToml', () => {
  it('upserts 9router provider and top-level keys while preserving unrelated keys', () => {
    const existing = `
model = "other"
model_provider = "openai"
notice = "keep-me"

[model_providers.openai]
name = "OpenAI"
base_url = "https://example.invalid/v1"

[model_providers.9router]
name = "old"
base_url = "http://old.invalid/v1"
env_key = "OLD_KEY"
wire_api = "chat"
`;

    const merged = mergeCodexConfigToml(existing, {
      defaultModel: 'router/agent',
      catalogAbsolutePath: '/home/me/.codex/9router-models.json',
      codexBaseUrl: 'http://127.0.0.1:20128/v1'
    });

    expect(merged).toContain('model = "router/agent"');
    expect(merged).toContain('model_provider = "9router"');
    expect(merged).toContain('model_catalog_json = "/home/me/.codex/9router-models.json"');
    expect(merged).toContain('notice = "keep-me"');
    expect(merged).toContain('[model_providers.openai]');
    expect(merged).toContain('name = "OpenAI"');
    expect(merged).toContain('[model_providers.9router]');
    expect(merged).toContain('base_url = "http://127.0.0.1:20128/v1"');
    expect(merged).toContain('env_key = "NINE_ROUTER_API_KEY"');
    expect(merged).toContain('wire_api = "responses"');
    expect(merged).not.toContain('OLD_KEY');
    expect(merged).not.toMatch(/api[_-]?key\s*=/i);
  });

  it('fails closed on invalid TOML', () => {
    expect(() =>
      mergeCodexConfigToml('model = [', {
        defaultModel: 'router/agent',
        catalogAbsolutePath: '/tmp/9router-models.json',
        codexBaseUrl: 'http://127.0.0.1:20128/v1'
      })
    ).toThrow(/Failed to parse Codex config\.toml/);
  });
});
