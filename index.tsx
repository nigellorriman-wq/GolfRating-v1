import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log("ProGolf: Mounting application...");

const rootElement = document.getElementById('root');

if (rootElement) {
  try {
    const root = ReactDOM.createRoot(rootElement);
    // REMOVED StrictMode: Leaflet does not support dual-mounts well.
    root.render(<App />);
    console.log("ProGolf: Render initiated.");
  } catch (err) {
    console.error("ProGolf: Mount failed", err);
  }
} else {
  console.error("ProGolf: Root element not found");
}