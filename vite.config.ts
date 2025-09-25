import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 8000,
    open: '/Applications/Safari.app',
  },
  preview: {
    port: 8000,
    open: '/Applications/Safari.app',
  },
});
