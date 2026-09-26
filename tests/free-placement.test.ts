import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import { inRoom, isSoil, occupantAt, roomCells } from '../src/sim/roomgrid';
import type { Room, Vec } from '../src/sim/types';
import { finishTask, inRoomMatch, mkBuilding, runUntil } from './helpers';

/** Пустые клетки пола (не грядка, не место у двери) — туда можно ставить пушку. */
function emptyFloor(r: Room): Vec[] {
  return roomCells(r).filter(
    (v) => occupantAt(r, v.x, v.y) === null && !isSoil(r, v.x, v.y) && !(v.x === r.door.inside.x && v.y === r.door.inside.y),
  );
}

/** Застраивает пушками весь свободный пол напрямую, минуя стройку. */
function fillWithCannons(m: Match, r: Room): Vec[] {
  const placed: Vec[] = [];
  for (const v of emptyFloor(r)) {
    expect(m.canPlace(r, v.x, v.y, 'cannon')).toBeNull();
    r.buildings.push(mkBuilding('cannon', v.x, v.y));
    placed.push(v);
  }
  return placed;
}

/** Герой идёт по пути и на каждом шаге остаётся в комнате. */
function walkInside(m: Match, r: Room): void {
  runUntil(
    m,
    (mm) => {
      expect(inRoom(r, Math.floor(mm.player.x), Math.floor(mm.player.y))).toBe(true);
      return mm.player.path.length === 0;
    },
    20,
  );
}

describe('свободная застройка: герой проходит сквозь постройки и мебель', () => {
  it('test_placement_dense_room_every_empty_floor_cell_allowed', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    const placed = fillWithCannons(m, r);
    // Раньше «Загородит проход» оставлял дыры; теперь занят весь свободный пол.
    expect(placed.length).toBeGreaterThan(5);
    expect(emptyFloor(r)).toHaveLength(0);
  });

  it('test_placement_building_on_building_rejected', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    const [a] = fillWithCannons(m, r);
    expect(m.canPlace(r, a.x, a.y, 'cannon')).toBe('Место занято');
    expect(m.canPlace(r, r.sofa.x, r.sofa.y, 'cannon')).toBe('Место занято');
    const f = r.furniture[0];
    if (f) expect(m.canPlace(r, f.x, f.y, 'cannon')).toBe('Место занято');
  });

  it('test_hero_dense_room_walks_through_buildings_and_furniture', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    fillWithCannons(m, r);
    // Самая дальняя от героя клетка комнаты — путь идёт сквозь пушки, диван и мебель.
    const from = { x: Math.floor(m.player.x), y: Math.floor(m.player.y) };
    const far = roomCells(r).sort((p, q) => Math.hypot(q.x - from.x, q.y - from.y) - Math.hypot(p.x - from.x, p.y - from.y))[0];
    expect(m.command(m.playerId, { type: 'move', x: far.x, y: far.y })).toBeNull();
    walkInside(m, r);
    expect({ x: Math.floor(m.player.x), y: Math.floor(m.player.y) }).toEqual(far);
  });

  it('test_hero_dense_room_upgrade_surrounded_building_not_stuck', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    r.candy = 9999;
    fillWithCannons(m, r);
    // Пушка, у которой все соседи заняты, — раньше к ней было «Не подойти».
    const surrounded = r.buildings.find((b) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].every(([dx, dy]) => !inRoom(r, b.x + dx, b.y + dy) || occupantAt(r, b.x + dx, b.y + dy) !== null),
    );
    expect(surrounded).toBeDefined();
    expect(m.command(m.playerId, { type: 'upgrade', x: surrounded!.x, y: surrounded!.y })).toBeNull();
    finishTask(m);
    expect(surrounded!.level).toBe(2);
  });

  it('test_hero_walls_and_room_bounds_still_block', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    // Клетка за пределами комнаты (стена или коридор) — туда нельзя.
    const outside = { x: r.x0 - 1, y: r.y0 };
    expect(m.command(m.playerId, { type: 'move', x: outside.x, y: outside.y })).toBe('Туда не пройти');
    expect(m.command(m.playerId, { type: 'move', x: r.door.x, y: r.door.y })).toBe('Туда не пройти');
  });

  it('test_placement_no_blocking_message_anywhere_in_src', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|html|css)$/.test(name) && readFileSync(p, 'utf8').includes('Загородит проход')) hits.push(p);
      }
    };
    walk('src');
    expect(hits).toEqual([]);
  });
});
