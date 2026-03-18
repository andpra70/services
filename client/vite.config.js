import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const appBase = process.env.VITE_APP_BASE || './';

export default defineConfig({
  base: appBase,
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        example: path.resolve(__dirname, 'example.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
