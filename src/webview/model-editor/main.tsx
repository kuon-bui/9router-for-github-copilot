import type { JSX } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelEditor } from './ModelEditor';
import './model-editor.css';

const container = document.getElementById('root');
function app(): JSX.Element {
	return <StrictMode><ModelEditor api={acquireVsCodeApi()} /></StrictMode>;
}
if (container) createRoot(container).render(app());
