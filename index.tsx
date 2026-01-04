import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log("ProGolf: Starting initialization...");

const rootElement = document.getElementById('root');

if (!rootElement) {
  const errorMsg = "Critical Error: Root element #root not found in DOM.";
  console.error(errorMsg);
} else {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("ProGolf: React v18 mount successful.");
  } catch (err) {
    console.error("ProGolf: Failed to mount app", err);
    const debugDiv = document.getElementById('debug-console');
    if (debugDiv) {
      debugDiv.style.display = 'block';
      const errorLabel = document.createElement('div');
      errorLabel.style.color = '#ff5555';
      errorLabel.innerText = "Mounting Error: " + (err instanceof Error ? err.message : String(err));
      debugDiv.appendChild(errorLabel);
    }
  }
}