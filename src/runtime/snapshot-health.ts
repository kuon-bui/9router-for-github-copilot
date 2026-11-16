import type { SettingsSnapshot } from '@/config/settings';

export interface SnapshotHealthNotice {
  signature: string;
  message: string;
}

export interface SnapshotHealthReporter {
  report(snapshot: SettingsSnapshot): void;
}

// An empty modelId is the documented "unpublished" draft state (the shipped default entry is
// one), so it is not something to warn about. Capability issues are left to guided Vision setup.
const QUIET_REJECTION_CODES = new Set(['INVALID_MODEL_MAPPING']);

export function describeSnapshotHealth(
  snapshot: SettingsSnapshot
): SnapshotHealthNotice | undefined {
  if (snapshot.state === 'invalid-runtime') {
    const paths = [
      ...new Set(
        snapshot.issues.filter((issue) => issue.scope === 'runtime').map((issue) => issue.path)
      )
    ].sort();

    return {
      signature: `runtime:${paths.join(',')}`,
      message: `9router settings are invalid (${paths.join(', ')}). All 9router models are hidden from the Copilot Chat model picker.`
    };
  }

  const rejected = snapshot.rejectedModels.filter(
    (model) => !QUIET_REJECTION_CODES.has(model.code)
  );
  if (rejected.length === 0) {
    return undefined;
  }

  const count = rejected.length;
  const signature = rejected
    .map((model) => `${model.sourceIndex ?? '?'}:${model.code}`)
    .sort()
    .join(',');

  return {
    signature: `models:${signature}`,
    message: `9router hid ${count} model ${count === 1 ? 'entry' : 'entries'} with invalid settings from the Copilot Chat model picker.`
  };
}

export function createSnapshotHealthReporter(
  show: (notice: SnapshotHealthNotice) => void
): SnapshotHealthReporter {
  let lastSignature: string | undefined;

  return {
    report(snapshot: SettingsSnapshot): void {
      const notice = describeSnapshotHealth(snapshot);
      if (notice && notice.signature !== lastSignature) {
        show(notice);
      }
      lastSignature = notice?.signature;
    }
  };
}
