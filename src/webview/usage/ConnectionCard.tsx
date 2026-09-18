import type { JSX } from 'react';
import { QuotaMeter } from './QuotaMeter';
import type { UsageCardView } from './view-model';

const REFRESH_HREF = 'command:9routerCopilot.showUsage';

interface ConnectionCardProps {
  readonly card: UsageCardView;
  readonly compact?: boolean;
}

function RefreshButton(): JSX.Element {
  return (
    <a
      className="grid size-7 place-items-center rounded-lg text-muted no-underline hover:text-fg"
      href={REFRESH_HREF}
      title="Refresh usage"
      aria-label="Refresh usage"
    >
      <svg
        className="size-3.75"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
      >
        <path d="M20 12a8 8 0 1 1-2.2-5.5" />
        <path d="M20 5v5h-5" />
      </svg>
    </a>
  );
}

function Avatar({ card }: ConnectionCardProps): JSX.Element {
  if (!card.icon) {
    return (
      <div
        className="grid size-11 shrink-0 place-items-center rounded-full bg-fg/10 text-lg font-bold text-fg"
        aria-hidden="true"
      >
        {card.initial}
      </div>
    );
  }

  return (
    <div
      className="relative grid size-11 shrink-0 place-items-center rounded-full bg-[#f4f4f4] text-base font-bold text-[#111]"
      data-provider-logo={card.icon.slug}
      aria-hidden="true"
    >
      <span>{card.initial}</span>
      <img
        className="absolute left-1/2 top-1/2 block size-6.5 -translate-x-1/2 -translate-y-1/2"
        src={card.icon.url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

export function ConnectionCard({ card, compact = false }: ConnectionCardProps): JSX.Element {
  if (compact) {
    return (
      <article className="min-w-0 rounded-lg border border-border bg-card px-2.5 py-2">
        <header className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold tracking-tight">{card.account}</div>
            <div className="truncate text-[10px] text-muted">{card.plan}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {card.chips.map((chip) => (
              <span
                key={chip}
                className="ui-chip border border-border uppercase tracking-wide text-muted"
              >
                {chip}
              </span>
            ))}
            <RefreshButton />
          </div>
        </header>
        {card.message !== undefined ? (
          <p className="mt-1.5 border-l-[3px] border-critical bg-critical/10 px-2 py-1 text-[11px] text-muted">
            {card.message}
          </p>
        ) : null}
        <div className="mt-1.5 flex flex-col gap-1">
          {card.quotas.map((quota) => (
            <QuotaMeter key={quota.name} quota={quota} compact />
          ))}
        </div>
      </article>
    );
  }

  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card px-4.5 pb-3 pt-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar card={card} />
          <div className="min-w-0">
            <div className="text-[15px] font-bold tracking-tight">{card.provider}</div>
            <div className="truncate text-xs text-muted">{card.account}</div>
            <div className="mt-px truncate text-[11px] text-muted">{card.plan}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {card.chips.map((chip) => (
            <span
              key={chip}
              className="ui-chip border border-border uppercase tracking-wide text-muted"
            >
              {chip}
            </span>
          ))}
          <RefreshButton />
        </div>
      </header>
      {card.message !== undefined ? (
        <p className="mt-3 border-l-[3px] border-critical bg-critical/10 px-2.5 py-2 text-muted">
          {card.message}
        </p>
      ) : null}
      <p className="mb-1 mt-3.5 text-xs text-muted">{card.quotaCountLabel}</p>
      {card.quotas.map((quota) => (
        <QuotaMeter key={quota.name} quota={quota} />
      ))}
    </article>
  );
}
