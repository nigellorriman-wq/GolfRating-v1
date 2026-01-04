import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log("ProGolf: Booting React 18.3.1...");

const rootElement = document.getElementById('root');

if (!rootElement) {
  const errorMsg = "Could not find root element";
  console.error(errorMsg);
  const errDiv = document.createElement('div');
  errDiv.style.color = 'red';
  errDiv.innerText = errorMsg;
  document.body.appendChild(errDiv);
} else {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("ProGolf: Rendered successfully.");
  } catch (err) {
    console.error("ProGolf: Mount Error", err);
    const debugDiv = document.getElementById('debug-error');
    if (debugDiv) {
      debugDiv.style.display = 'block';
      debugDiv.innerText = "Mount Error: " + (err instanceof Error ? err.message : String(err));
    }
  }
}
