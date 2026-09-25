import type { Difficulty } from '../sim/types';

/**
 * Прогресс между матчами: монеты, магазин, ежедневный подарок.
 * Чистые функции над данными сохранения — без интерфейса, чтобы проверять тестами.
 * Цены и награды — здесь, в одном месте (данные, а не код экранов).
 */

export type BoosterId = 'candy' | 'door' | 'wrench';
export type SkinSlot = 'door' | 'cannon';

/** То, что хранится между матчами (часть сохранения). */
export interface Meta {
  coins: number;
  /** Купленные герои (номера charN). Нулевой есть всегда. */
  heroes: number[];
  hero: number;
  /** Купленные скины по слотам; 'classic' есть всегда. */
  skins: Record<SkinSlot, string[]>;
  skin: Record<SkinSlot, string>;
  /** Сколько усилителей куплено: сработают в следующем матче. */
  boosters: Record<BoosterId, number>;
  /** Ежедневный подарок: день последнего получения (YYYY-MM-DD) и шаг календаря 0–6. */
  daily: { last: string; step: number };
  /** Подарок за пройденное обучение уже выдан. */
  tutorialGift: boolean;
}

export function emptyMeta(): Meta {
  return {
    coins: 0,
    heroes: [0],
    hero: 0,
    skins: { door: ['classic'], cannon: ['classic'] },
    skin: { door: 'classic', cannon: 'classic' },
    boosters: { candy: 0, door: 0, wrench: 0 },
    daily: { last: '', step: 0 },
    tutorialGift: false,
  };
}

/** Целое ≥ 0 из сохранения; мусор (NaN, строка, минус) — значение по умолчанию. */
function safeInt(n: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const v = typeof n === 'number' ? Math.floor(n) : NaN;
  return Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
}

/**
 * Дочинить сохранение старой версии или испорченное: недостающие и битые поля — по умолчанию.
 * Иначе NaN в монетах «открывал» бы все покупки (NaN < цена всегда false).
 */
export function normalizeMeta(raw: Partial<Meta> | undefined): Meta {
  const e = emptyMeta();
  const m = { ...e, ...raw };
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const heroes = Array.from(new Set([0, ...list<number>(m.heroes).filter((h) => HEROES.some((q) => q.look === h))]));
  const skins = {
    door: Array.from(new Set(['classic', ...list<string>(m.skins?.door)])),
    cannon: Array.from(new Set(['classic', ...list<string>(m.skins?.cannon)])),
  };
  return {
    coins: safeInt(m.coins, 0),
    heroes,
    hero: heroes.includes(m.hero) ? m.hero : 0,
    skins,
    // Выбранный скин — только из купленных.
    skin: {
      door: skins.door.includes(m.skin?.door as string) ? (m.skin!.door as string) : 'classic',
      cannon: skins.cannon.includes(m.skin?.cannon as string) ? (m.skin!.cannon as string) : 'classic',
    },
    boosters: {
      candy: safeInt(m.boosters?.candy, 0, BOOSTER_MAX),
      door: safeInt(m.boosters?.door, 0, BOOSTER_MAX),
      wrench: safeInt(m.boosters?.wrench, 0, BOOSTER_MAX),
    },
    daily: { last: typeof m.daily?.last === 'string' ? m.daily.last : '', step: safeInt(m.daily?.step, 0, DAILY.length - 1) },
    tutorialGift: !!m.tutorialGift,
  };
}

// ---------------- магазин ----------------

/** Герои: номер = картинка charN. Первый бесплатный, остальные — цель «накопить». */
export const HEROES: readonly { look: number; price: number }[] = [
  { look: 0, price: 0 },
  { look: 1, price: 150 },
  { look: 2, price: 200 },
  { look: 3, price: 250 },
  { look: 4, price: 300 },
  { look: 5, price: 400 },
];

/** Скины. ready=false — картинка ещё не нарисована, в магазине «скоро». */
export const SKINS: Record<SkinSlot, readonly { id: string; name: string; price: number; ready: boolean }[]> = {
  door: [
    { id: 'classic', name: 'Деревянная', price: 0, ready: true },
    { id: 'ginger', name: 'Пряничная', price: 250, ready: true },
    { id: 'ice', name: 'Ледяная', price: 350, ready: true },
    { id: 'candy', name: 'Карамельная', price: 500, ready: true },
  ],
  cannon: [
    { id: 'classic', name: 'Карамельная', price: 0, ready: true },
    // Темы — в пару к скинам двери. Не «мятная/золотая»: так уже выглядят 3-й и 5-й уровни обычной пушки.
    { id: 'ginger', name: 'Пряничная', price: 200, ready: true },
    { id: 'ice', name: 'Ледяная', price: 450, ready: true },
  ],
};

/** Усилители на один матч: покупаешь заранее — срабатывают в следующем матче. */
export const BOOSTERS: Record<BoosterId, { title: string; desc: string; price: number }> = {
  candy: { title: 'Мешок конфет', desc: '+100 конфет в начале', price: 40 },
  door: { title: 'Крепкая дверь', desc: 'дверь сразу ур. 2', price: 60 },
  wrench: { title: 'Быстрый ключ', desc: 'ключ заряжается вдвое быстрее', price: 50 },
};
/** Больше этого за раз не накопить — чтобы не скупали «про запас» всё подряд. */
export const BOOSTER_MAX = 3;

/** Что делают усилители в матче (MatchOptions.boosters). */
export interface MatchBoosters {
  candy: number;
  doorLevel: number;
  repairMul: number;
}

export type BuyError = 'Не хватает монет' | 'Уже есть' | 'Скоро' | 'Больше не взять';

export function buyHero(m: Meta, look: number): BuyError | null {
  const h = HEROES.find((q) => q.look === look);
  if (!h || m.heroes.includes(look)) return 'Уже есть';
  if (m.coins < h.price) return 'Не хватает монет';
  m.coins -= h.price;
  m.heroes.push(look);
  m.hero = look;
  return null;
}

export function selectHero(m: Meta, look: number): boolean {
  if (!m.heroes.includes(look)) return false;
  m.hero = look;
  return true;
}

/** catalog — для тестов: какие скины уже нарисованы, меняется по мере арта. */
export function buySkin(m: Meta, slot: SkinSlot, id: string, catalog = SKINS): BuyError | null {
  const s = catalog[slot].find((q) => q.id === id);
  if (!s || m.skins[slot].includes(id)) return 'Уже есть';
  if (!s.ready) return 'Скоро';
  if (m.coins < s.price) return 'Не хватает монет';
  m.coins -= s.price;
  m.skins[slot].push(id);
  m.skin[slot] = id;
  return null;
}

export function buyBooster(m: Meta, id: BoosterId): BuyError | null {
  if (m.boosters[id] >= BOOSTER_MAX) return 'Больше не взять';
  if (m.coins < BOOSTERS[id].price) return 'Не хватает монет';
  m.coins -= BOOSTERS[id].price;
  m.boosters[id]++;
  return null;
}

/** Какие усилители поедут в матч (по одному каждого купленного). Ничего не списывает. */
export function planBoosters(m: Meta): MatchBoosters {
  return {
    candy: m.boosters.candy > 0 ? 100 : 0,
    doorLevel: m.boosters.door > 0 ? 2 : 1,
    repairMul: m.boosters.wrench > 0 ? 0.5 : 1,
  };
}

/**
 * Списать усилители, которые реально сработали в матче (plan — из planBoosters).
 * Зовётся, когда началась ночь: вышел раньше — покупки остаются у ребёнка (GAME_AUDIT.md, Top-4).
 */
export function spendBoosters(m: Meta, plan: MatchBoosters): void {
  if (plan.candy > 0 && m.boosters.candy > 0) m.boosters.candy--;
  if (plan.doorLevel > 1 && m.boosters.door > 0) m.boosters.door--;
  if (plan.repairMul < 1 && m.boosters.wrench > 0) m.boosters.wrench--;
}

/** Забрать по одному каждого купленного усилителя на этот матч. */
export function takeBoosters(m: Meta): MatchBoosters {
  const b = planBoosters(m);
  spendBoosters(m, b);
  return b;
}

// ---------------- награда за матч ----------------

export interface Reward {
  coins: number;
  /** Из чего сложилась — показываем на экране итогов. */
  parts: { label: string; coins: number }[];
}

const WIN_BASE: Record<Difficulty, number> = { easy: 30, hard: 60, nightmare: 100 };
/** Командная победа (добили, пока игрок был духом): доля от обычной награды за победу. */
const TEAM_WIN_MUL = 0.5;

/**
 * Монеты за матч. Проигрыш тоже что-то даёт (за каждую минуту ночи) — чтобы ребёнок
 * не уходил с пустыми руками; победа заметно выгоднее. teamWin — победили, когда игрок был духом:
 * база победы вдвое меньше, за соседей как обычно.
 */
export function matchReward(win: boolean, difficulty: Difficulty, nightSeconds: number, neighborsAlive: number, teamWin = false): Reward {
  const parts: Reward['parts'] = [];
  if (win) {
    if (teamWin) parts.push({ label: 'командная победа', coins: Math.round(WIN_BASE[difficulty] * TEAM_WIN_MUL) });
    else parts.push({ label: 'победа', coins: WIN_BASE[difficulty] });
    if (neighborsAlive > 0) parts.push({ label: 'соседи', coins: neighborsAlive * 5 });
  } else {
    parts.push({ label: 'за старание', coins: 10 });
    const minutes = Math.min(10, Math.floor(nightSeconds / 60));
    if (minutes > 0) parts.push({ label: 'продержался', coins: minutes * 3 });
  }
  return { coins: parts.reduce((s, p) => s + p.coins, 0), parts };
}

/**
 * Монеты, если ребёнок сам вышел из матча в меню (null — ничего не положено: ночь ещё не началась).
 * Поймали — как за поражение: игра не должна «отнимать заработанное».
 * Вышел живым посреди ночи — только «продержался» (без «за старание»): иначе быстрый выход
 * выгоднее честного матча.
 */
export function exitReward(caught: boolean, difficulty: Difficulty, nightSeconds: number, neighborsAlive: number): Reward | null {
  if (caught) return matchReward(false, difficulty, nightSeconds, neighborsAlive);
  const held = matchReward(false, difficulty, nightSeconds, neighborsAlive).parts.filter((p) => p.label === 'продержался');
  return held.length ? { coins: held.reduce((s, p) => s + p.coins, 0), parts: held } : null;
}

/** Подарок за пройденное обучение: сразу хватает на первую покупку. */
export const TUTORIAL_GIFT = 60;

// ---------------- ежедневный подарок ----------------

/** Календарь на 7 дней; 7-й — крупный. Пропуск дня не сбрасывает (детям обидно терять серию). */
export const DAILY: readonly number[] = [20, 30, 40, 50, 60, 80, 150];

/** Ключ дня по местному времени. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dailyAvailable(m: Meta, today: string): boolean {
  return m.daily.last !== today;
}

/** Забрать подарок дня. Возвращает монеты (0 — сегодня уже забран). */
export function claimDaily(m: Meta, today: string): number {
  if (!dailyAvailable(m, today)) return 0;
  const coins = DAILY[m.daily.step % DAILY.length];
  m.coins += coins;
  m.daily = { last: today, step: (m.daily.step + 1) % DAILY.length };
  return coins;
}
