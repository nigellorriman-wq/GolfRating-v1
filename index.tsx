import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log("ProGolf: Entry point loaded. Attempting mount...");

const rootElement = document.getElementById('root');

if (rootElement) {
  try {
    const root = ReactDOM.createRoot(rootElement);
    // No StrictMode to ensure Leaflet initializes exactly once
    root.render(<App />);
    console.log("ProGolf: Render command sent to React.");
  } catch (err) {
    console.error("ProGolf: Initial mount failed", err);
    const debug = document.getElementById('debug-console');
    if (debug) {
      debug.style.display = 'block';
      debug.innerHTML += '<div style="background:black; padding:10px;">MOUNT ERROR: ' + String(err) + '</div>';
    }
  }
} else {
  console.error("ProGolf: DOM Root element not found.");
}