import type { JSX } from 'react';
import { buildModelListView } from './view-model';
import type { ChipTone } from './view-model';
import type { ModelEditorState } from '@/types/model-editor';

const CHIP_CLASS: Record<ChipTone, string> = {
  plain: 'ui-chip bg-badge text-badge-fg',
  warn: 'ui-chip bg-warn-bg text-fg',
  bad: 'ui-chip bg-err-bg text-err-fg'
};

interface ModelListProps {
  readonly state: ModelEditorState;
  readonly error: string;
  readonly onAdd: () => void;
  readonly onEdit: (sourceIndex: number) => void;
  readonly onRemove: (sourceIndex: number) => void;
  readonly onMove: (sourceIndex: number, direction: 'up' | 'down') => void;
  readonly onRefreshCatalog: () => void;
}

export function ModelList({
  state,
  error,
  onAdd,
  onEdit,
  onRemove,
  onMove,
  onRefreshCatalog
}: ModelListProps): JSX.Element {
  const rows = buildModelListView(state);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[13px]">9router models</h2>
        <div className="flex gap-2">
          <button type="button" className="ui-button" onClick={onRefreshCatalog}>
            Refresh catalog
          </button>
          <button type="button" className="ui-button ui-button-primary" onClick={onAdd}>
            Add model
          </button>
        </div>
      </header>

      {state.warnings.map((warning) => (
        <p key={warning} className="ui-alert ui-alert-warning m-0">
          {warning}
        </p>
      ))}

      {error ? (
        <p className="ui-alert ui-alert-error m-0" role="alert">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="m-0 text-muted">No models configured yet. Choose Add model to create one.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((row, index) => (
            <li
              key={row.sourceIndex}
              className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded border p-2.5 ${
                row.valid ? 'border-panel-border' : 'border-err'
              }`}
            >
              <div className="min-w-0">
                <div className="font-semibold">{row.title}</div>
                <div className="truncate font-mono text-[11px] text-muted">{row.idLabel}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.chips.map((chip) => (
                    <span key={chip.label} className={CHIP_CLASS[chip.tone]}>
                      {chip.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-1">
                <button type="button" className="ui-button" onClick={() => onEdit(row.sourceIndex)}>
                  Edit
                </button>
                <button type="button" className="ui-button" onClick={() => onRemove(row.sourceIndex)}>
                  Delete
                </button>
                <button
                  type="button"
                  className="ui-button"
                  disabled={index === 0}
                  onClick={() => onMove(row.sourceIndex, 'up')}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="ui-button"
                  disabled={index === rows.length - 1}
                  onClick={() => onMove(row.sourceIndex, 'down')}
                >
                  Down
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
