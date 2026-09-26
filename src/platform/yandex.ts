/**
 * Yandex Games SDK: загрузка и минимальные типы того, чем пользуется игра.
 * Сверено с документацией (yandex.ru/dev/games/doc/ru/sdk/sdk-player, 2026-09-26):
 * getPlayer — не чаще 20 раз за 5 мин; getData/setData — 100 раз за 5 мин; данные игрока ≤ 200 КБ;
 * setData(data, flush): flush=true — отправить сразу, false — в очередь SDK.
 * player.getMode() устарел — не используем, авторизацию проверяет isAuthorized().
 *
 * Нет SDK (локальная разработка, сеть, блокировщик) — функции возвращают null, игра идёт без него.
 */

/** Облачные данные игрока (Player Data). */
export interface YaPlayer {
  isAuthorized(): boolean;
  getData(keys?: string[]): Promise<Record<string, unknown>>;
  setData(data: Record<string, unknown>, flush?: boolean): Promise<void>;
}

/** safeStorage: интерфейс как у localStorage, но переживает очистку хранилища (iOS). */
export interface YaStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface YaSdk {
  getPlayer(opts?: { signed?: boolean }): Promise<YaPlayer>;
  getStorage(): Promise<YaStorage>;
  auth: { openAuthDialog(): Promise<void> };
}

declare global {
  interface Window {
    YaGames?: { init(): Promise<YaSdk> };
  }
}

/** Промис с потолком по времени: SDK и сеть не должны вешать заставку. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: timeout ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Подключить /sdk.js (его раздаёт хостинг Яндекс Игр) и дождаться YaGames. */
function loadScript(): Promise<void> {
  if (window.YaGames) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/sdk.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('sdk.js not loaded'));
    document.head.appendChild(s);
  });
}

/** SDK или null, если его нет или он не успел за timeoutMs. Не бросает. */
export async function initYandexSdk(timeoutMs = 4000): Promise<YaSdk | null> {
  try {
    return await withTimeout(
      loadScript().then(() => {
        if (!window.YaGames) throw new Error('YaGames missing');
        return window.YaGames.init();
      }),
      timeoutMs,
      'YaGames.init',
    );
  } catch (e) {
    if (import.meta.env.DEV) console.info('[Save] Yandex SDK unavailable:', (e as Error).message);
    return null;
  }
}
