import * as acp from '@agentclientprotocol/sdk';
import { getAgentInitializeResponse } from './capabilities';
import { buildAcpConfigOptions, buildLegacyModes } from './config-options';
import { createAuthRequiredError, createInvalidParamsError } from './errors';
import { createModelCatalogCache } from './model-catalog-cache';
import { createSessionStore } from './session-store';
import { executePromptTurn } from './turn-runner';
import { createRouterClient } from '@/router/client';
import type { AgentSettings } from './agent-settings';
import type { ModelCatalogCache } from './model-catalog-cache';
import type { PromptContentBlock } from './prompt-content';
import type { SessionStore } from './session-store';
import type { StderrLogger } from './stderr-logger';
import type { RouterClient } from '@/router/client';
import type { AcpAgentMode, AcpReasoningEffort } from '@/types/acp-agent-contract';

export interface AgentAppDependencies {
  settings: AgentSettings;
  logger: StderrLogger;
  client?: RouterClient | undefined;
  sessionStore?: SessionStore | undefined;
  catalogCache?: ModelCatalogCache | undefined;
  version?: string | undefined;
}

export function createAgentApp(deps: AgentAppDependencies): acp.AgentApp {
  const version = deps.version ?? '0.15.0';
  const client = deps.client ?? createRouterClient({ fetch: globalThis.fetch });
  const sessionStore = deps.sessionStore ?? createSessionStore(deps.settings);
  const catalogCache = deps.catalogCache ?? createModelCatalogCache();
  const { settings, logger } = deps;

  return acp
    .agent({ name: '9router-acp' })
    .onRequest('initialize', async () => {
      logger.log('metadata', 'Client initialized agent');
      return getAgentInitializeResponse(version);
    })
    .onRequest('session/new', async (ctx) => {
      if (!settings.apiKey) {
        throw createAuthRequiredError();
      }

      const cwd = ctx.params.cwd;
      const session = sessionStore.createSession({
        cwd,
        mcpServers: ctx.params.mcpServers as unknown[] | undefined
      });

      const models = await catalogCache.getModels(client, settings.apiKey, settings.baseUrl);
      if (!session.model) {
        session.model = settings.defaultModel ?? models[0]?.id ?? '';
      }

      logger.log('metadata', 'Session created', {
        sessionId: session.sessionId,
        cwd: session.cwd,
        model: session.model
      });

      const configOptions = buildAcpConfigOptions({
        models,
        currentModel: session.model,
        currentReasoningEffort: session.reasoningEffort,
        currentMode: session.mode
      });

      return {
        sessionId: session.sessionId,
        modes: buildLegacyModes(session.mode),
        configOptions
      };
    })
    .onRequest('session/prompt', async (ctx) => {
      const session = sessionStore.getSession(ctx.params.sessionId);
      if (!session) {
        throw createInvalidParamsError(`Session ${ctx.params.sessionId} not found`);
      }

      logger.log('metadata', 'Session prompt started', {
        sessionId: session.sessionId,
        turnBlocks: ctx.params.prompt.length
      });

      const result = await executePromptTurn({
        session,
        client,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        timeoutMs: settings.timeoutMs,
        turnSignal: ctx.signal,
        prompt: ctx.params.prompt as PromptContentBlock[],
        notifyClient: async (method, params) => {
          await ctx.client.notify(method as 'session/update', params as acp.ClientNotificationParamsByMethod['session/update']);
        }
      });

      logger.log('metadata', 'Session prompt completed', {
        sessionId: session.sessionId,
        stopReason: result.stopReason
      });

      return {
        stopReason: result.stopReason
      };
    })
    .onNotification('session/cancel', (ctx) => {
      logger.log('metadata', 'Session cancel requested', {
        sessionId: ctx.params.sessionId
      });
      sessionStore.cancelTurn(ctx.params.sessionId);
    })
    .onRequest('session/close', async (ctx) => {
      logger.log('metadata', 'Session close requested', {
        sessionId: ctx.params.sessionId
      });
      sessionStore.closeSession(ctx.params.sessionId);
      return {};
    })
    .onRequest('session/set_mode', async (ctx) => {
      const session = sessionStore.getSession(ctx.params.sessionId);
      if (!session) {
        throw createInvalidParamsError(`Session ${ctx.params.sessionId} not found`);
      }

      const newMode = ctx.params.modeId as AcpAgentMode;
      session.mode = newMode;

      logger.log('metadata', 'Session mode updated', {
        sessionId: session.sessionId,
        mode: session.mode
      });

      const models = settings.apiKey
        ? await catalogCache.getModels(client, settings.apiKey, settings.baseUrl)
        : [];
      const configOptions = buildAcpConfigOptions({
        models,
        currentModel: session.model,
        currentReasoningEffort: session.reasoningEffort,
        currentMode: session.mode
      });

      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'current_mode_update',
          modeId: session.mode
        }
      });

      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'config_option_update',
          configOptions
        }
      });

      return {};
    })
    .onRequest('session/set_config_option', async (ctx) => {
      const session = sessionStore.getSession(ctx.params.sessionId);
      if (!session) {
        throw createInvalidParamsError(`Session ${ctx.params.sessionId} not found`);
      }

      const { configId, value } = ctx.params;
      if (configId === 'model' && typeof value === 'string') {
        session.model = value;
      } else if (configId === 'reasoning_effort' && typeof value === 'string') {
        session.reasoningEffort = value as AcpReasoningEffort;
      } else if (configId === 'mode' && typeof value === 'string') {
        session.mode = value as AcpAgentMode;
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: session.sessionId,
          update: {
            sessionUpdate: 'current_mode_update',
            modeId: session.mode
          }
        });
      }

      logger.log('metadata', 'Session config option updated', {
        sessionId: session.sessionId,
        configId,
        value
      });

      const models = settings.apiKey
        ? await catalogCache.getModels(client, settings.apiKey, settings.baseUrl)
        : [];
      const configOptions = buildAcpConfigOptions({
        models,
        currentModel: session.model,
        currentReasoningEffort: session.reasoningEffort,
        currentMode: session.mode
      });

      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'config_option_update',
          configOptions
        }
      });

      return {
        configOptions
      };
    });
}
