/**
 * Иконки кнопок-наклеек (`src/assets/ui/*.png`, нарисованы в ChatGPT по образцу спрайтов игры).
 * Лежат отдельно от `assets/sprites`, чтобы Phaser не грузил их как текстуры карты.
 * Исходные листы — docs/art/source/icons/, нарезка — scripts/slice-grid.mjs.
 */
const urls = import.meta.glob('../assets/ui/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const UI_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(urls).map(([path, url]) => [path.split('/').pop()!.replace(/\.png$/, ''), url]),
);

export type UiIcon = 'home' | 'repair' | 'pause' | 'sound_on' | 'sound_off' | 'skip';

/** `<img>` иконки-наклейки; нет файла — пустая строка (кнопка останется с подписью в aria-label). */
export function uiIcon(key: UiIcon, cls = 'ui-ico'): string {
  const url = UI_ICONS[key];
  return url ? `<img class="${cls}" src="${url}" alt="" draggable="false">` : '';
}
