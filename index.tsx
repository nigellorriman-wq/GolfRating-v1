// Signal ready immediately upon file execution
(window as any).progolfAppReady = true;

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  
  // Robust splash screen removal
  const cleanupSplash = () => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 500);
    }
  };

  try {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    // Remove splash after initial render attempt
    setTimeout(cleanupSplash, 800);
  } catch (e) {
    console.error("Mount error:", e);
    cleanupSplash();
  }
}