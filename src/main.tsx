import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { instalarSelecaoAoFocar } from './utils/selecaoAoFocar';
import { Dica } from './components/Dica';

instalarSelecaoAoFocar();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Dica />
  </StrictMode>,
);
