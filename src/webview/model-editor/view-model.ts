import type { RouterModelMetadata } from '@/router/model-catalog';
import type {
  ModelEditorCatalogEntry,
  ModelEditorRow,
  ModelEditorState
} from '@/types/model-editor';
import type { PickerOption } from '@/webview/shared/combobox-model';
import { resolveProviderIcon } from '@/webview/shared/provider-icons';

export const OTHER_PROVIDER = 'Other';

export type ChipTone = 'plain' | 'warn' | 'bad';

export interface ChipView {
  readonly label: string;
  readonly tone: ChipTone;
}

export interface ModelRowView {
  readonly sourceIndex: number;
  readonly key: string;
  readonly valid: boolean;
  readonly catalogMissing: boolean;
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

/**
 * A stable per-row identity for the `view-transition-name` CSS property, so the
 * browser can animate a model row across a move/delete instead of the plain
 * position-keyed React key. Sanitized to a valid CSS custom-ident (letters,
 * digits, hyphens, underscores) and de-duplicated, since `id` is user text
 * that VS Code settings allow to repeat.
 */
export function buildRowKeys(rows: readonly ModelEditorRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const raw = row.id ?? row.modelId ?? `row-${row.sourceIndex}`;
    const sanitized = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'row';
    const base = `model-${sanitized}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

/** The list change the webview asked the host for, to recognise its result. */
export type RowTransitionIntent =
  | { readonly kind: 'move' }
  | { readonly kind: 'remove'; readonly key: string };

/**
 * Whether a host state update is the outcome of `intent`, judged by row keys
 * before and after. Timing cannot answer this: a delete waits on a host-side
 * confirmation the webview never hears about, so a cancelled delete must not
 * make whatever state arrives next (a catalog refresh, an external settings
 * edit) animate as if it were the deletion.
 */
export function matchesRowTransition(
  intent: RowTransitionIntent,
  previousKeys: readonly string[],
  nextKeys: readonly string[]
): boolean {
  if (intent.kind === 'remove') {
    return (
      nextKeys.length === previousKeys.length - 1 &&
      previousKeys.includes(intent.key) &&
      !nextKeys.includes(intent.key)
    );
  }
  const previous = new Set(previousKeys);
  return (
    nextKeys.length === previousKeys.length &&
    nextKeys.every((key) => previous.has(key)) &&
    nextKeys.some((key, index) => key !== previousKeys[index])
  );
}

export function buildModelListView(state: ModelEditorState): ModelRowView[] {
  const keys = buildRowKeys(state.models);
  return state.models.map((row, index) => ({
    sourceIndex: row.sourceIndex,
    key: keys[index] ?? `model-row-${row.sourceIndex}`,
    valid: row.valid,
    catalogMissing: row.catalogStatus === 'missing',
    title: row.name ?? row.id ?? 'Unnamed model',
    idLabel: `${row.id ?? '(no id)'} -> ${row.modelId ?? '(no modelId)'}`,
    chips: buildChips(row)
  }));
}

export function toRouterModelMetadata(entry: ModelEditorCatalogEntry): RouterModelMetadata {
  return {
    id: entry.modelId,
    ...(entry.ownedBy !== undefined ? { ownedBy: entry.ownedBy } : {}),
    ...(entry.vision ? { vision: true as const } : {}),
    ...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.maxOutput !== undefined ? { maxOutput: entry.maxOutput } : {})
  };
}

export function resolveCatalogProvider(entry: ModelEditorCatalogEntry): string {
  const ownedBy = entry.ownedBy?.trim();
  if (ownedBy) {
    return ownedBy;
  }
  const slashIndex = entry.modelId.indexOf('/');
  if (slashIndex > 0) {
    const prefix = entry.modelId.slice(0, slashIndex).trim();
    if (prefix) {
      return prefix;
    }
  }
  return OTHER_PROVIDER;
}

export function findCatalogProvider(
  catalog: readonly ModelEditorCatalogEntry[],
  modelId: string
): string | undefined {
  if (!modelId) {
    return undefined;
  }
  const match = catalog.find((item) => item.modelId === modelId);
  return match ? resolveCatalogProvider(match) : undefined;
}

export function buildProviderOptions(
  catalog: readonly ModelEditorCatalogEntry[]
): PickerOption[] {
  const counts = new Map<string, number>();
  for (const entry of catalog) {
    const provider = resolveCatalogProvider(entry);
    counts.set(provider, (counts.get(provider) ?? 0) + 1);
  }
  const providers = [...counts.keys()].sort((a, b) => {
    if (a === b) {
      return 0;
    }
    if (a === OTHER_PROVIDER) {
      return 1;
    }
    if (b === OTHER_PROVIDER) {
      return -1;
    }
    return a.localeCompare(b);
  });
  return providers.map((provider) => {
    const count = counts.get(provider) ?? 0;
    const icon = provider === OTHER_PROVIDER ? undefined : resolveProviderIcon(provider);
    return {
      value: provider,
      label: provider,
      detail: count === 1 ? '1 model' : `${count} models`,
      ...(icon !== undefined ? { iconUrl: icon.url } : {})
    };
  });
}

export function buildModelOptions(
  catalog: readonly ModelEditorCatalogEntry[],
  provider: string
): PickerOption[] {
  return catalog
    .filter((entry) => resolveCatalogProvider(entry) === provider)
    .map((entry) => {
      const flags: string[] = [];
      if (entry.inUse) {
        flags.push('in use');
      }
      if (entry.vision) {
        flags.push('vision');
      }
      const detail = flags.length > 0 ? flags.join(' · ') : undefined;
      return {
        value: entry.modelId,
        label: entry.modelId,
        ...(detail !== undefined ? { detail } : {})
      };
    });
}
