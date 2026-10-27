import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';

// I18nProvider sits above App on purpose: it renders nothing until the OS
// language is known, so App (and its guiReady IPC) only mounts afterwards.
// The main process waits for guiReady before sending appStatus /
// userDataExists, so those events are never sent before their listeners
// exist. Do not move the provider below App's status switch.
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
