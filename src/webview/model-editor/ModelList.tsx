import type { JSX } from 'react';
/* eslint-disable no-unused-vars -- ESLint core misidentifies callback type parameters. */
import { buildModelListView } from './view-model';
import type { ChipTone } from './view-model';
import type { ModelEditorState } from '@/runtime/model-editor-view';

const CHIP_CLASS: Record<ChipTone, string> = { plain: 'bg-badge text-badge-fg', warn: 'bg-warn-bg text-fg', bad: 'bg-err-bg text-err-fg' };

export function ModelList({ state, onEdit, onRemove, onMove }: { state: ModelEditorState; onEdit: (sourceIndex: number) => void; onRemove: (sourceIndex: number) => void; onMove: (sourceIndex: number, direction: 'up' | 'down') => void }): JSX.Element {
  const rows = buildModelListView(state);
  if (rows.length === 0) {
    return <p className="text-muted">No models configured yet. Choose Add model to create one.</p>;
  }

  return <ul className="m-0 flex list-none flex-col gap-2 p-0">{rows.map((row, index) => <li key={row.sourceIndex} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded border p-2.5 ${row.valid ? 'border-panel-border' : 'border-err'}`}><div className="min-w-0"><div className="font-semibold">{row.title}</div><div className="truncate font-mono text-[11px] text-muted">{row.idLabel}</div><div className="mt-1 flex flex-wrap gap-1">{row.chips.map((chip) => <span key={chip.label} className={`rounded-full px-1.5 py-px text-[11px] ${CHIP_CLASS[chip.tone]}`}>{chip.label}</span>)}</div></div><div className="flex items-start gap-1"><button type="button" onClick={() => onEdit(row.sourceIndex)}>Edit</button><button type="button" onClick={() => onRemove(row.sourceIndex)}>Delete</button><button type="button" disabled={index === 0} onClick={() => onMove(row.sourceIndex, 'up')}>Up</button><button type="button" disabled={index === rows.length - 1} onClick={() => onMove(row.sourceIndex, 'down')}>Down</button></div></li>)}</ul>;
}
