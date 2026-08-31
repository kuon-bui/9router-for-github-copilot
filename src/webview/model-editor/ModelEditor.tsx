import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { ModelForm } from './ModelForm';
import { ModelList } from './ModelList';
import type { ModelDraft } from '@/config/model-draft';
import type { ModelEditorState } from '@/types/model-editor';
import type { ModelEditorHostMessage, VsCodeApi } from '@/webview/shared/protocol';

const EMPTY_STATE: ModelEditorState = {
  models: [],
  catalog: [],
  warnings: [],
  thinkingModes: [],
  thinkingEfforts: [],
  defaultMaxInputTokens: 0,
  defaultMaxOutputTokens: 0
};

interface ModelEditorProps {
  readonly api: VsCodeApi;
}

export function ModelEditor({ api }: ModelEditorProps): JSX.Element {
  const [state, setState] = useState<ModelEditorState>(EMPTY_STATE);
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [, setPendingSave] = useState(false);

  useEffect(() => {
    function handleMessage(event: MessageEvent<ModelEditorHostMessage>): void {
      const message = event.data;
      if (message.type === 'state') {
        setState(message.state);
        setError('');
        setPendingSave((pending) => {
          if (pending) {
            setEditing(undefined);
          }
          return false;
        });
      }
      if (message.type === 'showForm') {
        setEditing(null);
        setError('');
      }
      if (message.type === 'error') {
        setPendingSave(false);
        setError(message.message);
      }
    }

    window.addEventListener('message', handleMessage);
    api.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handleMessage);
  }, [api]);

  function handleAdd(): void {
    setError('');
    setEditing(null);
  }

  function handleEdit(sourceIndex: number): void {
    setError('');
    setEditing(sourceIndex);
  }

  function handleCancel(): void {
    setError('');
    setEditing(undefined);
  }

  function handleSave(draft: ModelDraft): void {
    setError('');
    setPendingSave(true);
    api.postMessage({ type: 'saveModel', sourceIndex: editing ?? null, draft });
  }

  if (editing === undefined) {
    return (
      <ModelList
        state={state}
        error={error}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onRemove={(sourceIndex) => api.postMessage({ type: 'removeModel', sourceIndex })}
        onMove={(sourceIndex, direction) =>
          api.postMessage({ type: 'moveModel', sourceIndex, direction })
        }
        onRefreshCatalog={() => api.postMessage({ type: 'refreshCatalog' })}
      />
    );
  }

  const row = state.models.find((model) => model.sourceIndex === editing);
  return (
    <ModelForm
      key={editing ?? 'new'}
      state={state}
      row={row}
      error={error}
      onCancel={handleCancel}
      onSave={handleSave}
    />
  );
}
