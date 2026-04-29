// @xdyb/client — React entry point.
//
// Mounts the React root into #root from index.html. The Game stage / lobby
// flow / PixiJS canvas land in subsequent iterations. This entry exists so
// `vite build` resolves an entrypoint and `vite dev` boots a working page.

import React from 'react';
import ReactDOM from 'react-dom/client';
import { SHARED_PACKAGE_VERSION, ACTION_TOTAL_MS } from '@xdyb/shared';
import { App } from './App.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('[xdyb-client] #root not found in index.html');
}

// eslint-disable-next-line no-console
console.log(
  `[xdyb-client] bootstrap — shared@${SHARED_PACKAGE_VERSION} action=${ACTION_TOTAL_MS}ms`,
);

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
