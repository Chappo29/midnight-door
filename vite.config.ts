/// <reference types="vitest/config" />
import { configDefaults } from 'vitest/config';
import { defineConfig } from 'vite';

// Яндекс Игры раздают архив с произвольного пути, поэтому все ссылки относительные.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    // .claude/worktrees — копии проекта для отдельных задач; их тесты здесь не гоняем.
    exclude: [...configDefaults.exclude, '.claude/**', '.omc/**'],
  },
});
