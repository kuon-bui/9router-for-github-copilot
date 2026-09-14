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
  const nativeVisionCount = state.models.filter((model) => model.visionMode === 'native').length;
  const reviewCount = rows.filter((row) => !row.valid || row.catalogMissing).length;

  return (
    <section className="mx-auto flex w-full max-w-300 flex-col gap-4">
      <header className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-btn text-sm font-black text-btn-fg shadow-sm"
          >
            9
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-[16px] font-bold tracking-tight">Model fleet</h2>
            <p className="m-0 truncate text-[11px] text-muted">
              Curated routes for Copilot Chat
            </p>
          </div>
        </div>
        <div className="flex gap-2 self-end min-[480px]:self-auto">
          <button type="button" className="ui-button" onClick={onRefreshCatalog}>
            Refresh catalog
          </button>
          <button type="button" className="ui-button ui-button-primary" onClick={onAdd}>
            + Add model
          </button>
        </div>
      </header>

      <dl className="m-0 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-card px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Models</dt>
          <dd className="m-0 mt-0.5 text-lg font-bold tracking-tight">{rows.length}</dd>
        </div>
        <div className="rounded-xl bg-card px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Native vision
          </dt>
          <dd className="m-0 mt-0.5 text-lg font-bold tracking-tight">{nativeVisionCount}</dd>
        </div>
        <div className="rounded-xl bg-card px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Review</dt>
          <dd className={`m-0 mt-0.5 text-lg font-bold tracking-tight ${reviewCount ? 'text-warn' : 'text-ok'}`}>
            {reviewCount}
          </dd>
        </div>
      </dl>

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
        <div className="rounded-xl bg-card px-4 py-8 text-center">
          <p className="m-0 font-semibold">No models configured</p>
          <p className="m-0 mt-1 text-xs text-muted">Choose Add model to create your first route.</p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map((row, index) => (
            <li
              key={row.sourceIndex}
              className="relative grid grid-cols-1 gap-3 rounded-xl bg-card py-3 pl-4 pr-3 transition-colors min-[560px]:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-3 left-0 w-0.5 rounded-full ${
                  !row.valid ? 'bg-critical' : row.catalogMissing ? 'bg-warn' : 'bg-ok'
                }`}
              />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold tracking-tight">{row.title}</div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted">
                  {row.idLabel}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {row.chips.map((chip) => (
                    <span key={chip.label} className={CHIP_CLASS[chip.tone]}>
                      {chip.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-start justify-end gap-1">
                <button type="button" className="ui-button" onClick={() => onEdit(row.sourceIndex)}>
                  Edit
                </button>
                <details className="group relative">
                  <summary
                    aria-label={`More actions for ${row.title}`}
                    className="ui-button list-none px-2.5 [&::-webkit-details-marker]:hidden"
                  >
                    ...
                  </summary>
                  <div className="absolute right-0 z-10 mt-1 flex min-w-32 flex-col rounded-lg border border-border bg-card p-1 shadow-lg">
                    <button
                      type="button"
                      className="ui-menu-item"
                      disabled={index === 0}
                      onClick={() => onMove(row.sourceIndex, 'up')}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="ui-menu-item"
                      disabled={index === rows.length - 1}
                      onClick={() => onMove(row.sourceIndex, 'down')}
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      className="ui-menu-item text-err-fg"
                      onClick={() => onRemove(row.sourceIndex)}
                    >
                      Delete
                    </button>
                  </div>
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
