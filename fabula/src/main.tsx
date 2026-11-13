import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot } from './store';
import './styles.css';

// Uložený projekt se čte asynchronně, proto aplikaci vykreslíme až po jeho načtení.
void boot().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
