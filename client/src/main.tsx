import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import StagingBanner from './components/layout/StagingBanner';
import './styles/index.css';
import { installDecimalCommaInput } from './utils/decimalCommaInput';

// Constat 118 : « 1,5 » ne doit pas devenir « 15 » dans un navigateur en anglais.
installDecimalCommaInput();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StagingBanner />
    <App />
  </React.StrictMode>
);
