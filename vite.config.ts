import { defineConfig } from 'vite';

// Яндекс Игры раздают архив с произвольного пути, поэтому все ссылки относительные.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
