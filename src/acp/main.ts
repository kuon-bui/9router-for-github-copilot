import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

export function createSpikeAgent() {
  return acp
    .agent({ name: '9router-acp' })
    .onRequest('initialize', async () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: {
        name: '9router-acp',
        title: '9router',
        version: '0.15.0'
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
    }));
}

export function startAgentCli(): void {
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin);
  const stream = acp.ndJsonStream(input, output);
  const app = createSpikeAgent();
  app.connect(stream);
}

declare const require: {
  main?: unknown;
};
declare const module: unknown;

export function isDirectExecution(): boolean {
  return typeof require !== 'undefined' && require.main === module;
}

if (isDirectExecution()) {
  startAgentCli();
}
