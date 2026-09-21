import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const appBase = process.env.VITE_APP_BASE || './';
const frontControllerUrl = process.env.VITE_FRONT_CONTROLLER_URL || 'https://127.0.0.1:8443';
const productionHost = process.env.VITE_BACKEND_HOST || 'belle.iliadboxos.it';
const proxyLogEnabled = process.env.VITE_PROXY_LOG === 'true';
const localWidgetPath = fileURLToPath(new URL('../public/vfs-widget.js', import.meta.url));

function proxyLogger(label, target) {
  if (!proxyLogEnabled) return undefined;
  const requests = new WeakMap();
  let sequence = 0;
  const safePath = (request) => String(request.url || '/').split('?')[0];
  return (proxy) => {
    proxy.on('proxyReq', (_proxyRequest, request) => {
      const trace = { id: ++sequence, startedAt: Date.now() };
      requests.set(request, trace);
      console.log(`[proxy:${label}] #${trace.id} -> ${request.method} ${safePath(request)} forwarded=${target}${safePath(request)}`);
    });
    proxy.on('proxyRes', (proxyResponse, request) => {
      const trace = requests.get(request) || { id: '?', startedAt: Date.now() };
      console.log(`[proxy:${label}] #${trace.id} <- ${proxyResponse.statusCode} ${request.method} ${safePath(request)} ${Date.now() - trace.startedAt}ms`);
    });
    proxy.on('error', (error, request) => {
      const trace = requests.get(request) || { id: '?', startedAt: Date.now() };
      console.error(`[proxy:${label}] #${trace.id} !! ${request.method} ${safePath(request)} ${Date.now() - trace.startedAt}ms ${error.code || error.message}`);
    });
  };
}

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
        configure: proxyLogger('AUTH', frontControllerUrl),
      },
      '/vfs': {
        target: frontControllerUrl,
        changeOrigin: true,
        secure: false,
        headers: { host: productionHost },
        configure: proxyLogger('VFS', frontControllerUrl),
      },
    },
  },
});
