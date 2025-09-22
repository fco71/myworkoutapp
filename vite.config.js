import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: './', // Use relative paths
  resolve: {
    alias: {
      // Add any path aliases here if needed
    }
  },
  server: {
    fs: {
      // Allow serving files from one level up from the package root
      allow: ['..']
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html')
      }
    }
  }
});
