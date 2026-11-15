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

// Mimo vývoj si aplikace uloží své soubory do zařízení, aby šla spustit i bez připojení (viz public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
