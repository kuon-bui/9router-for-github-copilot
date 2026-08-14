import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../../package.json';

describe('release guardrails', () => {
  it('contributes one ordered dynamic model setting with a safe agent default', () => {
    const properties = manifest.contributes.configuration.properties as Record<string, unknown>;
    const models = properties['9router-copilot.models'] as {
      type: string;
      default: unknown[];
      items: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
          service_tier: Record<string, unknown>;
          thinkingEfforts: Record<string, unknown>;
          maxInputTokens: Record<string, unknown>;
          maxOutputTokens: Record<string, unknown>;
        };
      };
    };

    expect(models).toMatchObject({
      type: 'array',
      default: [
        {
          id: 'agent',
          name: 'Agent',
          modelId: '',
          toolMode: 'auto',
          visionMode: 'off',
          thinkingMode: 'off',
          thinkingEfforts: []
        }
      ],
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'modelId']
      }
    });
    expect(models.items.properties.service_tier).toMatchObject({
      type: 'string',
      enum: ['fast']
    });
    expect(models.items.properties.thinkingEfforts).toMatchObject({
      type: 'array',
      default: [],
      uniqueItems: true,
      items: {
        type: 'string',
        enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
      }
    });
    expect(models.items.properties.maxInputTokens).toMatchObject({
      type: 'integer',
      minimum: 1,
      default: 264_000,
      description: expect.stringContaining('fallback')
    });
    expect(models.items.properties.maxOutputTokens).toMatchObject({
      type: 'integer',
      minimum: 1,
      default: 264_000,
      description: expect.stringContaining('fallback')
    });
    expect(properties['9router-copilot.visionProxyModelId']).toMatchObject({
      type: 'string',
      default: '',
      description: expect.stringContaining('selected Vision proxy source')
    });
    expect(
      String(
        (properties['9router-copilot.visionProxyModelId'] as { description?: string })
          .description
      )
    ).not.toContain('9router model id');
    expect(properties['9router-copilot.visionProxySource']).toMatchObject({
      type: 'string',
      enum: ['', '9router', 'copilot'],
      default: ''
    });
    expect(properties['9router-copilot.visionProxyPrompt']).toMatchObject({
      type: 'string',
      minLength: 1
    });
    expect(manifest.contributes.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: '9routerCopilot.testConnection' }),
        expect.objectContaining({ command: '9routerCopilot.configureVisionProxy' })
      ])
    );
  });

  it('defaults maxTokens to unlimited', () => {
    const properties = manifest.contributes.configuration.properties as Record<string, unknown>;

    expect(properties['9router-copilot.maxTokens']).toMatchObject({
      type: 'integer',
      minimum: 0,
      default: 0
    });
  });

  it('does not contribute legacy fixed-model settings', () => {
    const properties = manifest.contributes.configuration.properties as Record<string, unknown>;
    const legacyKeys = [
      '9router-copilot.displayModels',
      '9router-copilot.labels.daily',
      '9router-copilot.modelMappings.agent',
      '9router-copilot.toolMode.agent',
      '9router-copilot.visionMode.agent',
      '9router-copilot.visionProxyComboId',
      '9router-copilot.thinkingMode.agent',
      '9router-copilot.maxInputTokens.agent',
      '9router-copilot.maxOutputTokens.agent'
    ];

    for (const key of legacyKeys) {
      expect(properties).not.toHaveProperty(key);
    }
  });

  it('documents the breaking dynamic model contract without legacy settings', async () => {
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
    const productionDesign = await readFile(
      resolve(
        process.cwd(),
        'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
      ),
      'utf8'
    );
    const agentGuidance = await readFile(resolve(process.cwd(), 'AGENTS.md'), 'utf8');
    const convention = await readFile(resolve(process.cwd(), 'CODE_CONVENTION.md'), 'utf8');

    for (const document of [readme, productionDesign, agentGuidance, convention]) {
      expect(document).toContain('user-defined curated');
    }
    expect(readme).toContain('9router-copilot.models');
    expect(readme).toContain('"modelId"');
    for (const text of [
      '9router-copilot.visionProxySource',
      '9router-copilot.visionProxyModelId',
      '9router-copilot.visionProxyPrompt',
      '9router: Configure Vision Proxy',
      'capabilities.vision',
      'GitHub Copilot'
    ]) {
      expect(readme).toContain(text);
      expect(productionDesign).toContain(text);
    }
    for (const document of [readme, productionDesign]) {
      expect(document).toContain('GET /v1/models');
      expect(document).toContain('fail-closed');
    }
    expect(readme).toContain('Breaking configuration change');
    expect(readme).toContain('toolMode');
    expect(readme).toContain('visionMode');
    expect(readme).toContain('thinkingMode');
    expect(readme).toContain('thinkingEfforts');
    expect(readme).toContain('maxInputTokens');
    expect(readme).toContain('maxOutputTokens');
    expect(readme).toContain('reasoning_effort');
    expect(readme).toContain('stream_options.include_usage');
    for (const document of [readme, productionDesign]) {
      expect(document).toContain('capabilities.contextWindow');
      expect(document).toContain('capabilities.maxOutput');
      expect(document).toContain('total context size');
      expect(document).toContain('maxInputTokens = contextWindow - maxOutputTokens');
      expect(document).toContain('latest successful');
      expect(document).toContain('264000');
      expect(document).toContain('thinkingEfforts');
      expect(document).toContain('array order');
      expect(document).toContain('omits `configurationSchema`');
      expect(document).toContain('stale');
    }
    expect(readme).toContain('compatibility fallback');
    expect(readme).not.toContain('9router-copilot.displayModels');
    expect(readme).not.toContain('9router-copilot.modelMappings.');
  });

  it('documents unlimited maxTokens semantics', async () => {
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
    const productionDesign = await readFile(
      resolve(
        process.cwd(),
        'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
      ),
      'utf8'
    );

    for (const document of [readme, productionDesign]) {
      expect(document).toContain('default is `0`');
      expect(document).toContain('positive safe integer');
      expect(document).toContain('omits `max_tokens`');
      expect(document).toContain('upstream');
    }
  });

  it('keeps the VSIX package command explicit about local repository metadata', () => {
    const packageCommand = manifest.scripts.package;
    const hasRepositoryMetadata = 'repository' in manifest;

    expect(packageCommand).toContain('vsce package');
    expect(packageCommand).toContain('--no-dependencies');
    expect(hasRepositoryMetadata || packageCommand.includes('--allow-missing-repository')).toBe(true);
  });

  it('ships an explicit license artifact matching the private package policy', async () => {
    await expect(access(resolve(process.cwd(), 'LICENSE'), constants.R_OK)).resolves.toBeUndefined();

    const license = await readFile(resolve(process.cwd(), 'LICENSE'), 'utf8');
    expect(manifest.license).toBe('UNLICENSED');
    expect(license).toContain('UNLICENSED');
    expect(license).toContain('not licensed for copying');
  });

  it('keeps source, tests, and internal docs out of the packaged VSIX', async () => {
    const vscodeIgnore = await readFile(resolve(process.cwd(), '.vscodeignore'), 'utf8');

    expect(vscodeIgnore).toContain('.vscode/**');
    expect(vscodeIgnore).toContain('src/**');
    expect(vscodeIgnore).toContain('test/**');
    expect(vscodeIgnore).toContain('docs/**');
    expect(vscodeIgnore).toContain('AGENTS.md');
    expect(vscodeIgnore).toContain('CODE_CONVENTION.md');
    expect(vscodeIgnore).toContain('pnpm-lock.yaml');
    expect(vscodeIgnore).toContain('tsconfig.json');
    expect(vscodeIgnore).not.toContain('dist/src/**');
  });

  it('keeps subagent workflow artifacts out of the packaged VSIX', async () => {
    const vscodeIgnore = await readFile(resolve(process.cwd(), '.vscodeignore'), 'utf8');

    expect(vscodeIgnore).toContain('.superpowers/**');
  });

  it('keeps VS Code debug workspace assets available for local extension development', async () => {
    const launchPath = resolve(process.cwd(), '.vscode/launch.json');
    const tasksPath = resolve(process.cwd(), '.vscode/tasks.json');

    await expect(access(launchPath, constants.R_OK)).resolves.toBeUndefined();
    await expect(access(tasksPath, constants.R_OK)).resolves.toBeUndefined();

    const launchJson = JSON.parse(await readFile(launchPath, 'utf8')) as {
      configurations?: Array<{ name?: string }>;
    };

    expect(launchJson.configurations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Watch and Debug Extension'
        }),
        expect.objectContaining({
          name: 'Build Once and Debug Extension'
        })
      ])
    );
  });

  it('documents the VS Code debug workflow for local development', async () => {
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('## Debug in VS Code');
    expect(readme).toContain('Watch and Debug Extension');
    expect(readme).toContain('Build Once and Debug Extension');
    expect(readme).toContain('9router Copilot');
  });
});
