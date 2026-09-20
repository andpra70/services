import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appBase = process.env.VITE_APP_BASE || './';
const frontControllerUrl = process.env.VITE_FRONT_CONTROLLER_URL || 'https://localhost';

export default defineConfig({
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  base: appBase,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173,
    proxy: {
      '/auth': {
        target: frontControllerUrl,
        changeOrigin: true,
        secure: false,
      },
      '/vfs': {
        target: frontControllerUrl,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
