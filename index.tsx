// Signal ready immediately upon file execution to stop the timeout timer
(window as any).progolfAppReady = true;

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const log = (window as any).progolfLog || console.log;

log("ProGolf: Booting React " + React.version);

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (err) {
    log("ProGolf: Render Failed: " + String(err), 'ERROR');
  }
} else {
  log("ProGolf: Critical DOM Failure - #root not found.", 'ERROR');
}