import { describe, expect, it } from 'vitest';
import { B, TICK, cannonDmg } from '../src/sim/balance';
import type { Match } from '../src/sim/match';
import { inRoom } from '../src/sim/roomgrid';
import type { Room, SimEvent } from '../src/sim/types';
import { inRoomMatch, mkBuilding, nightNow, pinGhostAtDoor, quietFloor, runUntil, stepSec } from './helpers';

/** Ночь, у соседей построек нет, игрока только что поймали — он дух. Возвращает события тика поимки. */
function spiritMatch(): { m: Match; room: Room; catchEvents: readonly SimEvent[] } {
  const m = inRoomMatch();
  nightNow(m);
  quietFloor(m);
  const room = m.playerRoom!;
  room.door.hp = 1;
  pinGhostAtDoor(m, room);
  let catchEvents: readonly SimEvent[] = [];
  for (let i = 0; i < 20 * 20 && !m.player.spirit; i++) {
    m.step();
    catchEvents = m.events;
  }
  if (!m.player.spirit) throw new Error('игрока не поймали');
  return { m, room, catchEvents };
}

/** Живая комната соседа. */
const neighbour = (m: Match) => m.rooms.find((r) => r.ownerId !== null && r.ownerId !== m.playerId && !r.eliminated)!;

describe('дух', () => {
  it('test_spirit_flies_through_walls_straight_line', () => {
    // Arrange
    const { m } = spiritMatch();
    const p = m.player;
    const nb = neighbour(m);
    const to = { x: nb.sofa.x + 0.5, y: nb.sofa.y + 0.5 };
    const dist = Math.hypot(to.x - p.x, to.y - p.y);
    const ticks = Math.ceil(dist / (B.spirit.speed * TICK) - 1e-9);
    // Act
    expect(m.command(0, { type: 'move', x: nb.sofa.x, y: nb.sofa.y })).toBeNull();
    for (let i = 0; i < ticks - 1; i++) m.step();
    // Assert: по прямой — ровно dist/speed, путь по коридорам был бы длиннее.
    expect(p.flyTo).not.toBeNull();
    m.step();
    expect(p.x).toBeCloseTo(to.x, 6);
    expect(p.y).toBeCloseTo(to.y, 6);
    expect(p.flyTo).toBeNull();
  });

  it('test_spirit_cannot_build_returns_reason', () => {
    const { m, room } = spiritMatch();
    const cell = room.door.inside;
    expect(m.command(0, { type: 'build', kind: 'cannon', x: cell.x, y: cell.y })).toBe('Ты дух — строить нельзя');
    expect(m.command(0, { type: 'repair' })).toBe('Ты дух — строить нельзя');
    expect(m.command(0, { type: 'upgradeDoor' })).toBe('Ты дух — строить нельзя');
  });

  it('test_spirit_boo_freezes_ghost_and_starts_cooldown', () => {
    // Arrange: призрак рядом с духом.
    const { m } = spiritMatch();
    const p = m.player;
    const g = m.ghost;
    g.x = g.prevX = p.x + 1;
    g.y = g.prevY = p.y;
    g.holdImmune = 0;
    // Act
    expect(m.command(0, { type: 'boo' })).toBeNull();
    // Assert
    expect(g.held).toBe(B.spirit.booHold);
    expect(g.holdImmune).toBe(0);
    expect(p.booCd).toBe(B.spirit.booCd);
    const at = { x: g.x, y: g.y };
    stepSec(m, B.spirit.booHold - 0.1);
    expect({ x: g.x, y: g.y }).toEqual(at);
    expect(m.command(0, { type: 'boo' })).toMatch(/Бу! будет готово через \d+ с/);
    stepSec(m, B.spirit.booCd);
    expect(p.booCd).toBe(0);
  });

  it('test_spirit_boo_event_survives_until_next_step', () => {
    // Arrange: сцена шлёт команду из клика между тиками и разбирает m.events только после step().
    const { m } = spiritMatch();
    const p = m.player;
    m.ghost.x = m.ghost.prevX = p.x + 1;
    m.ghost.y = m.ghost.prevY = p.y;
    // Act
    expect(m.command(0, { type: 'boo' })).toBeNull();
    m.step();
    const afterFirst = m.events.filter((e) => e.type === 'boo').length;
    m.step();
    const afterSecond = m.events.filter((e) => e.type === 'boo').length;
    // Assert: событие доходит ровно один раз (GAME_AUDIT.md, B3).
    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(0);
  });

  it('test_spirit_boo_out_of_range_rejected', () => {
    const { m } = spiritMatch();
    const p = m.player;
    m.ghost.x = p.x + B.spirit.booRange + 1;
    m.ghost.y = p.y;
    expect(m.command(0, { type: 'boo' })).toBe('Подлети ближе к призраку');
    expect(p.booCd).toBe(0);
    expect(m.ghost.held).toBe(0);
  });

  it('test_spirit_spark_boosts_neighbour_cannon_damage', () => {
    // Arrange: у соседа одна пушка, призрак стоит прямо на ней и ломает его вечную дверь.
    const { m } = spiritMatch();
    const p = m.player;
    const nb = neighbour(m);
    const cell = nb.sofa;
    const cannon = mkBuilding('cannon', cell.x, cell.y);
    nb.buildings.push(cannon);
    nb.door.maxHp = nb.door.hp = 1e9;
    pinGhostAtDoor(m, nb);
    const g = m.ghost;
    g.maxHp = g.hp = 1e7;
    g.siegeHp = g.hp;
    g.xp = 0;
    g.levelTimer = 0;
    g.x = cell.x + 0.5;
    g.y = cell.y + 0.5;
    p.x = cell.x + 0.5;
    p.y = cell.y + 1.5;
    // Act
    expect(m.command(0, { type: 'spark' })).toBeNull();
    expect(cannon.boost).toBe(B.spirit.sparkTime);
    expect(p.sparkCd).toBe(B.spirit.sparkCd);
    const hitsDuring: number[] = [];
    const hitsAfter: number[] = [];
    for (let t = 0; t < 12 * 20; t++) {
      const hp = g.hp;
      m.step();
      if (!m.events.some((e) => e.type === 'shot' && e.roomId === nb.id)) continue;
      // Выстрел на самой границе (±0.5 с) не считаем — там решает округление таймера.
      if (t * TICK < B.spirit.sparkTime - 0.5) hitsDuring.push(hp - g.hp);
      else if (t * TICK > B.spirit.sparkTime + 0.5) hitsAfter.push(hp - g.hp);
    }
    // Assert
    expect(hitsDuring.length).toBeGreaterThanOrEqual(7);
    for (const d of hitsDuring) expect(d).toBeCloseTo(cannonDmg(1) * B.spirit.sparkMul, 6);
    expect(hitsAfter.length).toBeGreaterThanOrEqual(3);
    for (const d of hitsAfter) expect(d).toBeCloseTo(cannonDmg(1), 6);
    expect(cannon.boost).toBe(0);
  });

  it('test_spirit_spark_range_check', () => {
    // Arrange: пушка соседа далеко от духа.
    const { m, room } = spiritMatch();
    const p = m.player;
    const nb = neighbour(m);
    const cell = nb.sofa;
    nb.buildings.push(mkBuilding('cannon', cell.x, cell.y));
    p.x = cell.x + 0.5 + B.spirit.sparkRange + 1;
    p.y = cell.y + 0.5;
    // Act & Assert: ни ближайшей, ни указанной — далеко.
    expect(m.command(0, { type: 'spark' })).toBe('Рядом нет пушки соседа');
    expect(m.command(0, { type: 'spark', x: cell.x, y: cell.y, roomId: nb.id })).toBe('Рядом нет пушки соседа');
    expect(p.sparkCd).toBe(0);
    // Своя пушка (комната игрока) — не цель «Искорки».
    const own = room.door.inside;
    room.buildings.push(mkBuilding('cannon', own.x, own.y));
    p.x = own.x + 0.5;
    p.y = own.y + 0.5;
    expect(m.command(0, { type: 'spark', x: own.x, y: own.y, roomId: room.id })).toBe('Рядом нет пушки соседа');
    // Подлетел ближе — сработало.
    p.x = cell.x + 0.5;
    p.y = cell.y + 0.5;
    expect(m.command(0, { type: 'spark', x: cell.x, y: cell.y, roomId: nb.id })).toBeNull();
  });
});

describe('воскрешение', () => {
  it('test_revive_valid_same_tick_as_catch', () => {
    const { m, room, catchEvents } = spiritMatch();
    expect(catchEvents.some((e) => e.type === 'spirit')).toBe(true);
    // В тик поимки призрак ещё в комнате, но уже выбрал другую цель — вернуться можно.
    expect(m.ghost.targetRoom).not.toBe(room.id);
    expect(m.canRevive()).toBeNull();
  });

  it('test_revive_restores_room_once', () => {
    // Arrange
    const { m, room } = spiritMatch();
    const p = m.player;
    room.candy = 123;
    room.door.repairCd = 7;
    const doorLevel = room.door.level;
    const ghostLevel = m.ghost.level;
    // Act
    expect(m.revive()).toBeNull();
    // Assert
    expect(m.events.some((e) => e.type === 'revived')).toBe(true);
    expect(room.eliminated).toBe(false);
    expect(room.door.broken).toBe(false);
    expect(room.door.level).toBe(doorLevel);
    expect(room.door.hp).toBeCloseTo(room.door.maxHp * B.revive.doorHp, 6);
    expect(room.door.repairCd).toBe(0);
    expect(room.candy).toBe(123);
    expect(p.caught).toBe(false);
    expect(p.spirit).toBe(false);
    expect(inRoom(room, Math.floor(p.x), Math.floor(p.y))).toBe(true);
    expect(m.ghost.level).toBe(ghostLevel);
    expect(m.command(0, { type: 'repair' })).toBeNull();
    // Второй раз поймали — вернуться уже нельзя.
    room.door.hp = 1;
    pinGhostAtDoor(m, room);
    runUntil(m, (mm) => mm.player.spirit, 20);
    expect(p.spirit).toBe(true);
    expect(m.canRevive()).not.toBeNull();
    expect(m.revive()).not.toBeNull();
    expect(room.eliminated).toBe(true);
  });

  it('test_revive_puts_ghost_outside_room', () => {
    // Arrange: поймали — призрак стоит внутри комнаты игрока.
    const { m, room } = spiritMatch();
    expect(inRoom(room, Math.floor(m.ghost.x), Math.floor(m.ghost.y))).toBe(true);
    // Act
    expect(m.revive()).toBeNull();
    // Assert: призрак за дверью и идёт к другой комнате.
    expect(inRoom(room, Math.floor(m.ghost.x), Math.floor(m.ghost.y))).toBe(false);
    expect(m.ghost.targetRoom).not.toBe(room.id);
  });

  it('test_revive_rejected_when_ghost_entering_room', () => {
    const { m, room } = spiritMatch();
    m.ghost.state = 'entering';
    m.ghost.targetRoom = room.id;
    expect(m.canRevive()).toBe('Призрак в комнате');
    expect(m.revive()).toBe('Призрак в комнате');
    expect(room.eliminated).toBe(true);
  });

  it('test_revive_ghost_avoids_room_for_15s', () => {
    // Arrange
    const { m, room } = spiritMatch();
    expect(m.revive()).toBeNull();
    const g = m.ghost;
    // Заставляем призрака выбирать цель заново каждые полсекунды (лечение закончилось).
    const repick = () => {
      g.state = 'healing';
      g.healTimer = 0;
      g.held = 0;
    };
    // Act & Assert: 14.9 с воскресшая комната не цель.
    let picks = 0;
    for (let t = 0; t < Math.floor((B.revive.protect - 0.1) * 20); t++) {
      if (t % 10 === 0) {
        repick();
        picks++;
      }
      m.step();
      expect(g.targetRoom).not.toBe(room.id);
    }
    expect(picks).toBeGreaterThan(20);
    // Защита кончилась — комната снова может стать целью.
    stepSec(m, 0.2);
    let picked = false;
    for (let t = 0; t < 60 * 20 && !picked; t++) {
      if (t % 10 === 0) repick();
      m.step();
      picked = g.targetRoom === room.id;
    }
    expect(picked).toBe(true);
  });
});
