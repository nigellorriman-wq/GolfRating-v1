import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

const cleanupSplash = () => {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 500);
  }
};

const rootElement = document.getElementById('root');
if (rootElement) {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    // Remove splash once React has taken over
    setTimeout(cleanupSplash, 1000);
  } catch (err) {
    console.error("ProGolf Startup Error:", err);
    const diag = document.getElementById('diagnostic');
    if (diag) {
      diag.style.display = 'block';
      diag.innerText = 'Startup Error: ' + err.message;
    }
  }
}