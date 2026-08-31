import type { RouterUsageSnapshot } from '@/router/usage';
import type { ModelDraft } from '@/config/model-draft';
import type { ModelEditorState } from '@/runtime/model-editor-view';

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

export interface ModelEditorStateMessage {
  readonly type: 'state';
  readonly state: ModelEditorState;
}

export interface ModelEditorShowFormMessage {
  readonly type: 'showForm';
}

export interface ModelEditorErrorMessage {
  readonly type: 'error';
  readonly message: string;
}

export type ModelEditorHostMessage =
  | ModelEditorStateMessage
  | ModelEditorShowFormMessage
  | ModelEditorErrorMessage;

export interface SaveModelMessage {
  readonly type: 'saveModel';
  readonly sourceIndex: number | null;
  readonly draft: ModelDraft;
}

export interface RemoveModelMessage {
  readonly type: 'removeModel';
  readonly sourceIndex: number;
}

export interface MoveModelMessage {
  readonly type: 'moveModel';
  readonly sourceIndex: number;
  readonly direction: 'up' | 'down';
}

export interface RefreshCatalogMessage {
  readonly type: 'refreshCatalog';
}

export type ModelEditorClientMessage =
  | ReadyMessage
  | SaveModelMessage
  | RemoveModelMessage
  | MoveModelMessage
  | RefreshCatalogMessage;

export interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}
