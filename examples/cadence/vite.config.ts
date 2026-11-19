import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import brushup from 'brushup/vite';

// brushup() does nothing in `vite build`; in `vite dev` it adds the canvas to the page.
export default defineConfig({
  plugins: [react(), tailwindcss(), brushup()],
});
