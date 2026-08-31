import type { ModelEditorRow, ModelEditorState } from '@/runtime/model-editor-view';

export type ChipTone = 'plain' | 'warn' | 'bad';

export interface ChipView {
  readonly label: string;
  readonly tone: ChipTone;
}

export interface ModelRowView {
  readonly sourceIndex: number;
  readonly valid: boolean;
  readonly title: string;
  readonly idLabel: string;
  readonly chips: readonly ChipView[];
}

function buildChips(row: ModelEditorRow): ChipView[] {
  const chips: ChipView[] = [];
  if (row.serviceTier === 'fast') chips.push({ label: 'Fast', tone: 'plain' });
  chips.push({ label: `tools: ${row.toolMode ?? 'off'}`, tone: 'plain' });
  chips.push({ label: `vision: ${row.visionMode ?? 'off'}`, tone: 'plain' });
  chips.push({ label: `thinking: ${row.thinkingMode ?? 'off'}`, tone: 'plain' });
  if (row.catalogStatus === 'missing') chips.push({ label: 'not in catalog', tone: 'warn' });
  if (row.issue) chips.push({ label: row.issue.message, tone: 'bad' });
  return chips;
}

export function buildModelListView(state: ModelEditorState): ModelRowView[] {
  return state.models.map((row) => ({
    sourceIndex: row.sourceIndex,
    valid: row.valid,
    title: row.name ?? row.id ?? 'Unnamed model',
    idLabel: `${row.id ?? '(no id)'} -> ${row.modelId ?? '(no modelId)'}`,
    chips: buildChips(row)
  }));
}
