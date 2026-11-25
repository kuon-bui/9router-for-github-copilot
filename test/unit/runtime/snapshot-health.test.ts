import { describe, expect, it, vi } from 'vitest';
import { buildSettingsSnapshot } from '@/config/settings';
import {
  createSnapshotHealthReporter,
  describeSnapshotHealth
} from '@/runtime/snapshot-health';

const snapshotOf = (values: Record<string, unknown>) =>
  buildSettingsSnapshot({ get: (key: string) => values[key] } as never, 'Default Vision prompt.');

const coder = { id: 'coder', name: 'Coder', modelId: 'router/coder' };
const nameless = { id: 'bad', name: '', modelId: 'router/bad' };

describe('describeSnapshotHealth', () => {
  it('reports invalid runtime settings by path', () => {
    expect(describeSnapshotHealth(snapshotOf({ baseUrl: 'not-a-url' }))?.message).toBe(
      '9router settings are invalid (9router-copilot.baseUrl). All 9router models are hidden from the Copilot Chat model picker.'
    );
  });

  it('counts hidden model entries', () => {
    expect(describeSnapshotHealth(snapshotOf({ models: [coder, nameless] }))?.message).toBe(
      '9router hid 1 model entry with invalid settings from the Copilot Chat model picker.'
    );
  });

  it('pluralizes several hidden model entries', () => {
    const broken = { id: 'worse', name: '', modelId: 'router/worse' };
    expect(
      describeSnapshotHealth(snapshotOf({ models: [coder, nameless, broken] }))?.message
    ).toBe('9router hid 2 model entries with invalid settings from the Copilot Chat model picker.');
  });

  it('treats an unmapped draft entry as healthy', () => {
    const draft = { id: 'agent', name: 'Agent', modelId: '' };
    expect(describeSnapshotHealth(snapshotOf({ models: [draft, coder] }))).toBeUndefined();
  });

  it('leaves the shipped default configuration quiet', () => {
    expect(describeSnapshotHealth(snapshotOf({}))).toBeUndefined();
  });

  it('ignores Vision proxy setup that guided setup will handle', () => {
    const proxyModel = { ...coder, visionMode: 'proxy' };
    expect(describeSnapshotHealth(snapshotOf({ models: [proxyModel] }))).toBeUndefined();
  });
});

describe('createSnapshotHealthReporter', () => {
  it('shows the same breakage once', () => {
    const show = vi.fn();
    const reporter = createSnapshotHealthReporter(show);
    const broken = snapshotOf({ models: [coder, nameless] });

    reporter.report(broken);
    reporter.report(snapshotOf({ models: [coder, nameless] }));

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('shows a breakage again after the settings were healthy', () => {
    const show = vi.fn();
    const reporter = createSnapshotHealthReporter(show);

    reporter.report(snapshotOf({ models: [coder, nameless] }));
    reporter.report(snapshotOf({ models: [coder] }));
    reporter.report(snapshotOf({ models: [coder, nameless] }));

    expect(show).toHaveBeenCalledTimes(2);
  });
});
