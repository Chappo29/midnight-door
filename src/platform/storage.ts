import { TUTORIAL_GIFT, normalizeMeta, type Meta } from '../meta/economy';
import { loadUnlocks, type Unlocks } from '../meta/unlocks';
import type { Difficulty } from '../sim/types';

/**
 * Прогресс между матчами — всё, что переживает перезагрузку. Хранит и пишет его только
 * ProgressStore (platform/save.ts): здесь схема и починка данных, без хранилищ.
 * Состояние матча (конфеты, пламя, HP, постройки, позиции) сюда не попадает никогда.
 */
export interface Progress {
  /** Завершённые матчи (обучение не считается). Меняется только через recordMatchOutcome. */
  matches: number;
  wins: Record<Difficulty, number>;
  /** Обучение: пройдено или пропущено — больше не показываем само (правило Яндекса 1.9). */
  tutorial?: 'done' | 'skipped';
  /** Подсказки, которые уже показывали (каждая — один раз). */
  hints: string[];
  /** Монеты, магазин, ежедневный подарок. */
  meta: Meta;
  /** Какие постройки открыты и что из «Новое!» уже показано (meta/unlocks.ts). */
  unlocks: Unlocks;
  /** Настройки игрока. */
  settings: Settings;
}

export interface Settings {
  /** Звук выключен кнопкой в игре. */
  muted: boolean;
}

/** Профиль нового игрока: обучение не пройдено, матчей нет, всё закрыто. */
export function emptyProgress(): Progress {
  return {
    matches: 0,
    wins: { easy: 0, hard: 0, nightmare: 0 },
    hints: [],
    meta: normalizeMeta(undefined),
    unlocks: loadUnlocks(undefined, 0),
    settings: { muted: false },
  };
}

/** Целое ≥ 0 из сохранения; мусор — 0. */
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/**
 * Прогресс из данных сохранения любой версии: недостающие и битые поля — по умолчанию,
 * остальное сохраняется. Старые сохранения (до unlocks и settings) проходят через это же.
 */
export function normalizeProgress(raw: unknown): Progress {
  const e = emptyProgress();
  if (!raw || typeof raw !== 'object') return e;
  const p = raw as Record<string, unknown>;
  // От счётчика зависят открытия построек: битое значение (строка, NaN, минус) не должно запереть их навсегда.
  const matches = count(p.matches);
  const wins = (p.wins && typeof p.wins === 'object' ? p.wins : {}) as Record<string, unknown>;
  const settings = (p.settings && typeof p.settings === 'object' ? p.settings : {}) as Record<string, unknown>;
  return {
    matches,
    wins: { easy: count(wins.easy), hard: count(wins.hard), nightmare: count(wins.nightmare) },
    tutorial: p.tutorial === 'done' || p.tutorial === 'skipped' ? p.tutorial : undefined,
    // Строка вместо массива роняла цикл Phaser на первой подсказке (GAME_AUDIT.md).
    hints: Array.isArray(p.hints) ? Array.from(new Set(p.hints.filter((h): h is string => typeof h === 'string'))) : [],
    meta: normalizeMeta(p.meta && typeof p.meta === 'object' ? (p.meta as Partial<Meta>) : undefined),
    // Старое сохранение (без поля) — открыто то, что заработано матчами, без экранов «Новое!».
    unlocks: loadUnlocks(p.unlocks, matches),
    settings: { muted: settings.muted === true },
  };
}

// ---------------- обучение ----------------

/**
 * Что показать при запуске: самый первый вход — сразу «Ночь 0», иначе меню.
 * Играл до появления обучения (есть матчи) — не заставляем проходить: отмечаем пройденным.
 * Вернёт true, если прогресс изменился и его нужно сохранить.
 */
export function resolveTutorialOnBoot(p: Progress): { start: 'tutorial' | 'menu'; changed: boolean } {
  if (p.tutorial) return { start: 'menu', changed: false };
  if (p.matches > 0) {
    p.tutorial = 'done';
    return { start: 'menu', changed: true };
  }
  return { start: 'tutorial', changed: false };
}

/**
 * Конец обучения: пройдено, пропущено или брошено выходом в меню (тоже «пропущено» —
 * само оно больше не запустится). Пройденное не становится «пропущенным» при повторе из меню.
 * Подарок — один раз за всю игру. Матчи, монеты и открытия не трогаются. Вернёт подарок (0 — не положен).
 */
export function finishTutorial(p: Progress, how: 'done' | 'skipped'): number {
  if (how === 'done' || !p.tutorial) p.tutorial = how;
  if (how !== 'done' || p.meta.tutorialGift) return 0;
  p.meta.tutorialGift = true;
  p.meta.coins += TUTORIAL_GIFT;
  return TUTORIAL_GIFT;
}
