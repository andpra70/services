import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    minify: 'esbuild',
    outDir: '../public',
    emptyOutDir: false,
    lib: {
      entry: 'src/widget/widget-entry.jsx',
      name: 'VfsWidgetBundle',
      formats: ['iife'],
      fileName: () => 'vfs-widget.js',
    },
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
