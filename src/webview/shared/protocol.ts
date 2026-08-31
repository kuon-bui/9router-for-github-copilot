import type { RouterUsageSnapshot } from '@/router/usage';

export interface UsageStateMessage {
  readonly type: 'usage';
  readonly snapshot: RouterUsageSnapshot;
  readonly nowMs: number;
}

export interface ReadyMessage {
  readonly type: 'ready';
}

export type UsageHostMessage = UsageStateMessage;
export type UsageClientMessage = ReadyMessage;

export interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}
