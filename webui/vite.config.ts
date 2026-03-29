import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import path from 'path';

const bffOrigin = process.env.VITE_BFF_ORIGIN || 'http://127.0.0.1:5100';
const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: rootDir,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/app-api': {
        target: bffOrigin,
        changeOrigin: true,
      },
      '/auth': {
        target: bffOrigin,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(rootDir, 'dist'),
    emptyOutDir: true,
  },
});
