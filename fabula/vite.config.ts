import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relativní cesty, aby aplikace běžela i v podsložce (GitHub Pages: /Fabula/).
  base: './',
  plugins: [react()],
  // Čas sestavení se ukazuje v nabídce Soubor, aby bylo poznat, která verze v prohlížeči běží.
  define: { __BUILD__: JSON.stringify(new Date().toISOString()) },
  // Cílem je i starší Safari (iPad Air 2 končí na iPadOS 15): novější zápis se při sestavení převede.
  // Regulární výrazy s lookbehind převést nejde; hlídá je test tests/compat.test.ts.
  build: { target: ['es2020', 'safari14'] },
  server: { port: 5173, strictPort: true },
});
