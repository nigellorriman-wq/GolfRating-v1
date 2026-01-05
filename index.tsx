import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log("ProGolf: Booting React entry point...");

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error("Critical: #root element missing");
} else {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("ProGolf: Initial render call successful.");
  } catch (err) {
    console.error("ProGolf: React Mount Exception", err);
    const debugDiv = document.getElementById('debug-console');
    if (debugDiv) {
      debugDiv.style.display = 'block';
      const errorLabel = document.createElement('div');
      errorLabel.innerText = "CRITICAL MOUNT ERROR: " + (err instanceof Error ? err.message : String(err));
      debugDiv.appendChild(errorLabel);
    }
  }
}