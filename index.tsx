import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const log = (window as any).progolfLog || console.log;

log("index.tsx: Execution started.");
log(`index.tsx: Detected React Version: ${React.version}`);

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    log("index.tsx: Creating React root...");
    const root = ReactDOM.createRoot(rootElement);
    log("index.tsx: Invoking render...");
    root.render(<App />);
    // Signal ready so the timeout monitor knows JS executed successfully
    (window as any).progolfAppReady = true;
    log("index.tsx: Signal READY sent.");
  } catch (err) {
    log("index.tsx: ERROR during initial render call: " + String(err), 'ERROR');
  }
} else {
  log("index.tsx: FATAL - #root missing from DOM.", 'ERROR');
}
