import Phaser from 'phaser';

/**
 * Спрайты из `src/assets/sprites/*.png`. Имя файла = ключ текстуры.
 * Файла нет — объект рисуется процедурно, как раньше, так что арт можно
 * подкладывать по одному. Список нужных файлов и промпты — docs/art/PROMPTS.md.
 */
const urls = import.meta.glob('../assets/sprites/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export const SPRITES: Record<string, string> = Object.fromEntries(
  Object.entries(urls).map(([path, url]) => [path.split('/').pop()!.replace(/\.png$/, ''), url]),
);

/**
 * Где у кадра персонажа «пол»: доля высоты картинки (0 — верх, 1 — низ).
 * Пишет scripts/slice-sheet.mjs: ниже ног может торчать молоток при ударе,
 * поэтому ставить кадр нижней кромкой на пол нельзя — персонаж повиснет.
 */
const anchorFiles = import.meta.glob('../assets/sprites/anchors.json', { eager: true, import: 'default' }) as Record<string, Record<string, number>>;
const ANCHORS: Record<string, number> = Object.values(anchorFiles)[0] ?? {};

export const anchorY = (key: string): number => ANCHORS[key] ?? 1;

export function preloadSprites(scene: Phaser.Scene): void {
  for (const [key, url] of Object.entries(SPRITES)) {
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }
}

export const hasSprite = (scene: Phaser.Scene, key: string) => scene.textures.exists(key);

/** Первый существующий ключ из списка (например, дверь 3-го уровня → door2, если door3 ещё нет). */
export function firstSprite(scene: Phaser.Scene, keys: readonly string[]): string | null {
  return keys.find((k) => scene.textures.exists(k)) ?? null;
}

/**
 * Картинка, вписанная в рамку `maxW × maxH` с сохранением пропорций.
 * originY по умолчанию 1: «стоит» на точке (ноги/основание внизу).
 */
export function fitImage(scene: Phaser.Scene, x: number, y: number, key: string, maxW: number, maxH: number, originY = 1): Phaser.GameObjects.Image {
  const img = scene.add.image(x, y, key).setOrigin(0.5, originY);
  const s = Math.min(maxW / img.width, maxH / img.height);
  return img.setScale(s);
}

/**
 * Уровень двери 1–8 → свой спрайт door_l<уровень>; нет картинки — ближайший уровень ниже.
 * Скин (не 'classic') — сначала door_<скин>_l<уровень>, потом обычные двери.
 */
export function doorKeys(level: number, skin = 'classic'): string[] {
  const keys: string[] = [];
  if (skin !== 'classic') for (let l = level; l >= 1; l--) keys.push(`door_${skin}_l${l}`);
  for (let l = level; l >= 1; l--) keys.push(`door_l${l}`);
  return keys;
}
