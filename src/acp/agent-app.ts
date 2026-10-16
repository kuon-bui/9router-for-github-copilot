import * as acp from '@agentclientprotocol/sdk';
import { getAgentInitializeResponse } from './capabilities';
import type { AgentSettings } from './agent-settings';
import type { StderrLogger } from './stderr-logger';

export interface AgentAppDependencies {
  settings: AgentSettings;
  logger: StderrLogger;
  version?: string;
}

export function createAgentApp(deps: AgentAppDependencies): acp.AgentApp {
  const version = deps.version ?? '0.15.0';

  return acp
    .agent({ name: '9router-acp' })
    .onRequest('initialize', async () => {
      deps.logger.log('metadata', 'Client initialized agent');
      return getAgentInitializeResponse(version);
    });
}
