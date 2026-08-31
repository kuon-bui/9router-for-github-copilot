import { randomBytes } from 'node:crypto';
import {
  DEFAULT_MODEL_MAX_INPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS
} from '@/config/defaults';
import { ENABLED_THINKING_MODES, THINKING_MODES } from '@/types/product-model';

const STYLES = `
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
main { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
h1 { font-size: 15px; margin: 0; }
h2 { font-size: 13px; margin: 0 0 8px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.toolbar-actions { display: flex; gap: 8px; }
button { font-family: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.warnings { display: flex; flex-direction: column; gap: 4px; }
.warning, .error { padding: 6px 8px; border-radius: 2px; font-size: 12px; }
.warning { border: 1px solid var(--vscode-inputValidation-warningBorder); background: var(--vscode-inputValidation-warningBackground); }
.error { border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); }
.model-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.row { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "name actions" "ids actions" "chips actions"; gap: 2px 12px; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; }
.row.invalid { border-color: var(--vscode-inputValidation-errorBorder); }
.row-name { grid-area: name; font-weight: 600; }
.row-ids { grid-area: ids; font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-descriptionForeground); }
.chips { grid-area: chips; display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.chip { font-size: 11px; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.chip.warn { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-foreground); }
.chip.bad { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-foreground); }
.row-actions { grid-area: actions; display: flex; align-items: flex-start; gap: 4px; }
.model-form { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; }
.model-form label { font-size: 12px; margin-top: 6px; }
.model-form input[type="text"], .model-form input[type="number"], .model-form select { font-family: inherit; font-size: 12px; padding: 3px 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }
.model-form fieldset { margin: 8px 0 0; padding: 6px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 2px; display: flex; flex-wrap: wrap; gap: 10px; }
.model-form legend { font-size: 11px; color: var(--vscode-descriptionForeground); }
.checkbox { display: inline-flex; align-items: center; gap: 4px; margin-top: 0; }
.field-error { min-height: 14px; margin: 2px 0 0; font-size: 11px; color: var(--vscode-errorForeground); }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
`;

const CLIENT_SCRIPT = `
const DEFAULT_INPUT_TOKENS = ${DEFAULT_MODEL_MAX_INPUT_TOKENS};
const DEFAULT_OUTPUT_TOKENS = ${DEFAULT_MODEL_MAX_OUTPUT_TOKENS};
const vscodeApi = acquireVsCodeApi();
let state = { models: [], catalog: [], warnings: [] };
let pendingSave = false;
let editingSourceIndex = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) { node.className = className; }
  if (text !== undefined) { node.textContent = text; }
  return node;
}

function renderWarnings() {
  const host = document.getElementById('warnings');
  host.replaceChildren();
  for (const warning of state.warnings) {
    host.append(element('p', 'warning', warning));
  }
}

function renderChips(row) {
  const chips = element('div', 'chips');
  if (row.serviceTier === 'fast') { chips.append(element('span', 'chip', 'Fast')); }
  chips.append(element('span', 'chip', 'tools: ' + (row.toolMode || 'off')));
  chips.append(element('span', 'chip', 'vision: ' + (row.visionMode || 'off')));
  chips.append(element('span', 'chip', 'thinking: ' + (row.thinkingMode || 'off')));
  if (row.catalogStatus === 'missing') {
    chips.append(element('span', 'chip warn', 'not in catalog'));
  }
  if (row.issue) { chips.append(element('span', 'chip bad', row.issue.message)); }
  return chips;
}

function renderList() {
  const list = document.getElementById('model-list');
  list.replaceChildren();
  state.models.forEach(function (row, index) {
    const item = element('li', row.valid ? 'row' : 'row invalid');
    item.append(element('div', 'row-name', row.name || row.id || 'Unnamed model'));
    item.append(element('div', 'row-ids', (row.id || '(no id)') + ' -> ' + (row.modelId || '(no modelId)')));
    item.append(renderChips(row));
    const actions = element('div', 'row-actions');
    const edit = element('button', '', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', function () { openForm(row.sourceIndex); });
    const remove = element('button', '', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', function () {
      vscodeApi.postMessage({ type: 'removeModel', sourceIndex: row.sourceIndex });
    });
    const up = element('button', '', 'Up');
    up.type = 'button';
    up.disabled = index === 0;
    up.addEventListener('click', function () {
      vscodeApi.postMessage({ type: 'moveModel', sourceIndex: row.sourceIndex, direction: 'up' });
    });
    const down = element('button', '', 'Down');
    down.type = 'button';
    down.disabled = index === state.models.length - 1;
    down.addEventListener('click', function () {
      vscodeApi.postMessage({ type: 'moveModel', sourceIndex: row.sourceIndex, direction: 'down' });
    });
    actions.append(edit, remove, up, down);
    item.append(actions);
    list.append(item);
  });
}

function showError(message) {
  const host = document.getElementById('error');
  host.textContent = message;
  host.hidden = message.length === 0;
}

window.addEventListener('message', function (event) {
  const message = event.data;
  if (!message || typeof message !== 'object') { return; }
  if (message.type === 'state') {
    state = message.state;
    showError('');
    renderWarnings();
    renderList();
    renderCatalogOptions();
    if (pendingSave) {
      pendingSave = false;
      closeForm();
    }
  }
  if (message.type === 'error') {
    pendingSave = false;
    showError(String(message.message));
  }
});

document.getElementById('refresh-catalog').addEventListener('click', function () {
  vscodeApi.postMessage({ type: 'refreshCatalog' });
});

vscodeApi.postMessage({ type: 'ready' });

function renderCatalogOptions() {
  const select = document.getElementById('field-catalog');
  const previous = select.value;
  select.replaceChildren();
  const blank = element('option', '', 'Select a 9router model');
  blank.value = '';
  select.append(blank);
  for (const entry of state.catalog) {
    const option = element(
      'option',
      '',
      entry.modelId + (entry.inUse ? ' (in use)' : '') + (entry.vision ? ' - vision' : '')
    );
    option.value = entry.modelId;
    select.append(option);
  }
  select.value = previous;
}

function setRadio(name, value) {
  const inputs = document.querySelectorAll('input[name="' + name + '"]');
  inputs.forEach(function (input) { input.checked = input.value === value; });
}

function readRadio(name, fallback) {
  const checked = document.querySelector('input[name="' + name + '"]:checked');
  return checked ? checked.value : fallback;
}

function setCheckboxGroup(name, values) {
  const inputs = document.querySelectorAll('input[name="' + name + '"]');
  inputs.forEach(function (input) { input.checked = values.indexOf(input.value) >= 0; });
}

function readCheckboxGroup(name) {
  const values = [];
  document.querySelectorAll('input[name="' + name + '"]:checked').forEach(function (input) {
    values.push(input.value);
  });
  return values;
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(function (node) { node.textContent = ''; });
}

function fillForm(draft) {
  document.getElementById('field-id').value = draft.id || '';
  document.getElementById('field-name').value = draft.name || '';
  document.getElementById('field-model-id').value = draft.modelId || '';
  document.getElementById('field-service-tier').checked = draft.serviceTier === 'fast';
  setRadio('toolMode', draft.toolMode || 'off');
  setRadio('visionMode', draft.visionMode || 'off');
  document.getElementById('field-thinking-mode').value = draft.thinkingMode || 'off';
  setCheckboxGroup('thinkingEfforts', draft.thinkingEfforts || []);
  document.getElementById('field-max-input-tokens').value = String(draft.maxInputTokens || DEFAULT_INPUT_TOKENS);
  document.getElementById('field-max-output-tokens').value = String(draft.maxOutputTokens || DEFAULT_OUTPUT_TOKENS);
}

function sanitizeId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-._]+$/, '');
}

function prefillFromCatalog(modelId) {
  const matches = state.catalog.filter(function (item) { return item.modelId === modelId; });
  const entry = matches[0];
  if (!entry) { return; }
  const separator = modelId.lastIndexOf('/');
  const maxOutput = entry.maxOutput || DEFAULT_OUTPUT_TOKENS;
  const derivedInput = entry.contextWindow ? entry.contextWindow - maxOutput : 0;
  const taken = state.models
    .filter(function (row) { return row.id && row.sourceIndex !== editingSourceIndex; })
    .map(function (row) { return row.id; });
  const base = sanitizeId(modelId);
  let id = base;
  let suffix = 2;
  while (id && taken.indexOf(id) >= 0 && suffix <= 100) {
    id = base + '-' + suffix;
    suffix += 1;
  }
  fillForm({
    id: id,
    name: separator >= 0 ? modelId.slice(separator + 1) : modelId,
    modelId: modelId,
    toolMode: 'auto',
    visionMode: entry.vision ? 'native' : 'off',
    thinkingMode: 'off',
    thinkingEfforts: [],
    maxInputTokens: derivedInput > 0 ? derivedInput : DEFAULT_INPUT_TOKENS,
    maxOutputTokens: maxOutput
  });
}

function openForm(sourceIndex) {
  editingSourceIndex = sourceIndex === undefined ? null : sourceIndex;
  clearFieldErrors();
  showError('');
  renderCatalogOptions();
  const rows = state.models.filter(function (item) { return item.sourceIndex === editingSourceIndex; });
  const row = rows[0];
  document.getElementById('form-title').textContent = row ? 'Edit model' : 'Add model';
  document.getElementById('field-catalog').value = row && row.modelId ? row.modelId : '';
  fillForm(row || { toolMode: 'auto', visionMode: 'off', thinkingMode: 'off', thinkingEfforts: [] });
  document.getElementById('model-form').hidden = false;
}

function closeForm() {
  editingSourceIndex = null;
  document.getElementById('model-form').hidden = true;
}

function readDraft() {
  const draft = {
    id: document.getElementById('field-id').value.trim(),
    name: document.getElementById('field-name').value.trim(),
    modelId: document.getElementById('field-model-id').value.trim(),
    toolMode: readRadio('toolMode', 'off'),
    visionMode: readRadio('visionMode', 'off'),
    thinkingMode: document.getElementById('field-thinking-mode').value,
    thinkingEfforts: readCheckboxGroup('thinkingEfforts'),
    maxInputTokens: Number(document.getElementById('field-max-input-tokens').value),
    maxOutputTokens: Number(document.getElementById('field-max-output-tokens').value)
  };
  if (document.getElementById('field-service-tier').checked) { draft.serviceTier = 'fast'; }
  return draft;
}

document.getElementById('add-model').addEventListener('click', function () { openForm(); });
document.getElementById('form-cancel').addEventListener('click', closeForm);
document.getElementById('field-catalog').addEventListener('change', function (event) {
  if (event.target.value) { prefillFromCatalog(event.target.value); }
});
document.getElementById('model-form').addEventListener('submit', function (event) {
  event.preventDefault();
  clearFieldErrors();
  pendingSave = true;
  vscodeApi.postMessage({
    type: 'saveModel',
    sourceIndex: editingSourceIndex,
    draft: readDraft()
  });
});
`;

export function createNonce(): string {
  return randomBytes(16).toString('hex');
}

export function renderModelEditorHtml(nonce: string): string {
  const thinkingModeOptions = THINKING_MODES.map(
    (mode) => `<option value="${mode}">${mode}</option>`
  ).join('');
  const thinkingEffortChoices = ENABLED_THINKING_MODES.map(
    (mode) =>
      `<label class="checkbox"><input type="checkbox" name="thinkingEfforts" value="${mode}"> ${mode}</label>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>9router Models</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <header class="toolbar">
    <h1>9router models</h1>
    <div class="toolbar-actions">
      <button id="refresh-catalog" type="button">Refresh catalog</button>
      <button id="add-model" type="button" class="primary">Add model</button>
    </div>
  </header>
  <div id="warnings" class="warnings" role="status"></div>
  <div id="error" class="error" role="alert" hidden></div>
  <ul id="model-list" class="model-list"></ul>
  <form id="model-form" class="model-form" hidden>
    <h2 id="form-title">Add model</h2>
    <label for="field-catalog">9router model</label>
    <select id="field-catalog"></select>
    <label for="field-id">Copilot id</label>
    <input id="field-id" type="text" autocomplete="off" spellcheck="false">
    <p class="field-error" data-error-for="id"></p>
    <label for="field-name">Display name</label>
    <input id="field-name" type="text" autocomplete="off">
    <p class="field-error" data-error-for="name"></p>
    <label for="field-model-id">9router model id</label>
    <input id="field-model-id" type="text" autocomplete="off" spellcheck="false">
    <p class="field-error" data-error-for="modelId"></p>
    <label class="checkbox"><input id="field-service-tier" type="checkbox"> Fast tier</label>
    <fieldset><legend>Tool calling</legend>
      <label class="checkbox"><input type="radio" name="toolMode" value="auto"> auto</label>
      <label class="checkbox"><input type="radio" name="toolMode" value="off"> off</label>
    </fieldset>
    <fieldset><legend>Vision</legend>
      <label class="checkbox"><input type="radio" name="visionMode" value="native"> native</label>
      <label class="checkbox"><input type="radio" name="visionMode" value="proxy"> proxy</label>
      <label class="checkbox"><input type="radio" name="visionMode" value="off"> off</label>
    </fieldset>
    <label for="field-thinking-mode">Default thinking mode</label>
    <select id="field-thinking-mode">${thinkingModeOptions}</select>
    <fieldset id="field-thinking-efforts"><legend>Thinking efforts</legend>${thinkingEffortChoices}</fieldset>
    <p class="field-error" data-error-for="thinkingEfforts"></p>
    <label for="field-max-input-tokens">Max input tokens</label>
    <input id="field-max-input-tokens" type="number" min="1" step="1">
    <p class="field-error" data-error-for="maxInputTokens"></p>
    <label for="field-max-output-tokens">Max output tokens</label>
    <input id="field-max-output-tokens" type="number" min="1" step="1">
    <p class="field-error" data-error-for="maxOutputTokens"></p>
    <div class="form-actions">
      <button id="form-cancel" type="button">Cancel</button>
      <button id="form-save" type="submit" class="primary">Save</button>
    </div>
  </form>
</main>
<script nonce="${nonce}">${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
