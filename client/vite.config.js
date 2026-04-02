import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const appBase = process.env.VITE_APP_BASE || './';
const oauthProxyTarget = process.env.VITE_OAUTH_PROXY_TARGET || '';
const normalizedAppBase = appBase === './' || appBase === '/' ? '' : `/${String(appBase).replace(/^\/+|\/+$/g, '')}`;
const apiProxyPath = normalizedAppBase ? `${normalizedAppBase}/api` : '/api';
const dataFilesProxyPath = normalizedAppBase ? `${normalizedAppBase}/data/files` : '/data/files';

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
      [apiProxyPath]: {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (requestPath) => {
          if (requestPath.startsWith(apiProxyPath)) {
            return `/api${requestPath.slice(apiProxyPath.length)}`;
          }
          return requestPath;
        },
      },
      [dataFilesProxyPath]: {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (requestPath) => {
          if (requestPath.startsWith(dataFilesProxyPath)) {
            return `/data/files${requestPath.slice(dataFilesProxyPath.length)}`;
          }
          return requestPath;
        },
      },
      '/oauth-server': {
        target: oauthProxyTarget || 'http://localhost:9000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
