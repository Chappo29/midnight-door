import { B, fridgeSlow } from './balance';
import { Tile } from './map';
import type { Match } from './match';
import { bfs } from './path';
import { inRoom } from './roomgrid';
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
    nestVisits: 0,
    desperate: false,
    levelTimer: 0,
    xp: 0,
    held: 0,
    holdImmune: 0,
    avoidRoom: -1,
    avoidTimer: 0,
  };
}

export const ghostMaxHp = (m: Match, level: number) => B.ghost.hp * B.ghost.hpMul ** (level - 1) * m.diff.ghostMul;
export const ghostDamage = (m: Match, level: number) => B.ghost.dmg * B.ghost.dmgMul ** (level - 1) * m.diff.ghostMul;
export const ghostHitInterval = (level: number) => B.ghost.hitInterval / (1 + B.ghost.hitSpeedup * (level - 1));
/** Насколько реже призрак бьёт дверь этой комнаты: холодильник внутри (0 — нет холодильника). */
export const fridgeSlowOf = (r: Room) => {
  const f = r.buildings.find((b) => b.kind === 'fridge');
  // Не больше 0.9: иначе при подборе чисел пауза между ударами ушла бы в бесконечность.
  return f ? Math.min(0.9, fridgeSlow(f.level)) : 0;
};
/** Пауза между ударами по двери этой комнаты — одна на симуляцию и отрисовку (кадр удара считается от неё же). */
export const ghostHitIntervalAt = (m: Match, r: Room) => ghostHitInterval(m.ghost.level) / (1 - fridgeSlowOf(r));
/** Какую долю макс. HP вылечит этот заход в гнездо: каждый следующий слабее в B.ghost.healDecay раз. */
export const nestHealFrac = (g: Ghost) => B.ghost.healFrac * B.ghost.healDecay ** g.nestVisits;
/** Сколько ударов по дверям нужно с уровня level на следующий: каждый уровень на xpGrowth дороже. */
export const ghostXpNeed = (m: Match, level: number) =>
  // Не меньше 0.01: при hitsPerLevel ≤ 0 (подбор чисел в tune.ts) цикл набора уровней не кончился бы.
  Math.max(0.01, m.diff.hitsPerLevel * (1 + B.ghost.xpGrowth * (level - 1)));

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
  g.xp = 0;
  g.nestVisits = 0;
  g.desperate = false;
  g.held = 0;
  g.holdImmune = 0;
  chooseTarget(m);
}

/**
 * Призрак внутри комнаты r (игрок воскрес за рекламу, а призрак стоял рядом) — выставить его за дверь
 * и отправить к другой комнате. Иначе он прошёл бы сквозь починенную дверь, а пушки комнаты били бы по нему в упор.
 */
export function ghostLeaveRoom(m: Match, r: Room): void {
  const g = m.ghost;
  if (!inRoom(r, Math.floor(g.x), Math.floor(g.y))) return;
  g.x = g.prevX = r.door.front.x;
  g.y = g.prevY = r.door.front.y;
  chooseTarget(m, r.id);
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

  // Уровень растёт от ударов (hitDoor → gainXp); таймер — страховка, если призрак долго не может ударить.
  // В обучении уровень не растёт вовсе.
  if (!m.script) {
    g.levelTimer += dt;
    if (g.levelTimer >= m.diff.levelFallback) levelUp(m);
  }

  // Капкан держит: стоит на месте, не бьёт, терпение и осада на паузе (сдаться «из-за капкана» нельзя).
  // Состояние прежнее — пушки по нему бьют; отступление ждёт, пока отпустит: беглеца ловят и добивают всем этажом.
  g.holdImmune = Math.max(0, g.holdImmune - dt);
  // Защита воскресшей комнаты тикает и пока призрака держат.
  g.avoidTimer = Math.max(0, g.avoidTimer - dt);
  if (g.held > 0) {
    g.held = Math.max(0, g.held - dt);
    return;
  }

  const fleeing = g.state === 'moving' || g.state === 'attacking' || g.state === 'entering';
  if (!m.script && !g.desperate && fleeing && g.hp <= g.maxHp * B.ghost.retreatAt) {
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
        g.hitTimer += ghostHitIntervalAt(m, r);
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
      // Бегство лечиться: на лёгкой обычная скорость, на сложной/кошмаре — быстрее (DIFF.retreatSpeedMul).
      if (moveAlong(g, B.ghost.speed * m.diff.retreatSpeedMul, dt)) {
        g.state = 'healing';
        g.healTimer = B.ghost.healTime;
      }
      break;
    case 'healing':
      g.healTimer -= dt;
      // Лечится не до конца и с каждым заходом слабее: урон прошлых атак копится, и призрака можно добить за несколько заходов.
      g.hp = Math.min(g.maxHp, g.hp + ((g.maxHp * nestHealFrac(g)) / B.ghost.healTime) * dt);
      if (g.healTimer <= 0) {
        g.nestVisits++;
        // Не поднялся выше порога бегства — иначе тут же убежал бы обратно и крутился у гнезда без конца.
        g.desperate = g.hp <= g.maxHp * B.ghost.retreatAt;
        chooseTarget(m);
      }
      break;
  }
}

/** Удары копятся в «злость»; набралось на уровень — уровень, остаток переносится на следующий. */
function gainXp(m: Match, x: number): void {
  const g = m.ghost;
  g.xp += x;
  for (let need = ghostXpNeed(m, g.level); g.xp >= need; need = ghostXpNeed(m, g.level)) {
    g.xp -= need;
    levelUp(m);
  }
}

function levelUp(m: Match): void {
  const g = m.ghost;
  const frac = g.maxHp > 0 ? g.hp / g.maxHp : 1;
  const oldMax = g.maxHp;
  g.level++;
  g.maxHp = ghostMaxHp(m, g.level);
  // Уровень посреди осады: пересчитать «HP в начале осады» под новый максимум, иначе урон пушек
  // до нового уровня забывается и призрак почти не сдаётся у крепкой двери.
  if (g.state === 'attacking' && oldMax > 0) g.siegeHp *= g.maxHp / oldMax;
  // Доля HP сохраняется, и сверху новый уровень немного лечит.
  g.hp = Math.min(g.maxHp, frac * g.maxHp + g.maxHp * B.ghost.levelHeal);
  g.levelTimer = 0;
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
  // Воскресшую комнату не трогает B.revive.protect с — если только она не последняя живая.
  const avoid = g.avoidTimer > 0 ? g.avoidRoom : -1;
  let list = alive.filter((r) => r.id !== exclude && r.id !== avoid);
  if (!list.length) list = alive.filter((r) => r.id !== avoid);
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
  m.events.push({ type: 'ghostTarget', roomId: pick.id });
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
  // Злость — от нанесённого урона в долях полного удара (добивающий слабый удар — часть удара).
  if (!m.script && dmg > 0) gainXp(m, dealt / dmg);
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
