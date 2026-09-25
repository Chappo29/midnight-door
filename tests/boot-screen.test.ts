import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Пока грузятся картинки и звуки, ребёнок видит заставку, а не чёрный экран: «нажал — погасло»
 * читается как «сломалось» (GAME_AUDIT.md, Top-10). Браузер тут не поднять — сверяем разметку и код.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('заставка загрузки', () => {
  it('test_boot_screen_is_in_html_before_bundle', () => {
    const html = read('../index.html');
    const boot = html.indexOf('id="boot"');
    expect(boot).toBeGreaterThan(0);
    expect(boot).toBeLessThan(html.indexOf('src/main.ts'));
  });

  it('test_game_start_never_waits_for_assets_on_blank_screen', () => {
    const main = read('../src/main.ts');
    // После скрытия окна ассеты ждём только через whenLoaded(), которая показывает заставку.
    expect(main).not.toMatch(/hideScreen\(\);\s*await spritesReady/);
    expect(main.match(/await whenLoaded\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
