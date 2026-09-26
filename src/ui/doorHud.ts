/**
 * Индикатор своей двери внизу экрана: когда он виден и насколько громкий.
 * - дверь целая и никто не идёт — индикатора нет;
 * - призрак выбрал игрока целью — плавно появляется; дверь бьют — остаётся;
 * - HP < DOOR_HUD_HURT — заметнее (оранжевый, крупнее);
 * - HP < DOOR_HUD_DANGER — красный и трясётся (ключ ремонта в это время уже мигает, см. Hud.update);
 * - призрак ушёл и дверь не в опасности — через DOOR_HUD_LINGER с плавно скрывается.
 * Чистая функция: время передаётся снаружи, чтобы проверять тестами.
 */

/** Ниже этой доли HP индикатор заметнее. */
export const DOOR_HUD_HURT = 0.5;
/** Ниже этой доли HP — красный и трясётся, виден и без призрака (дверь надо чинить). */
export const DOOR_HUD_DANGER = 0.3;
/** Сколько секунд индикатор ещё виден после того, как опасность прошла. */
export const DOOR_HUD_LINGER = 2.5;

export type DoorHudLevel = 'ok' | 'hurt' | 'danger';

export interface DoorHudInput {
  /** Сейчас ночь, игрок в своей комнате и не пойман, дверь цела. */
  active: boolean;
  /** Призрак идёт к двери игрока, бьёт её или входит. */
  threat: boolean;
  /** Доля HP двери, 0..1. */
  frac: number;
  /** Текущее время, с. */
  now: number;
  /** До какого времени индикатор держится после последней опасности (из прошлого вызова). */
  until: number;
}

export function doorHudState(p: DoorHudInput): { visible: boolean; until: number; level: DoorHudLevel } {
  const level: DoorHudLevel = p.frac < DOOR_HUD_DANGER ? 'danger' : p.frac < DOOR_HUD_HURT ? 'hurt' : 'ok';
  if (!p.active) return { visible: false, until: 0, level };
  const alarm = p.threat || level === 'danger';
  const until = alarm ? p.now + DOOR_HUD_LINGER : p.until;
  return { visible: p.now < until, until, level };
}
