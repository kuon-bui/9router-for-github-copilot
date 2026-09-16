import type { JSX } from 'react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UsagePanel } from './UsagePanel';
import { buildUsageView } from './view-model';
import type { UsageHostMessage } from '@/webview/shared/protocol';
import type { UsageView } from './view-model';

const vscodeApi = acquireVsCodeApi();

function App(): JSX.Element | null {
  const [view, setView] = useState<UsageView>();
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    function onMessage(event: MessageEvent<UsageHostMessage>): void {
      if (event.data.type === 'usage') {
        setView(buildUsageView(event.data.snapshot, event.data.nowMs));
        setCompact(event.data.compact);
      }
    }

    window.addEventListener('message', onMessage);
    vscodeApi.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (view === undefined) {
    return null;
  }

  function toggleCompact(): void {
    const next = !compact;
    setCompact(next);
    vscodeApi.postMessage({ type: 'setCompact', compact: next });
  }

  return <UsagePanel view={view} compact={compact} onToggleCompact={toggleCompact} />;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<StrictMode><App /></StrictMode>);
}
