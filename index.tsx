import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const log = (window as any).progolfLog || console.log;

log("index.tsx: Starting entry execution.");

const rootElement = document.getElementById('root');

if (rootElement) {
  try {
    log("index.tsx: Creating React root (v18)...");
    const root = ReactDOM.createRoot(rootElement);
    
    log("index.tsx: Invoking root.render(<App />)...");
    root.render(<App />);
    
    log("index.tsx: Render call complete. Waiting for App useEffect.");
  } catch (err) {
    log("index.tsx: ERROR during mount: " + String(err), 'ERROR');
    if (err instanceof Error) log(err.stack || "No stack trace", 'STACK');
  }
} else {
  log("index.tsx: FATAL - #root element missing.", 'ERROR');
}