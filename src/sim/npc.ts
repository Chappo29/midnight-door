import type { Match } from './match';
import type { Character, Cmd, Cost, NpcProfile, Room } from './types';

/**
 * Характеры соседей — чтобы они не были одинаковыми ботами:
 * соня еле шевелится и ставит пару пушек, трусишка вкладывается в дверь, стрелок строит больше всех.
 */
export const PROFILES: readonly NpcProfile[] = [
  { name: 'Соня', door: 1.0, eco: 1.3, gun: 0.7, pace: 1.7, maxCannons: 2 },
  { name: 'Трусишка', door: 2.0, eco: 0.9, gun: 0.5, pace: 1.2, maxCannons: 2 },
  { name: 'Копилка', door: 0.8, eco: 1.7, gun: 0.7, pace: 1.2, maxCannons: 3 },
  { name: 'Стрелок', door: 0.8, eco: 0.8, gun: 1.6, pace: 0.9, maxCannons: 4 },
];

export const BALANCED: NpcProfile = { name: 'Игрок', door: 1.2, eco: 1.0, gun: 1.0, pace: 1, maxCannons: 4 };

/** Темп «как у живого ребёнка», секунды. */
const THINK_MIN = 3;
const THINK_MAX = 6;
/** Отдых после покупки: не скупает всё подряд, как только хватило конфет. */
const REST_MIN = 4;
const REST_MAX = 9;

interface Option {
  score: number;
  cost: Cost;
  cmd: Cmd;
}

/**
 * Сосед думает раз в 0.5–2 с и отдаёт те же команды, что и игрок (без читов).
 * skill 0..1: насколько быстро реагирует, чинит вовремя и копит на нужное.
 */
export function npcThink(m: Match, c: Character, dt: number, skill: number): void {
  if (c.caught || c.roomId === null) return;
  c.think -= dt;
  if (c.think > 0) return;
  // Раньше думал раз в 0.5–2 с и скупал всё мгновенно — выглядело как бот.
  c.think = m.rng.range(THINK_MIN, THINK_MAX) * c.profile.pace * (1.2 - 0.4 * skill);
  if (c.task || c.path.length) return;

  const room = m.rooms[c.roomId];
  const door = room.door;
  const g = m.ghost;
  const underAttack = g.targetRoom === room.id && g.state === 'attacking';
  const hpFrac = door.hp / door.maxHp;
  // Ключ возвращает 30% и уходит на перезарядку: умный чинит вовремя, глупый — когда уже поздно.
  const repairBelow = underAttack ? 0.35 + 0.35 * skill : 0.75;
  // Ключ на перезарядке — не ждём у двери, занимаемся другим.
  if (!door.broken && hpFrac < repairBelow && door.repairCd <= 0) {
    // Дверь чинит сразу и без отдыха — это важнее всего.
    if (!m.command(c.id, { type: 'repair' })) c.think = m.rng.range(0.5, 1.2);
    return;
  }

  const p = c.profile;
  const opts: Option[] = [];
  const doorCost = m.doorUpgradeCost(room);
  if (doorCost && !door.broken) {
    const behind = door.level <= room.sofa.level ? 1.8 : 1.0;
    opts.push({ score: p.door * (1 + (1 - hpFrac)) * behind, cost: doorCost, cmd: { type: 'upgradeDoor' } });
  }
  const sofaCost = m.sofaUpgradeCost(room);
  if (sofaCost) opts.push({ score: p.eco * (room.sofa.level < 3 ? 1.5 : 1), cost: sofaCost, cmd: { type: 'upgradeSofa' } });

  const cannons = room.buildings.filter((b) => b.kind === 'cannon');
  const cannonCell = cannons.length < p.maxCannons ? pickCannonCell(m, room, skill) : null;
  if (cannonCell) {
    opts.push({
      score: p.gun * (cannons.length < 2 ? 1.4 : 0.9),
      cost: m.buildCost('cannon'),
      cmd: { type: 'build', kind: 'cannon', ...cannonCell },
    });
  }
  const weakest = [...cannons].sort((a, b) => a.level - b.level)[0];
  const weakestCost = weakest ? m.upgradeCost(weakest) : null;
  if (weakest && weakestCost) opts.push({ score: p.gun * 0.8, cost: weakestCost, cmd: { type: 'upgrade', x: weakest.x, y: weakest.y } });

  if (m.opts.flameUnlocked) {
    // Тыквы нужны ровно настолько, чтобы хватало пламени на следующую покупку.
    const pumpkins = room.buildings.filter((b) => b.kind === 'pumpkin');
    const flameNeed = Math.max(doorCost?.flame ?? 0, weakestCost?.flame ?? 0);
    const short = room.flame < flameNeed;
    const soilCell = pumpkins.length < 2 ? m.findBuildCell(room, 'pumpkin') : null;
    if (soilCell && (pumpkins.length === 0 || short)) {
      opts.push({ score: p.eco * (short ? 1.4 : 0.7), cost: m.buildCost('pumpkin'), cmd: { type: 'build', kind: 'pumpkin', ...soilCell } });
    }
    const pumpkin = [...pumpkins].sort((a, b) => a.level - b.level)[0];
    const pumpkinCost = pumpkin ? m.upgradeCost(pumpkin) : null;
    if (pumpkin && pumpkinCost && short) opts.push({ score: p.eco * 0.8, cost: pumpkinCost, cmd: { type: 'upgrade', x: pumpkin.x, y: pumpkin.y } });
  }
  if (!opts.length) return;

  // Умный сосед берёт лучшее (с небольшим разбросом, чтобы не быть роботом), глупый — что попало.
  for (const o of opts) o.score *= m.rng.range(0.75, 1.25);
  const desired = m.rng.next() < skill ? opts.reduce((a, b) => (b.score > a.score ? b : a)) : weightedPick(m, opts);
  if (m.canAfford(room, desired.cost)) {
    buy(m, c, desired.cmd);
    return;
  }
  // Неумелый сосед не копит, а тратит на что попало.
  if (m.rng.next() > skill) {
    const affordable = opts.filter((o) => m.canAfford(room, o.cost));
    if (affordable.length) {
      buy(m, c, m.rng.pick(affordable).cmd);
      return;
    }
  }
  // Ждёт денег и бродит по комнате, чтобы не стоять столбом.
  if (m.rng.next() < 0.3) {
    const cell = m.randomWalkableCell(room);
    if (cell) m.command(c.id, { type: 'move', ...cell });
  }
}

/**
 * Куда ставить пушку. Пушки бьют по радиусу, а призрак приходит к двери —
 * умный ставит поближе к двери, глупый куда попало.
 */
function pickCannonCell(m: Match, room: Room, skill: number) {
  const cells = m.buildCells(room, 'cannon');
  if (!cells.length || m.rng.next() > skill) return cells[0] ?? null;
  const f = room.door.front;
  cells.sort((a, b) => Math.hypot(a.x + 0.5 - f.x, a.y + 0.5 - f.y) - Math.hypot(b.x + 0.5 - f.x, b.y + 0.5 - f.y));
  return cells[m.rng.int(Math.min(3, cells.length))];
}

/** Покупка + передышка после неё. */
function buy(m: Match, c: Character, cmd: Cmd): void {
  if (!m.command(c.id, cmd)) c.think += m.rng.range(REST_MIN, REST_MAX) * c.profile.pace;
}

function weightedPick(m: Match, opts: Option[]): Option {
  let roll = m.rng.next() * opts.reduce((s, o) => s + o.score, 0);
  for (const o of opts) {
    roll -= o.score;
    if (roll <= 0) return o;
  }
  return opts[opts.length - 1];
}
