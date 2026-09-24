import { B } from './balance';
import { Tile } from './map';
import type { Match } from './match';
import { bfs } from './path';
import type { Ghost, Room, Vec } from './types';

export function createGhost(nest: Vec): Ghost {
  return {
    x: nest.x,
    y: nest.y,
    prevX: nest.x,
    prevY: nest.y,
    level: 1,
    hp: 0,
    maxHp: 0,
    state: 'hidden',
    targetRoom: -1,
    waypoints: [],
    hitTimer: 0,
    switchTimer: 0,
    siegeHp: 0,
    siegeDoorHp: 0,
    siegeTime: 0,
    healTimer: 0,
    levelTimer: 0,
  };
}

export const ghostMaxHp = (m: Match, level: number) => B.ghost.hp * B.ghost.hpMul ** (level - 1) * m.diff.ghostMul;
export const ghostDamage = (m: Match, level: number) => B.ghost.dmg * B.ghost.dmgMul ** (level - 1) * m.diff.ghostMul;
export const ghostHitInterval = (level: number) => B.ghost.hitInterval / (1 + B.ghost.hitSpeedup * (level - 1));

/** По призраку можно стрелять, пока он на виду (не в гнезде и жив). */
export const ghostTargetable = (g: Ghost) =>
  g.state === 'moving' || g.state === 'attacking' || g.state === 'entering' || g.state === 'retreating';

export function spawnGhost(m: Match): void {
  const g = m.ghost;
  g.level = 1;
  g.maxHp = m.script ? m.script.ghostHp : ghostMaxHp(m, 1);
  g.hp = g.maxHp;
  g.x = g.prevX = m.nest.x;
  g.y = g.prevY = m.nest.y;
  g.levelTimer = 0;
  chooseTarget(m);
}

export function hideGhost(m: Match): void {
  m.ghost.state = 'hidden';
  m.ghost.waypoints = [];
}

export function updateGhost(m: Match, dt: number): void {
  const g = m.ghost;
  g.prevX = g.x;
  g.prevY = g.y;
  if (g.state === 'hidden' || g.state === 'dead') return;

  if (!m.script) g.levelTimer += dt;
  if (g.levelTimer >= m.diff.levelEvery) {
    g.levelTimer -= m.diff.levelEvery;
    levelUp(m);
  }

  if (!m.script && (g.state === 'moving' || g.state === 'attacking' || g.state === 'entering') && g.hp <= g.maxHp * B.ghost.retreatAt) {
    g.state = 'retreating';
    g.waypoints = route(m, m.nest);
    m.events.push({ type: 'ghostRetreat' });
  }

  switch (g.state) {
    case 'moving': {
      const r = m.rooms[g.targetRoom];
      if (!r || r.eliminated) {
        chooseTarget(m);
        break;
      }
      if (moveAlong(g, B.ghost.speed * (m.script?.ghostSpeedMul ?? 1), dt)) {
        if (r.door.broken) startEnter(m, r);
        else {
          g.state = 'attacking';
          g.hitTimer = 0.6;
          // Сколько ломиться в эту дверь, прежде чем передумать, — каждый раз по-разному.
          g.switchTimer = m.rng.range(B.ghost.switchMin, B.ghost.switchMax);
          g.siegeHp = g.hp;
          g.siegeDoorHp = r.door.hp;
          g.siegeTime = 0;
        }
      }
      break;
    }
    case 'attacking': {
      const r = m.rooms[g.targetRoom];
      if (r.eliminated) {
        chooseTarget(m);
        break;
      }
      if (!m.script?.ghostHitHold) g.hitTimer -= dt;
      if (g.hitTimer <= 0) {
        g.hitTimer += ghostHitInterval(g.level);
        hitDoor(m, r);
        if (r.door.broken) break;
      }
      // Как в Haunted Dorm: ломится, пока не сломает, но сдаётся, если его
      // слишком побили пушки при крепкой двери или дверь чинят быстрее, чем он бьёт.
      g.switchTimer -= dt;
      g.siegeTime += dt;
      const doorFrac = r.door.hp / r.door.maxHp;
      const beaten = g.siegeHp - g.hp > g.maxHp * B.ghost.giveUpDamage && doorFrac > 0.5;
      const stalled = g.siegeTime > 12 && r.door.hp >= g.siegeDoorHp;
      if (!m.script && (g.switchTimer <= 0 || beaten || stalled)) {
        m.events.push({ type: 'ghostLeft', roomId: r.id });
        chooseTarget(m, r.id);
      }
      break;
    }
    case 'entering': {
      const r = m.rooms[g.targetRoom];
      if (g.waypoints.length) {
        moveAlong(g, B.ghost.enterSpeed, dt);
        break;
      }
      const c = m.chars[r.ownerId!];
      const dx = c.x - g.x;
      const dy = c.y - g.y;
      const d = Math.hypot(dx, dy);
      const step = B.ghost.enterSpeed * dt;
      if (d <= Math.max(step, 0.45)) catchOwner(m, r);
      else {
        g.x += (dx / d) * step;
        g.y += (dy / d) * step;
      }
      break;
    }
    case 'retreating':
      if (moveAlong(g, B.ghost.speed * 1.2, dt)) {
        g.state = 'healing';
        g.healTimer = B.ghost.healTime;
      }
      break;
    case 'healing':
      g.healTimer -= dt;
      // Лечится не до конца: урон прошлых атак копится, и призрака можно добить за несколько заходов.
      g.hp = Math.min(g.maxHp, g.hp + ((g.maxHp * B.ghost.healFrac) / B.ghost.healTime) * dt);
      if (g.healTimer <= 0) chooseTarget(m);
      break;
  }
}

function levelUp(m: Match): void {
  const g = m.ghost;
  const frac = g.maxHp > 0 ? g.hp / g.maxHp : 1;
  g.level++;
  g.maxHp = ghostMaxHp(m, g.level);
  g.hp = frac * g.maxHp;
  m.events.push({ type: 'ghostLevel', level: g.level });
}

/**
 * Выбор двери — случайный: любая из живых комнат, кроме той, от которой только что ушёл.
 * Раньше призрак тянулся к самой слабой двери и выглядел заскриптованным.
 */
function chooseTarget(m: Match, exclude = -1): void {
  const g = m.ghost;
  // Комнаты со сломанной дверью тоже цели: призрак мог отступить лечиться, не дойдя до хозяина.
  const alive = m.rooms.filter((r) => r.ownerId !== null && !r.eliminated);
  let list = alive.filter((r) => r.id !== exclude);
  if (!list.length) list = alive;
  if (!list.length) {
    g.targetRoom = -1;
    g.state = 'retreating';
    g.waypoints = route(m, m.nest);
    return;
  }
  const forced = m.script?.ghostTarget;
  const pick = (forced != null && list.find((r) => r.id === forced)) || m.rng.pick(list);
  g.targetRoom = pick.id;
  g.state = 'moving';
  g.waypoints = route(m, pick.door.front);
}

function hitDoor(m: Match, r: Room): void {
  const dmg = m.script ? m.script.ghostDmg : ghostDamage(m, m.ghost.level);
  const door = r.door;
  // Обучение: дверь не опускается ниже пола — проиграть нельзя.
  const floor = m.script ? door.maxHp * m.script.doorFloor : 0;
  const dealt = Math.max(0, Math.min(dmg, door.hp - floor));
  door.hp -= dealt;
  if (r.items.some((i) => i.kind === 'lavender')) r.candy += dealt * B.items.lavender;
  m.events.push({ type: 'doorHit', roomId: r.id, dmg: Math.round(dealt) });
  if (door.hp <= 0) {
    door.hp = 0;
    door.broken = true;
    m.events.push({ type: 'doorBroken', roomId: r.id });
    const owner = m.chars[r.ownerId!];
    if (owner.task && (owner.task.kind === 'repair' || owner.task.kind === 'door')) m.cancelTask(owner);
    startEnter(m, r);
  }
}

function startEnter(m: Match, r: Room): void {
  const g = m.ghost;
  g.state = 'entering';
  g.waypoints = [doorCenter(r), { x: r.door.inside.x + 0.5, y: r.door.inside.y + 0.5 }];
}

function catchOwner(m: Match, r: Room): void {
  const c = m.chars[r.ownerId!];
  r.eliminated = true;
  c.caught = true;
  c.task = null;
  c.path = [];
  m.events.push({ type: 'caught', roomId: r.id, charId: c.id });
  m.onEliminated(c);
  levelUp(m);
  chooseTarget(m);
}

const doorCenter = (r: Room): Vec => ({ x: r.door.x + 0.5, y: r.door.y + 0.5 });

/** Маршрут по этажу (коридоры извилистые): поиск пути по клеткам без стен, прямые участки склеены. */
function route(m: Match, dest: Vec): Vec[] {
  const g = m.ghost;
  const start = { x: Math.floor(g.x), y: Math.floor(g.y) };
  const goal = { x: Math.floor(dest.x), y: Math.floor(dest.y) };
  const cells = bfs(start, [goal], (x, y) => m.tiles[y]?.[x] !== undefined && m.tiles[y][x] !== Tile.Wall) ?? [];
  const pts: Vec[] = [];
  for (let i = 0; i < cells.length - 1; i++) {
    const prev = i === 0 ? start : cells[i - 1];
    const next = cells[i + 1];
    // Точка нужна только там, где путь поворачивает.
    if (next.x - cells[i].x !== cells[i].x - prev.x || next.y - cells[i].y !== cells[i].y - prev.y) pts.push({ x: cells[i].x + 0.5, y: cells[i].y + 0.5 });
  }
  pts.push(dest);
  return pts;
}

function moveAlong(g: Ghost, speed: number, dt: number): boolean {
  let budget = speed * dt;
  while (budget > 0 && g.waypoints.length) {
    const t = g.waypoints[0];
    const dx = t.x - g.x;
    const dy = t.y - g.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      g.x = t.x;
      g.y = t.y;
      g.waypoints.shift();
      budget -= d;
    } else {
      g.x += (dx / d) * budget;
      g.y += (dy / d) * budget;
      budget = 0;
    }
  }
  return g.waypoints.length === 0;
}
