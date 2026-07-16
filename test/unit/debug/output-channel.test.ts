import { describe, expect, it } from 'vitest';
import { formatSettingsSnapshotDiagnostics } from '../../../src/debug/output-channel';
import { buildSettingsSnapshot } from '../../../src/config/settings';

describe('formatSettingsSnapshotDiagnostics', () => {
  it('includes snapshot state, published models, rejected models, and validation issues', () => {
    const snapshot = buildSettingsSnapshot(
      {
        get: (key: string) => {
          if (key === 'displayModels') {
            return ['daily', 'agent'];
          }

          if (key === 'modelMappings.daily') {
            return 'combo/daily';
          }

          if (key === 'modelMappings.agent') {
            return ' ';
          }

          if (key === 'thinkingMode.daily') {
            return 'high';
          }

          return undefined;
        }
      } as never
    );

    const lines = formatSettingsSnapshotDiagnostics(snapshot);

    expect(lines).toEqual(
      expect.arrayContaining([
        'Snapshot state: degraded',
        'Published models: daily',
        'Thinking modes: daily=high',
        'Rejected models: agent (INVALID_COMBO_MAPPING)',
        expect.stringContaining('Issues: INVALID_COMBO_MAPPING')
      ])
    );
  });
});
