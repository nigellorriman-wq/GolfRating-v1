import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const log = (window as any).progolfLog || console.log;

log("index.tsx: Execution started.");
log(`index.tsx: Detected React Version: ${React.version}`);

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    if (React.version.startsWith('19')) {
       log("index.tsx: WARNING - React 19 detected despite cleanup. Attempting compatible render.", 'WARN');
    }
    
    log("index.tsx: Creating React root...");
    const root = ReactDOM.createRoot(rootElement);
    log("index.tsx: Invoking render...");
    root.render(<App />);
    // Signal ready for splash removal and monitoring
    (window as any).progolfAppReady = true;
  } catch (err) {
    log("index.tsx: ERROR: " + String(err), 'ERROR');
  }
} else {
  log("index.tsx: FATAL - #root missing.", 'ERROR');
}