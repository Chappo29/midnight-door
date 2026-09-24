import { TICK } from '../src/sim/balance';
import { Match, type MatchOptions } from '../src/sim/match';
import type { BuildKind, Building, Room } from '../src/sim/types';

/** Матч с игроком уже в комнате 2 (лёгкая сложность, пламя открыто), дошедшим до места — готов к прогону в prep. */
export function inRoomMatch(opts: Partial<MatchOptions> = {}): Match {
  const m = new Match({ seed: 7, difficulty: 'easy', flameUnlocked: true, ...opts });
  m.command(0, { type: 'pickRoom', roomId: 2 });
  while (m.phase === 'pick') m.step();
  while (m.phase === 'prep' && m.player.path.length) m.step();
  return m;
}

/** Пропускает остаток подготовки и переводит матч в ночь. */
export function nightNow(m: Match): void {
  m.phaseLeft = 0;
  while (m.phase !== 'night') m.step();
}

/** Шагает, пока предикат не станет истинным, но не дольше maxSec секунд. */
export function runUntil(m: Match, pred: (m: Match) => boolean, maxSec: number): void {
  for (let i = 0; i < maxSec * 20 && !pred(m); i++) m.step();
}

/** Шагает ровно sec секунд. */
export function stepSec(m: Match, sec: number): void {
  for (let i = 0; i < Math.round(sec * 20); i++) m.step();
}

/** Ждёт, пока текущее дело игрока не закончится (максимум 10 с). */
export function finishTask(m: Match): void {
  runUntil(m, (mm) => mm.player.task === null, 10);
}

/**
 * Ставит призрака бить дверь комнаты room со следующего тика и не даёт ему передумать:
 * терпение бесконечное, осада «только началась», HP полное. Предметы комнаты убраны —
 * аптечка чинит дверь, лаванда меняет конфеты.
 */
export function pinGhostAtDoor(m: Match, room: Room): void {
  const g = m.ghost;
  g.targetRoom = room.id;
  g.x = g.prevX = room.door.front.x;
  g.y = g.prevY = room.door.front.y;
  g.waypoints = [];
  g.state = 'attacking';
  g.hitTimer = TICK;
  g.switchTimer = 1e9;
  g.hp = g.maxHp;
  g.siegeHp = g.hp;
  g.siegeDoorHp = room.door.hp;
  g.siegeTime = 0;
  room.items = [];
}

/** Постройка для прямой вставки в room.buildings (минуя стройку). Новые поля Building добавлять сюда, а не в литералы тестов. */
export function mkBuilding(kind: BuildKind, x: number, y: number, level = 1): Building {
  return { kind, x, y, level, cooldown: 0 };
}

/** Соседи засыпают (не думают), постройки у всех, кроме игрока, убраны — ничто не мешает считать. */
export function quietFloor(m: Match): void {
  for (const c of m.chars) if (!c.isPlayer) c.think = 1e9;
  for (const r of m.rooms) if (r.ownerId !== m.playerId) r.buildings = [];
}
