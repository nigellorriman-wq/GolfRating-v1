import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Access the global logger defined in index.html
const log = (window as any).progolfLog || console.log;

log("index.tsx: Execution started.");

const rootElement = document.getElementById('root');

if (rootElement) {
  try {
    log("index.tsx: Creating React root...");
    const root = ReactDOM.createRoot(rootElement);
    
    log("index.tsx: Rendering App component...");
    root.render(<App />);
    
    log("index.tsx: Render called successfully.");
  } catch (err) {
    log("index.tsx: ERROR during mount: " + String(err), 'ERROR');
  }
} else {
  log("index.tsx: FATAL - #root element not found in DOM.", 'ERROR');
}