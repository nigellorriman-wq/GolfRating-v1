// Signal ready immediately upon file execution to stop the timeout timer
(window as any).progolfAppReady = true;

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const log = (window as any).progolfLog || console.log;

log("index.tsx: Execution started.");
log(`index.tsx: React Version: ${React.version}`);

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    log("index.tsx: Creating root...");
    const root = ReactDOM.createRoot(rootElement);
    root.render(<App />);
    log("index.tsx: Render invoked.");
  } catch (err) {
    log("index.tsx: ERROR: " + String(err), 'ERROR');
  }
} else {
  log("index.tsx: FATAL - #root missing.", 'ERROR');
}