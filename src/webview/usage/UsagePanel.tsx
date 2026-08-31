import type { JSX } from 'react';
import { ConnectionCard } from './ConnectionCard';
import type { UsageView } from './view-model';

interface UsagePanelProps {
  readonly view: UsageView;
}

export function UsagePanel({ view }: UsagePanelProps): JSX.Element {
  return (
    <>
      <header className="mx-auto mb-4.5 flex max-w-295 items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-lg font-bold tracking-tight">Usage</h1>
          <p className="text-xs text-muted">{view.sweepLabel}</p>
        </div>
      </header>
      {view.cards.length === 0 ? (
        <p className="mx-auto my-6 max-w-295 text-muted">No connection usage entries returned.</p>
      ) : (
        <div className="mx-auto grid max-w-295 grid-cols-1 gap-4 md:grid-cols-2">
          {view.cards.map((card) => (
            <ConnectionCard key={`${card.provider}-${card.account}`} card={card} />
          ))}
        </div>
      )}
    </>
  );
}
