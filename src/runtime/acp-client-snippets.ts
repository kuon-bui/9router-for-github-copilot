export type AcpSnippetTarget = 'zed' | 'jetbrains' | 'vscode';

export interface GenerateAcpSnippetOptions {
  target: AcpSnippetTarget;
  version: string;
  baseUrl: string;
  apiKey: string;
  modelId?: string | undefined;
}

export function generateAcpSnippet(options: GenerateAcpSnippetOptions): string {
  const { target, version, baseUrl, apiKey, modelId } = options;

  const env: Record<string, string> = {
    NINEROUTER_API_KEY: apiKey,
    NINEROUTER_BASE_URL: baseUrl
  };

  if (modelId) {
    env['NINEROUTER_MODEL'] = modelId;
  }

  const agentConfig: Record<string, unknown> = {
    command: 'npx',
    args: ['-y', `9router-acp@${version}`],
    env
  };

  let rootObj: Record<string, unknown>;

  if (target === 'zed') {
    rootObj = {
      agent_servers: {
        '9router': {
          type: 'custom',
          ...agentConfig
        }
      }
    };
  } else if (target === 'jetbrains') {
    rootObj = {
      agent_servers: {
        '9router': agentConfig
      }
    };
  } else {
    rootObj = {
      'acp.agents': {
        '9router': agentConfig
      }
    };
  }

  return JSON.stringify(rootObj, null, 2);
}
