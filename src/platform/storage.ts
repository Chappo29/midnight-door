import { normalizeMeta, type Meta } from '../meta/economy';
import type { Difficulty } from '../sim/types';

/** Прогресс между матчами. Пока localStorage; при интеграции SDK — облачные сохранения Яндекса. */
export interface Progress {
  matches: number;
  wins: Record<Difficulty, number>;
  /** Обучение: пройдено или пропущено — больше не показываем само (правило Яндекса 1.9). */
  tutorial?: 'done' | 'skipped';
  /** Подсказки, которые уже показывали (каждая — один раз). */
  hints: string[];
  /** Монеты, магазин, ежедневный подарок. */
  meta: Meta;
}

const KEY = 'midnight-door-progress';

export function loadProgress(): Progress {
  const empty: Progress = { matches: 0, wins: { easy: 0, hard: 0, nightmare: 0 }, hints: [], meta: normalizeMeta(undefined) };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<Progress>;
    return { matches: p.matches ?? 0, wins: { ...empty.wins, ...p.wins }, tutorial: p.tutorial, hints: p.hints ?? [], meta: normalizeMeta(p.meta) };
  } catch {
    return empty;
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Приватный режим или запрет хранилища — играем без сохранения.
  }
}
