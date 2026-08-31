import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ModelForm } from './ModelForm';
import { ModelList } from './ModelList';
import type { ModelDraft } from '@/config/model-draft';
import type { ModelEditorState } from '@/runtime/model-editor-view';
import type { ModelEditorHostMessage, VsCodeApi } from '@/webview/shared/protocol';

const EMPTY_STATE: ModelEditorState = { models: [], catalog: [], warnings: [], thinkingModes: [], thinkingEfforts: [], defaultMaxInputTokens: 0, defaultMaxOutputTokens: 0 };

export function ModelEditor({ api }: { api: VsCodeApi }): JSX.Element {
  const [state, setState] = useState<ModelEditorState>(EMPTY_STATE);
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [, setPendingSave] = useState(false);
  useEffect(() => {
    const onMessage = (event: MessageEvent<ModelEditorHostMessage>): void => {
      const message = event.data;
      if (message.type === 'state') { setState(message.state); setError(''); setPendingSave((pending) => { if (pending) setEditing(undefined); return false; }); }
      if (message.type === 'showForm') { setEditing(null); setError(''); }
      if (message.type === 'error') { setPendingSave(false); setError(message.message); }
    };
    window.addEventListener('message', onMessage);
    api.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [api]);
  if (editing === undefined) return <ModelList state={state} onEdit={(sourceIndex) => { setError(''); setEditing(sourceIndex); }} onRemove={(sourceIndex) => api.postMessage({ type: 'removeModel', sourceIndex })} onMove={(sourceIndex, direction) => api.postMessage({ type: 'moveModel', sourceIndex, direction })} />;
  const row = state.models.find((model) => model.sourceIndex === editing);
  return <ModelForm key={editing ?? 'new'} state={state} row={row} error={error} onCancel={() => { setError(''); setEditing(undefined); }} onSave={(draft: ModelDraft) => { setError(''); setPendingSave(true); api.postMessage({ type: 'saveModel', sourceIndex: editing, draft }); }} />;
}
