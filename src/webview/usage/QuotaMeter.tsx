import type { JSX } from 'react';
import type { QuotaView } from './view-model';

const TRACK_CLASS = {
  ok: 'bg-ok/20',
  warn: 'bg-warn/20',
  critical: 'bg-critical/20'
} as const;

const FILL_CLASS = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  critical: 'bg-critical'
} as const;

const TEXT_CLASS = {
  ok: 'text-ok',
  warn: 'text-warn',
  critical: 'text-critical'
} as const;

interface QuotaMeterProps {
  readonly quota: QuotaView;
}

export function QuotaMeter({ quota }: QuotaMeterProps): JSX.Element {
  return (
    <section className="grid grid-cols-[minmax(92px,118px)_minmax(0,1fr)_42px_88px] items-center gap-x-2.5 gap-y-1 py-2">
      <div className="col-start-1 row-span-2 flex min-w-0 items-center gap-2 text-[12.5px]">
        <span className={`size-2 shrink-0 rounded-full ${FILL_CLASS[quota.tone]}`} />
        {quota.name}
      </div>
      <div className="col-start-2 text-[11px] tabular-nums text-muted">{quota.usedLabel}</div>
      <div
        className={`col-start-2 h-1 overflow-hidden rounded-full ${TRACK_CLASS[quota.tone]}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={quota.percent}
        aria-label={`${quota.name} remaining`}
      >
        <div
          className={`h-full rounded-[inherit] ${FILL_CLASS[quota.tone]}`}
          style={{ width: `${quota.percent}%` }}
        />
      </div>
      <div
        className={`col-start-3 row-span-2 justify-self-end text-xs font-semibold tabular-nums ${TEXT_CLASS[quota.tone]}`}
      >
        {quota.percent}%
      </div>
      <div className="col-start-4 row-span-2 whitespace-nowrap text-xs text-muted">
        {quota.resetLabel}
      </div>
    </section>
  );
}
