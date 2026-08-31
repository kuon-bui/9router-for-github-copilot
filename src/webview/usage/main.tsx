import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';
import './usage.css';

function App(): JSX.Element {
  return <h1 className="font-sans text-fg">Usage</h1>;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
