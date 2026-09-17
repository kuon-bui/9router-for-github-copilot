import type { JSX } from 'react';
import { ConnectionCard } from './ConnectionCard';
import type { UsageView } from './view-model';

interface UsagePanelProps {
  readonly view: UsageView;
  readonly compact: boolean;
  readonly onToggleCompact: () => void;
}

export function UsagePanel({ view, compact, onToggleCompact }: UsagePanelProps): JSX.Element {
  return (
    <>
      <header className="mx-auto mb-4.5 flex max-w-295 items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-lg font-bold tracking-tight">Usage</h1>
          <p className="text-xs text-muted">{view.sweepLabel}</p>
        </div>
        <button
          type="button"
          className={compact ? 'ui-button ui-button-primary' : 'ui-button'}
          aria-pressed={compact}
          onClick={onToggleCompact}
        >
          {compact ? 'Comfortable' : 'Compact'}
        </button>
      </header>
      {view.groups.length === 0 ? (
        <p className="mx-auto my-6 max-w-295 text-muted">No connection usage entries returned.</p>
      ) : (
        <div className={`mx-auto flex max-w-295 flex-col ${compact ? 'gap-2' : 'gap-5'}`}>
          {view.groups.map((group) => (
            <section key={group.provider} className={`flex flex-col ${compact ? 'gap-1' : 'gap-2.5'}`}>
              <h2 className="m-0 flex items-center gap-2 text-[13px] font-semibold tracking-tight">
                {group.icon ? (
                  <img
                    className="size-4"
                    src={group.icon.url}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                {group.provider}
                {compact ? (
                  <span className="text-[11px] font-normal text-muted">
                    {group.cards.length}
                  </span>
                ) : null}
              </h2>
              <div
                className={
                  compact
                    ? 'grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3'
                    : 'grid grid-cols-1 gap-4 md:grid-cols-2'
                }
              >
                {group.cards.map((card) => (
                  <ConnectionCard
                    key={`${card.provider}-${card.account}`}
                    card={card}
                    compact={compact}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
