import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relativní cesty, aby aplikace běžela i v podsložce (GitHub Pages: /Fabula/).
  base: './',
  plugins: [react()],
  // Cílem je i starší Safari (iPad Air 2 končí na iPadOS 15): novější zápis se při sestavení převede.
  // Regulární výrazy s lookbehind převést nejde; hlídá je test tests/compat.test.ts.
  build: { target: ['es2020', 'safari14'] },
  server: { port: 5173, strictPort: true },
});
