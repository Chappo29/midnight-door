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
  sofa: {
    income: 2,
    incomeMul: 1.45,
    cost: 30,
    costMul: 2.2,
    max: 8,
    /** Диван апается только вслед за дверью: индекс — целевой уровень дивана (2..8), значение — нужный уровень двери. */
    needDoor: [0, 0, 1, 2, 3, 3, 4, 5, 6],
  },
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
  /** Поздние постройки открываются уровнем двери прямо в матче (не номером матча). */
  unlock: { trap: 2, workbench: 3, fridge: 4 },
  /**
   * Капкан: призрак в радиусе застывает на hold с (пушки продолжают бить), потом капкан перезаряжается.
   * После удержания immune с его не хватает ни один капкан. up — цены ур. 2 и 3.
   */
  trap: {
    cost: { candy: 60, flame: 0 },
    up: [
      { candy: 120, flame: 0 },
      { candy: 300, flame: 40 },
    ],
    hold: [1.5, 2, 2.5],
    recharge: [30, 25, 20],
    radius: 2.3,
    immune: 4,
    maxPerRoom: 2,
  },
  /** Верстак: ночью каждые interval с чинит дверь на долю heal её макс. HP. */
  workbench: {
    cost: { candy: 150, flame: 0 },
    up: [
      { candy: 300, flame: 30 },
      { candy: 700, flame: 120 },
    ],
    heal: [0.015, 0.025, 0.035],
    interval: 4,
    maxPerRoom: 1,
  },
  /** Холодильник: призрак бьёт дверь этой комнаты на долю slow реже. */
  fridge: {
    cost: { candy: 100, flame: 10 },
    up: [
      { candy: 280, flame: 50 },
      { candy: 650, flame: 150 },
    ],
    slow: [0.2, 0.28, 0.35],
    maxPerRoom: 1,
  },
  /**
   * Дух (пойманный игрок): летает сквозь стены со скоростью speed.
   * «Бу!» — призрак в booRange клеток замирает на booHold с, откат booCd.
   * «Искорка» — пушка соседа в sparkRange от духа бьёт ×sparkMul sparkTime с, откат sparkCd.
   */
  spirit: { speed: 4.5, booRange: 4, booHold: 1.5, booCd: 25, sparkRange: 5, sparkMul: 1.5, sparkTime: 8, sparkCd: 20 },
  /** Воскрешение (раз за матч, реклама за награду): дверь с долей doorHp HP, protect с призрак не идёт к этой комнате. */
  revive: { doorHp: 0.5, protect: 15 },
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
     *  Короче осада — меньше ударов, а уровень теперь растёт от ударов (hitsPerLevel в DIFF). */
    switchMin: 4,
    switchMax: 12,
    /** Сдаётся, если за осаду потерял эту долю HP, а дверь ещё крепкая. */
    giveUpDamage: 0.3,
    /** Каждый следующий уровень требует на эту долю больше ударов (от hitsPerLevel). */
    xpGrowth: 0.05,
    /** Новый уровень лечит эту долю макс. HP. */
    levelHeal: 0.1,
  },
  /** Пока пламя не открыто (первый матч), его цена переводится в конфеты. */
  flameToCandy: 10,
  endDelay: 1.5,
  /** Настройки ИИ соседей, не завязанные на характер (npc.ts). */
  npc: {
    /** Диван упёрся в дверь — сосед налегает на дверь сильнее (сверху на behind). */
    sofaBlockedDoorMul: 1.5,
    /** Желание поставить капкан: base + perSkill·skill (умный ценит его выше), умножается на profile.trap. */
    trapBase: 0.5,
    trapPerSkill: 1,
    /**
     * Капкан ставится не дальше (радиус − запас) от места, где призрак ломает дверь. Клетки сбоку от прохода
     * у двери — в √5 ≈ 2.24 от этого места, так что запас маленький, иначе капкану негде стоять.
     */
    trapReachMargin: 0.05,
    /** Улучшить капкан: доля от желания поставить новый. */
    trapUpMul: 0.5,
    /** Трусишка берёт холодильник, только когда пушек уже столько. */
    fridgeAfterCannons: 2,
    /** ИИ-дух (только ИИ-игрок): думает раз в min–max с, «Бу!» по двери — когда у неё меньше этой доли HP. */
    spiritThinkMin: 0.5,
    spiritThinkMax: 1.5,
    spiritBooDoor: 0.4,
  },
} as const;

export interface DiffParams {
  ghostMul: number;
  /** Полных ударов по дверям на первый новый уровень (дальше растёт на xpGrowth за уровень). */
  hitsPerLevel: number;
  /** Страховка: столько секунд без нового уровня — и уровень +1 сам (любой новый уровень сбрасывает счёт). */
  levelFallback: number;
  npcSkill: number;
}

// hitsPerLevel/levelFallback подобраны scripts/tune.ts (этап B, 2026-09-24) — предварительно, этап E перемеряет.
export const DIFF: Record<Difficulty, DiffParams> = {
  easy: { ghostMul: 0.7, hitsPerLevel: 27, levelFallback: 200, npcSkill: 0.3 },
  hard: { ghostMul: 0.85, hitsPerLevel: 21, levelFallback: 115, npcSkill: 0.6 },
  nightmare: { ghostMul: 1.0, hitsPerLevel: 22, levelFallback: 125, npcSkill: 0.9 },
};

export const sofaIncome = (level: number) => B.sofa.income * B.sofa.incomeMul ** (level - 1);

export function sofaUpCost(level: number): Cost | null {
  if (level >= B.sofa.max) return null;
  return { candy: Math.round(B.sofa.cost * B.sofa.costMul ** (level - 1)), flame: 0 };
}

/** Какой уровень двери нужен, чтобы прокачать диван до targetLevel (2..8). За пределами таблицы — не заперто. */
export const sofaNeedDoor = (targetLevel: number) => B.sofa.needDoor[targetLevel] ?? 0;

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
  switch (kind) {
    case 'cannon':
      return { candy: B.cannon.cost, flame: 0 };
    case 'pumpkin':
      return { candy: B.pumpkin.cost, flame: 0 };
    case 'trap':
    case 'workbench':
    case 'fridge':
      return { ...B[kind].cost };
  }
}

/** Поздние постройки (капкан, верстак, холодильник) — у них по три уровня. */
export type LateKind = 'trap' | 'workbench' | 'fridge';
export const LATE_KINDS: readonly LateKind[] = ['trap', 'workbench', 'fridge'];
export const isLateKind = (kind: BuildKind): kind is LateKind => kind === 'trap' || kind === 'workbench' || kind === 'fridge';

/** Какой уровень двери открывает постройку (0 — открыта сразу). */
export const unlockDoor = (kind: BuildKind): number => (isLateKind(kind) ? B.unlock[kind] : 0);

/** Цена улучшения поздней постройки с уровня level; null — уже максимум. */
export function extraUpCost(kind: LateKind, level: number): Cost | null {
  const up = B[kind].up[level - 1];
  return up ? { ...up } : null;
}

/** Параметр уровня level из таблицы по уровням (1..3). */
const byLevel = (t: readonly number[], level: number) => t[Math.min(t.length, Math.max(1, level)) - 1];
export const trapHold = (level: number) => byLevel(B.trap.hold, level);
export const trapRecharge = (level: number) => byLevel(B.trap.recharge, level);
export const benchHeal = (level: number) => byLevel(B.workbench.heal, level);
export const fridgeSlow = (level: number) => byLevel(B.fridge.slow, level);

export function adjustCost(c: Cost, flameUnlocked: boolean): Cost {
  return flameUnlocked ? c : { candy: c.candy + c.flame * B.flameToCandy, flame: 0 };
}
