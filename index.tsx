import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const log = (window as any).progolfLog || console.log;

log("index.tsx: Execution started.");
log(`index.tsx: Detected React Version: ${React.version}`);

// Signal ready early to stop the timeout timer
(window as any).progolfAppReady = true;

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    log("index.tsx: Creating React root...");
    const root = ReactDOM.createRoot(rootElement);
    log("index.tsx: Invoking render...");
    root.render(<App />);
    log("index.tsx: Render call complete.");
  } catch (err) {
    log("index.tsx: ERROR during initial render call: " + String(err), 'ERROR');
  }
} else {
  log("index.tsx: FATAL - #root missing from DOM.", 'ERROR');
}
