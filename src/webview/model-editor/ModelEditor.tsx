import type { JSX } from 'react';
import { flushSync } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { ModelForm } from './ModelForm';
import { ModelList } from './ModelList';
import { buildRowKeys, matchesRowTransition } from './view-model';
import type { RowTransitionIntent } from './view-model';
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
  // sourceIndex of the row a delete was just requested for. Flushed to the DOM
  // on click so it is already there when the view transition later captures
  // the "old" snapshot; that is what gives this one row the exit animation
  // instead of the reposition every other row gets (see controls.scss).
  const [exitingSourceIndex, setExitingSourceIndex] = useState<number | null>(null);
  // What the last move/remove click asked for. The next state message runs
  // inside a view transition only if it is recognisably that change.
  const intentRef = useRef<RowTransitionIntent | null>(null);
  // Latest state, for the message listener that is registered once.
  const stateRef = useRef<ModelEditorState>(EMPTY_STATE);

  useEffect(() => {
    function applyState(nextState: ModelEditorState): void {
      setState(nextState);
      setError('');
      setExitingSourceIndex(null);
      setPendingSave((pending) => {
        if (pending) {
          setEditing(undefined);
        }
        return false;
      });
    }

    function handleMessage(event: MessageEvent<ModelEditorHostMessage>): void {
      const message = event.data;
      if (message.type === 'state') {
        const intent = intentRef.current;
        const previousKeys = buildRowKeys(stateRef.current.models);
        intentRef.current = null;
        stateRef.current = message.state;
        const shouldAnimate =
          intent !== null &&
          matchesRowTransition(intent, previousKeys, buildRowKeys(message.state.models));
        if (shouldAnimate && typeof document.startViewTransition === 'function') {
          document.startViewTransition(() => flushSync(() => applyState(message.state)));
        } else {
          applyState(message.state);
        }
      }
      if (message.type === 'showForm') {
        intentRef.current = null;
        setExitingSourceIndex(null);
        setEditing(null);
        setError('');
      }
      if (message.type === 'error') {
        intentRef.current = null;
        setExitingSourceIndex(null);
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

  function handleRemove(sourceIndex: number): void {
    const position = state.models.findIndex((model) => model.sourceIndex === sourceIndex);
    const key = buildRowKeys(state.models)[position];
    intentRef.current = key === undefined ? null : { kind: 'remove', key };
    flushSync(() => setExitingSourceIndex(sourceIndex));
    api.postMessage({ type: 'removeModel', sourceIndex });
  }

  function handleMove(sourceIndex: number, direction: 'up' | 'down'): void {
    intentRef.current = { kind: 'move' };
    // A cancelled delete leaves its exit tag behind; a moving row must not
    // carry it into the transition or it would slide out while it stays.
    flushSync(() => setExitingSourceIndex(null));
    api.postMessage({ type: 'moveModel', sourceIndex, direction });
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
        exitingSourceIndex={exitingSourceIndex}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onRemove={handleRemove}
        onMove={handleMove}
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
