import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import StagingBanner from './components/layout/StagingBanner';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StagingBanner />
    <App />
  </React.StrictMode>
);
