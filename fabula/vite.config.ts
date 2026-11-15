import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relativní cesty, aby aplikace běžela i v podsložce (GitHub Pages: /Fabula/).
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
