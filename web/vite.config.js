import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name][extname]' } },
  },
});
