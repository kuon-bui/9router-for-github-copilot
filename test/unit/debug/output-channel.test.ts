import { describe, expect, it } from 'vitest';
import { formatSettingsSnapshotDiagnostics } from '../../../src/debug/output-channel';
import { buildSettingsSnapshot } from '../../../src/config/settings';

describe('formatSettingsSnapshotDiagnostics', () => {
  it('includes snapshot state, published models, rejected models, and validation issues', () => {
    const snapshot = buildSettingsSnapshot(
      {
        get: (key: string) =>
          key === 'models'
            ? [
                {
                  id: 'daily',
                  name: 'Daily',
                  modelId: 'combo/daily',
                  thinkingMode: 'high',
                  thinkingEfforts: ['high']
                },
                { id: 'agent', name: 'Agent', modelId: ' ' }
              ]
            : undefined
      } as never
    );

    const lines = formatSettingsSnapshotDiagnostics(snapshot);

    expect(lines).toEqual(
      expect.arrayContaining([
        'Snapshot state: degraded',
        'Published models: daily',
        'Thinking modes: daily=high',
        'Rejected models: agent (INVALID_MODEL_MAPPING)',
        expect.stringContaining('Issues: INVALID_MODEL_MAPPING')
      ])
    );
  });

  it('does not print an unvalidated model id containing control text', () => {
    const snapshot = buildSettingsSnapshot({
      get: (key: string) =>
        key === 'models'
          ? [{ id: 'api-key\nforged-line', name: 'Agent', modelId: 'router/agent' }]
          : undefined
    } as never);

    const output = formatSettingsSnapshotDiagnostics(snapshot).join('\n');

    expect(output).toContain('Rejected models: entry-0 (INVALID_MODEL_ID)');
    expect(output).not.toContain('api-key');
    expect(output).not.toContain('forged-line');
  });
});
