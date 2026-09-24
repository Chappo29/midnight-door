import type { BuildKind, Cost, Difficulty } from './types';

/** Шаг симуляции: 20 тиков в секунду. */
export const TICK = 1 / 20;

/** Все числа баланса в одном месте. Стартовые значения, подбираются плейтестами. */
export const B = {
  /** night — только для часов в интерфейсе: рассвета нет, ночь до победы над призраком. */
  phase: { pick: 10, prep: 45, night: 360 },
  startCandy: 20,
  walkSpeed: 3,
  work: { build: 1.2, plant: 1.0, upgrade: 1.2, door: 1.5, sofa: 1.2, sell: 0.5 },
  sofa: { income: 2, incomeMul: 1.45, cost: 30, costMul: 2.2, max: 8 },
  door: [
    { hp: 400, candy: 0, flame: 0 },
    { hp: 800, candy: 60, flame: 0 },
    { hp: 1500, candy: 150, flame: 0 },
    { hp: 2800, candy: 320, flame: 20 },
    { hp: 5000, candy: 650, flame: 60 },
    { hp: 9000, candy: 1200, flame: 150 },
    { hp: 16000, candy: 2200, flame: 350 },
    { hp: 28000, candy: 4000, flame: 800 },
  ],
  /**
   * Починка ключом (как кнопка ремонта в Haunted Dorm): короткая работа, разом
   * возвращает долю макс. HP, потом перезарядка. Бесконечно «держать» дверь нельзя.
   */
  repair: { work: 1.2, amount: 0.3, cooldown: 20 },
  pumpkin: { cost: 40, rate: 1, rateMul: 1.8, upCost: 60, upCostMul: 2, max: 5 },
  cannon: {
    cost: 50,
    dmg: 10,
    dmgMul: 1.9,
    interval: 1,
    /** Радиус 1-го уровня, клеток; каждый уровень добавляет rangePerLevel. */
    range: 3.2,
    rangePerLevel: 0.3,
    upCost: 70,
    upCostMul: 1.9,
    max: 6,
    flameFrom: 3,
    flameCost: 15,
    flameMul: 2,
  },
  items: { lavender: 0.5, safe: 1.5, toolbox: 0.01 },
  sellRefund: 0.5,
  ghost: {
    // Рассвета нет — HP растёт медленно, иначе призрака не убить (подобрано scripts/tune.ts, 2026-09-24).
    hp: 3000,
    hpMul: 1.15,
    dmg: 25,
    dmgMul: 1.31,
    hitInterval: 1.2,
    hitSpeedup: 0.05,
    speed: 2.5,
    enterSpeed: 3.2,
    retreatAt: 0.25,
    healTime: 10,
    /** Какую долю макс. HP восстанавливает в гнезде (не до конца — урон копится). */
    healFrac: 0.4,
    /** Терпение у двери, с: случайное (было 20–60 — «бьёт очень долго»; выбрано 4–12). Кроме него уходит, если осада не идёт (см. ghost.ts).
     *  Короче осада — слабее призрак, поэтому levelEvery у hard/nightmare снижен (tune.ts, 2026-09-24). */
    switchMin: 4,
    switchMax: 12,
    /** Сдаётся, если за осаду потерял эту долю HP, а дверь ещё крепкая. */
    giveUpDamage: 0.3,
  },
  /** Пока пламя не открыто (первый матч), его цена переводится в конфеты. */
  flameToCandy: 10,
  endDelay: 1.5,
} as const;

export interface DiffParams {
  ghostMul: number;
  levelEvery: number;
  npcSkill: number;
}

export const DIFF: Record<Difficulty, DiffParams> = {
  easy: { ghostMul: 0.7, levelEvery: 125, npcSkill: 0.3 },
  hard: { ghostMul: 0.85, levelEvery: 74, npcSkill: 0.6 },
  nightmare: { ghostMul: 1.0, levelEvery: 77, npcSkill: 0.9 },
};

export const sofaIncome = (level: number) => B.sofa.income * B.sofa.incomeMul ** (level - 1);

export function sofaUpCost(level: number): Cost | null {
  if (level >= B.sofa.max) return null;
  return { candy: Math.round(B.sofa.cost * B.sofa.costMul ** (level - 1)), flame: 0 };
}

export const doorMaxHp = (level: number) => B.door[level - 1].hp;

export function doorUpCost(level: number): Cost | null {
  if (level >= B.door.length) return null;
  const next = B.door[level];
  return { candy: next.candy, flame: next.flame };
}

export const pumpkinRate = (level: number) => B.pumpkin.rate * B.pumpkin.rateMul ** (level - 1);

export function pumpkinUpCost(level: number): Cost | null {
  if (level >= B.pumpkin.max) return null;
  return { candy: Math.round(B.pumpkin.upCost * B.pumpkin.upCostMul ** (level - 1)), flame: 0 };
}

export const cannonDmg = (level: number) => B.cannon.dmg * B.cannon.dmgMul ** (level - 1);
/** Докуда бьёт пушка: с уровнем дальше (для всех — и игрока, и соседей). */
export const cannonRange = (level: number) => B.cannon.range + B.cannon.rangePerLevel * (level - 1);

export function cannonUpCost(level: number): Cost | null {
  const c = B.cannon;
  if (level >= c.max) return null;
  const next = level + 1;
  return {
    candy: Math.round(c.upCost * c.upCostMul ** (level - 1)),
    flame: next >= c.flameFrom ? Math.round(c.flameCost * c.flameMul ** (next - c.flameFrom)) : 0,
  };
}

export function buildBaseCost(kind: BuildKind): Cost {
  return { candy: kind === 'cannon' ? B.cannon.cost : B.pumpkin.cost, flame: 0 };
}

export function adjustCost(c: Cost, flameUnlocked: boolean): Cost {
  return flameUnlocked ? c : { candy: c.candy + c.flame * B.flameToCandy, flame: 0 };
}
