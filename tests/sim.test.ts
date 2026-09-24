import { describe, expect, it } from 'vitest';
import { B } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import { Tile, generateMap, guardSlots } from '../src/sim/map';
import { bfs } from '../src/sim/path';
import { Rng } from '../src/sim/rng';
import { allConnected } from '../src/sim/roomgrid';
import type { Difficulty } from '../src/sim/types';

function runToEnd(m: Match, maxSeconds = 2400): void {
  for (let i = 0; i < maxSeconds * 20 && m.phase !== 'end'; i++) m.step();
}

describe('path', () => {
  it('обходит препятствие', () => {
    const wall = new Set(['1,0', '1,1']);
    const path = bfs({ x: 0, y: 0 }, [{ x: 2, y: 0 }], (x, y) => x >= 0 && y >= 0 && x < 3 && y < 3 && !wall.has(`${x},${y}`));
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual({ x: 2, y: 0 });
    expect(path!.length).toBe(6);
  });

  it('возвращает null, если дойти нельзя', () => {
    expect(bfs({ x: 0, y: 0 }, [{ x: 5, y: 5 }], (x, y) => x === 0 && y === 0)).toBeNull();
  });
});

describe('map', () => {
  it('в каждой комнате всё достижимо от двери', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { rooms } = generateMap(new Rng(seed));
      expect(rooms.length).toBeGreaterThanOrEqual(7);
      expect(rooms.length).toBeLessThanOrEqual(9);
      for (const r of rooms) {
        expect(allConnected(r)).toBe(true);
        // Комнату можно защитить: есть места под пушку, достающую до двери.
        expect(guardSlots(r)).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('от гнезда призрак доходит по коридорам до каждой двери', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { tiles, rooms, nest } = generateMap(new Rng(seed));
      const hall = (x: number, y: number) => tiles[y]?.[x] === Tile.Corridor || tiles[y]?.[x] === Tile.Nest;
      for (const r of rooms) {
        expect(tiles[r.door.y][r.door.x]).toBe(Tile.Door);
        const front = { x: Math.floor(r.door.front.x), y: Math.floor(r.door.front.y) };
        expect(bfs({ x: Math.floor(nest.x), y: Math.floor(nest.y) }, [front], hall)).not.toBeNull();
      }
    }
  });
});

describe('match', () => {
  it('игрок выбирает комнату, строит пушку и улучшает дверь', () => {
    const m = new Match({ seed: 7, difficulty: 'easy', flameUnlocked: true });
    expect(m.command(0, { type: 'pickRoom', roomId: 2 })).toBeNull();
    expect(m.command(0, { type: 'pickRoom', roomId: 3 })).not.toBeNull();
    while (m.phase === 'pick') m.step();
    for (let i = 0; i < 20 * 3; i++) m.step(); // дошёл до комнаты

    const room = m.rooms[2];
    room.candy = 1000;
    const cell = m.findBuildCell(room, 'cannon')!;
    expect(m.command(0, { type: 'build', kind: 'cannon', ...cell })).toBeNull();
    for (let i = 0; i < 20 * 6 && room.buildings.length === 0; i++) m.step();
    expect(room.buildings).toHaveLength(1);
    expect(allConnected(room)).toBe(true);

    expect(m.command(0, { type: 'upgradeDoor' })).toBeNull();
    for (let i = 0; i < 20 * 6 && room.door.level === 1; i++) m.step();
    expect(room.door.level).toBe(2);
    expect(room.door.hp).toBe(room.door.maxHp);
  });

  it('починка ключом: разом +доля HP, потом перезарядка', () => {
    const m = new Match({ seed: 7, difficulty: 'easy', flameUnlocked: true });
    expect(m.command(0, { type: 'pickRoom', roomId: 2 })).toBeNull();
    while (m.phase === 'pick') m.step();
    for (let i = 0; i < 20 * 20 && m.player.path.length; i++) m.step();
    const d = m.rooms[2].door;
    d.hp = d.maxHp * 0.2;
    expect(m.command(0, { type: 'repair' })).toBeNull();
    for (let i = 0; i < 20 * 5 && d.repairCd === 0; i++) m.step();
    expect(d.hp).toBeCloseTo(d.maxHp * (0.2 + B.repair.amount), 0);
    expect(m.command(0, { type: 'repair' })).toMatch(/Ключ будет готов/);
  });

  it('прерванная стройка возвращает конфеты', () => {
    const m = new Match({ seed: 7, difficulty: 'easy', flameUnlocked: true });
    m.command(0, { type: 'pickRoom', roomId: 2 });
    while (m.phase === 'pick') m.step();
    for (let i = 0; i < 20 * 20 && m.player.path.length; i++) m.step();
    const room = m.rooms[2];
    room.candy = 500;
    const cell = m.findBuildCell(room, 'cannon')!;
    m.command(0, { type: 'build', kind: 'cannon', ...cell });
    for (let i = 0; i < 20 * 10 && m.player.task?.stage !== 'work'; i++) m.step();
    expect(room.candy).toBeLessThan(500);
    const spot = m.randomWalkableCell(room)!;
    expect(m.command(0, { type: 'move', ...spot })).toBeNull();
    expect(room.candy).toBeCloseTo(500 + 0, -1);
    expect(room.buildings).toHaveLength(0);
  });

  it('радиус пушки растёт с уровнем', () => {
    const m = new Match({ seed: 7, difficulty: 'easy', flameUnlocked: true });
    expect(m.cannonRange({ level: 1 })).toBe(B.cannon.range);
    expect(m.cannonRange({ level: 4 })).toBeGreaterThan(m.cannonRange({ level: 3 }));
  });

  it('нельзя загородить проход к двери', () => {
    const m = new Match({ seed: 3, difficulty: 'easy', flameUnlocked: true });
    const r = m.rooms[0];
    const inside = r.door.inside;
    expect(m.canPlace(r, inside.x, inside.y, 'cannon')).toBe('Здесь проход к двери');
  });

  it('в первом матче тыквы закрыты, а цена пламени переходит в конфеты', () => {
    const m = new Match({ seed: 3, difficulty: 'easy', flameUnlocked: false });
    const r = m.rooms[0];
    expect(m.canPlace(r, r.soil[0].x, r.soil[0].y, 'pumpkin')).toMatch(/втором матче/);
    r.door.level = 3;
    expect(m.doorUpgradeCost(r)).toEqual({ candy: B.door[3].candy + B.door[3].flame * B.flameToCandy, flame: 0 });
  });

  it.each<Difficulty>(['easy', 'hard', 'nightmare'])('матч на %s доходит до конца без ошибок', (difficulty) => {
    for (let seed = 1; seed <= 5; seed++) {
      const m = new Match({ seed, difficulty, flameUnlocked: seed % 2 === 0, autoPlayer: true });
      runToEnd(m);
      expect(m.phase).toBe('end');
      expect(m.result).not.toBeNull();
      for (const r of m.rooms) {
        expect(r.candy).toBeGreaterThanOrEqual(-1e-6);
        expect(r.door.hp).toBeGreaterThanOrEqual(0);
        expect(r.door.hp).toBeLessThanOrEqual(r.door.maxHp);
      }
    }
  });

  it('если игрока поймали — поражение', () => {
    const m = new Match({ seed: 11, difficulty: 'nightmare', flameUnlocked: false });
    // Игрок ничего не делает — рано или поздно дверь ломают.
    runToEnd(m);
    expect(m.result).toBe('lose');
    expect(m.resultReason).toBe('caught');
    expect(m.player.caught).toBe(true);
  });
});
