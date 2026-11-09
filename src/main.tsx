import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { instalarSelecaoAoFocar } from './utils/selecaoAoFocar';

instalarSelecaoAoFocar();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
