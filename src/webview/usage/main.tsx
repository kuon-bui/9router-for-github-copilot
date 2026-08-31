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

  useEffect(() => {
    function onMessage(event: MessageEvent<UsageHostMessage>): void {
      if (event.data.type === 'usage') {
        setView(buildUsageView(event.data.snapshot, event.data.nowMs));
      }
    }

    window.addEventListener('message', onMessage);
    vscodeApi.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return view === undefined ? null : <UsagePanel view={view} />;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<StrictMode><App /></StrictMode>);
}
