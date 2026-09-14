import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '@root/package.json';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '@/config/defaults';

describe('release guardrails', () => {
  it('contributes the documented 60 second request timeout default', () => {
    const properties = manifest.contributes.configuration.properties as Record<string, unknown>;
    const timeout = properties['9router-copilot.requestTimeoutMs'] as { default: number };

    expect(timeout.default).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it('contributes the manage models command', () => {
    const commands = manifest.contributes.commands as Array<{ command: string; title: string }>;

    expect(commands).toContainEqual({
      command: '9routerCopilot.manageModels',
      title: '9router: Manage Models'
    });
  });

  it('contributes the add model command', () => {
    const commands = manifest.contributes.commands as Array<{ command: string; title: string }>;

    expect(commands).toContainEqual({
      command: '9routerCopilot.addModel',
      title: '9router: Add Model'
    });
  });

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
          serviceTier: Record<string, unknown>;
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
    expect(models.items.properties.serviceTier).toMatchObject({
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
        expect.objectContaining({ command: '9routerCopilot.showUsage' }),
        expect.objectContaining({ command: '9routerCopilot.configureVisionProxy' })
      ])
    );
    expect(manifest.contributes.chatParticipants).toEqual([
      expect.objectContaining({
        id: '9router-copilot.9router',
        name: '9router',
        commands: [expect.objectContaining({ name: 'usage' })]
      })
    ]);
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

  it('documents the user-facing model workflow and highlights', async () => {
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

    for (const document of [productionDesign, agentGuidance, convention]) {
      expect(document).toContain('user-defined curated');
    }
    for (const text of [
      '## Why use it?',
      '## Quick start',
      '## Feature highlights',
      '9router: Set API Key',
      '9router: Manage Models',
      '9router: Configure Vision Proxy',
      '9router: Show Usage',
      '9router: Show Diagnostics',
      '![Manage and organize 9router models in VS Code](./media/model-manager.png)',
      '![Choose Thinking Effort in GitHub Copilot Chat](./media/thinking-effort.png)',
      '![Configure a Vision proxy for image requests](./media/vision-setup.png)',
      '![View connection quotas and reset times](./media/usage-dashboard.png)'
    ]) {
      expect(readme).toContain(text);
    }
    expect(readme).toContain('GitHub Copilot Chat');
    expect(readme).not.toContain('9router-copilot.displayModels');
    expect(readme).not.toContain('9router-copilot.modelMappings.');
  });

  it('keeps unlimited maxTokens semantics in the production design', async () => {
    const productionDesign = await readFile(
      resolve(
        process.cwd(),
        'docs/superpowers/specs/2026-07-15-9router-copilot-chat-provider-production-design.md'
      ),
      'utf8'
    );

    expect(productionDesign).toContain('default is `0`');
    expect(productionDesign).toContain('positive safe integer');
    expect(productionDesign).toContain('omits `max_output_tokens`');
    expect(productionDesign).toContain('upstream');
  });

  it('keeps the VSIX package command explicit about local repository metadata', () => {
    const packageCommand = manifest.scripts.package;
    const hasRepositoryMetadata = 'repository' in manifest;

    expect(packageCommand).toContain('vsce package');
    expect(packageCommand).toContain('--no-dependencies');
    expect(hasRepositoryMetadata || packageCommand.includes('--allow-missing-repository')).toBe(true);
  });

  it('bundles source aliases before packaging', () => {
    expect(manifest.main).toBe('./dist/src/extension.js');
    expect(manifest.scripts.build).toContain('tsc -p tsconfig.json');
    expect(manifest.scripts.build).toContain('node scripts/build.mjs');
    expect(manifest.scripts['vscode:prepublish']).toBe('pnpm run build');
  });

  it('ships an explicit license artifact matching the private package policy', async () => {
    await expect(access(resolve(process.cwd(), 'LICENSE'), constants.R_OK)).resolves.toBeUndefined();

    const license = await readFile(resolve(process.cwd(), 'LICENSE'), 'utf8');
    expect(manifest.license).toBe('MIT');
    expect(license).toContain('MIT License');
  });

  it('keeps source, tests, and internal docs out of the packaged VSIX', async () => {
    const vscodeIgnore = await readFile(resolve(process.cwd(), '.vscodeignore'), 'utf8');

    expect(vscodeIgnore).toContain('.vscode/**');
    expect(vscodeIgnore).toContain('src/**');
    expect(vscodeIgnore).toContain('test/**');
    expect(vscodeIgnore).toContain('docs/**');
    expect(vscodeIgnore).toContain('.pnpm-store/**');
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

  it('documents the basic VS Code development workflow', async () => {
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');

    expect(readme).toContain('## Development');
    expect(readme).toContain('pnpm run build');
    expect(readme).toContain('pnpm run test');
    expect(readme).toContain('Press `F5`');
  });
});
