/// <reference types="vitest/config" />
import { configDefaults } from 'vitest/config';
import { defineConfig } from 'vite';

// Яндекс Игры раздают архив с произвольного пути, поэтому все ссылки относительные.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    // Явный целевой уровень: по умолчанию Vite берёт Safari 16 / Chrome 107 — старые телефоны (iOS 12–15, Android 7+)
    // получали пустой экран. es2019 понимают Chrome 73+, Safari 12.1+, Firefox 64+ (RA-07).
    target: 'es2019',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    // .claude/worktrees — копии проекта для отдельных задач; их тесты здесь не гоняем.
    exclude: [...configDefaults.exclude, '.claude/**', '.omc/**'],
  },
});
