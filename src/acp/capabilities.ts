import * as acp from '@agentclientprotocol/sdk';

export function getAgentInitializeResponse(version = '0.15.0'): acp.InitializeResponse {
  return {
    protocolVersion: acp.PROTOCOL_VERSION,
    agentInfo: {
      name: '9router-acp',
      title: '9router',
      version
    },
    authMethods: [],
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: {
        image: false,
        audio: false,
        embeddedContext: true
      },
      mcpCapabilities: {
        http: true,
        sse: false
      },
      sessionCapabilities: {
        close: {}
      }
    }
  };
}
