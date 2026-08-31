import type { JSX } from 'react';
/* eslint-disable no-unused-vars -- ESLint core misidentifies callback type parameters. */
import { useState } from 'react';
import { createDraftFromCatalog } from '@/config/model-draft';
import { toCatalogMetadata } from '@/runtime/model-editor-view';
import type { ModelDraft } from '@/config/model-draft';
import type { ModelEditorRow, ModelEditorState } from '@/runtime/model-editor-view';

interface ModelFormProps {
  readonly state: ModelEditorState;
  readonly row: ModelEditorRow | undefined;
  readonly error: string;
  readonly onCancel: () => void;
  readonly onSave: (draft: ModelDraft) => void;
}

function initialDraft(state: ModelEditorState, row: ModelEditorRow | undefined): ModelDraft {
  return {
    id: row?.id ?? '', name: row?.name ?? '', modelId: row?.modelId ?? '',
    ...(row?.serviceTier === 'fast' ? { serviceTier: 'fast' as const } : {}),
    toolMode: row?.toolMode ?? 'auto', visionMode: row?.visionMode ?? 'off',
    thinkingMode: row?.thinkingMode ?? 'off', thinkingEfforts: row?.thinkingEfforts ?? [],
    maxInputTokens: row?.maxInputTokens ?? state.defaultMaxInputTokens,
    maxOutputTokens: row?.maxOutputTokens ?? state.defaultMaxOutputTokens
  };
}

const FIELD = 'rounded-sm border border-transparent bg-input px-1.5 py-0.5 text-xs text-input-fg';

export function ModelForm(props: ModelFormProps): JSX.Element {
  const [draft, setDraft] = useState<ModelDraft>(() => initialDraft(props.state, props.row));
  const patch = (changes: Partial<ModelDraft>): void => setDraft((current) => ({ ...current, ...changes }));
  const prefill = (modelId: string): void => {
    const entry = props.state.catalog.find((item) => item.modelId === modelId);
    if (!entry) return;
    const takenIds = props.state.models.filter((model) => model.id !== undefined && model.sourceIndex !== props.row?.sourceIndex).map((model) => model.id as string);
    setDraft(createDraftFromCatalog(toCatalogMetadata(entry), { takenIds }));
  };
  const toggleEffort = (effort: ModelDraft['thinkingEfforts'][number]): void => patch({ thinkingEfforts: draft.thinkingEfforts.includes(effort) ? draft.thinkingEfforts.filter((item) => item !== effort) : [...draft.thinkingEfforts, effort] });
  const setFast = (fast: boolean): void => setDraft((current) => ({ id: current.id, name: current.name, modelId: current.modelId, toolMode: current.toolMode, visionMode: current.visionMode, thinkingMode: current.thinkingMode, thinkingEfforts: current.thinkingEfforts, maxInputTokens: current.maxInputTokens, maxOutputTokens: current.maxOutputTokens, ...(fast ? { serviceTier: 'fast' as const } : {}) }));

  return <section className="flex flex-col gap-3"><header className="flex items-center gap-2"><button type="button" onClick={props.onCancel}>Back</button><h2 className="m-0 text-[13px]">{props.row ? 'Edit model' : 'Add model'}</h2></header>{props.error && <div className="rounded border border-err bg-err-bg px-2 py-1.5 text-xs text-err-fg" role="alert">{props.error}</div>}<form className="flex flex-col gap-1 rounded border border-panel-border p-3" onSubmit={(event) => { event.preventDefault(); props.onSave(draft); }}><label htmlFor="field-catalog">9router model</label><select id="field-catalog" className={FIELD} value={draft.modelId} onChange={(event) => prefill(event.target.value)}><option value="">Select a 9router model</option>{props.state.catalog.map((entry) => <option key={entry.modelId} value={entry.modelId}>{`${entry.modelId}${entry.inUse ? ' (in use)' : ''}${entry.vision ? ' - vision' : ''}`}</option>)}</select><label htmlFor="field-id">Copilot id</label><input id="field-id" className={FIELD} type="text" autoComplete="off" spellCheck={false} value={draft.id} onChange={(event) => patch({ id: event.target.value })} /><label htmlFor="field-name">Display name</label><input id="field-name" className={FIELD} type="text" autoComplete="off" value={draft.name} onChange={(event) => patch({ name: event.target.value })} /><label htmlFor="field-model-id">9router model id</label><input id="field-model-id" className={FIELD} type="text" autoComplete="off" spellCheck={false} value={draft.modelId} onChange={(event) => patch({ modelId: event.target.value })} /><label className="inline-flex flex-row items-center gap-1"><input type="checkbox" checked={draft.serviceTier === 'fast'} onChange={(event) => setFast(event.target.checked)} />Fast tier</label><fieldset><legend>Tool calling</legend>{(['auto', 'off'] as const).map((mode) => <label key={mode}><input type="radio" name="toolMode" checked={draft.toolMode === mode} onChange={() => patch({ toolMode: mode })} /> {mode}</label>)}</fieldset><fieldset><legend>Vision</legend>{(['native', 'proxy', 'off'] as const).map((mode) => <label key={mode}><input type="radio" name="visionMode" checked={draft.visionMode === mode} onChange={() => patch({ visionMode: mode })} /> {mode}</label>)}</fieldset><label htmlFor="field-thinking-mode">Default thinking mode</label><select id="field-thinking-mode" className={FIELD} value={draft.thinkingMode} onChange={(event) => patch({ thinkingMode: event.target.value as ModelDraft['thinkingMode'] })}>{props.state.thinkingModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select><fieldset><legend>Thinking efforts</legend>{props.state.thinkingEfforts.map((effort) => <label key={effort}><input type="checkbox" checked={draft.thinkingEfforts.includes(effort)} onChange={() => toggleEffort(effort)} /> {effort}</label>)}</fieldset><label htmlFor="field-max-input-tokens">Max input tokens</label><input id="field-max-input-tokens" className={FIELD} type="number" min={1} step={1} value={draft.maxInputTokens} onChange={(event) => patch({ maxInputTokens: Number(event.target.value) })} /><label htmlFor="field-max-output-tokens">Max output tokens</label><input id="field-max-output-tokens" className={FIELD} type="number" min={1} step={1} value={draft.maxOutputTokens} onChange={(event) => patch({ maxOutputTokens: Number(event.target.value) })} /><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={props.onCancel}>Cancel</button><button className="bg-btn text-btn-fg" type="submit">Save</button></div></form></section>;
}
