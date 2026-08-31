import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelEditor } from './ModelEditor';
import './model-editor.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ModelEditor api={acquireVsCodeApi()} />
    </StrictMode>
  );
}
