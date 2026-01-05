import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const log = (window as any).progolfLog || console.log;

log("index.tsx: Execution started.");
log(`index.tsx: Detected React Version: ${React.version}`);

if (React.version.startsWith('19')) {
  log("index.tsx: FATAL - React 19 is active. Aborting render to prevent crash.", 'ERROR');
} else {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    try {
      log("index.tsx: Creating React root...");
      const root = ReactDOM.createRoot(rootElement);
      log("index.tsx: Invoking render...");
      root.render(<App />);
    } catch (err) {
      log("index.tsx: ERROR: " + String(err), 'ERROR');
    }
  } else {
    log("index.tsx: FATAL - #root missing.", 'ERROR');
  }
}