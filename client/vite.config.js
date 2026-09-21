import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const appBase = process.env.VITE_APP_BASE || './';
const frontControllerUrl = process.env.VITE_FRONT_CONTROLLER_URL || 'https://127.0.0.1:8443';
const vfsServerUrl = process.env.VITE_VFS_SERVER_URL || frontControllerUrl;
const productionHost = process.env.VITE_BACKEND_HOST || 'belle.iliadboxos.it';
const localWidgetPath = fileURLToPath(new URL('../public/vfs-widget.js', import.meta.url));

const localWidget = {
  name: 'local-vfs-widget',
  configureServer(server) {
    server.middlewares.use('/vfs/widget.js', async (request, response, next) => {
      if (request.method !== 'GET') return next();
      try {
        response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(await readFile(localWidgetPath));
      } catch (error) {
        next(error);
      }
    });
  },
};

export default defineConfig({
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  base: appBase,
  plugins: [react(), localWidget],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173,
    proxy: {
      '/auth': {
        target: frontControllerUrl,
        changeOrigin: true,
        secure: false,
        headers: { host: productionHost },
      },
      '/vfs': {
        target: vfsServerUrl,
        changeOrigin: true,
        secure: false,
        headers: vfsServerUrl === frontControllerUrl ? { host: productionHost } : undefined,
        rewrite: vfsServerUrl === frontControllerUrl ? undefined : (path) => path.replace(/^\/vfs/, ''),
      },
    },
  },
});
