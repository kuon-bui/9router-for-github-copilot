import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { createAgentApp } from './agent-app';
import { loadAgentSettings } from './agent-settings';
import { createStderrLogger } from './stderr-logger';

export function startAgentCli(): void {
  const settings = loadAgentSettings();
  const logger = createStderrLogger(settings.debugMode);

  logger.log('metadata', 'Starting 9router ACP Agent CLI', {
    baseUrl: settings.baseUrl,
    mode: settings.mode,
    timeoutMs: settings.timeoutMs
  });

  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin);
  const stream = acp.ndJsonStream(input, output);
  const app = createAgentApp({ settings, logger });
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
