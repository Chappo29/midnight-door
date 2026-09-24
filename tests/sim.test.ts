import { describe, expect, it } from 'vitest';
import { B, doorMaxHp, sofaNeedDoor } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import { Tile, generateMap, guardSlots } from '../src/sim/map';
import { bfs } from '../src/sim/path';
import { Rng } from '../src/sim/rng';
import { allConnected } from '../src/sim/roomgrid';
import type { Difficulty, SimEvent } from '../src/sim/types';
import { finishTask, inRoomMatch, mkBuilding, nightNow, pinGhostAtDoor, runUntil, stepSec } from './helpers';

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

  it('test_match_player_caught_becomes_spirit_match_continues', () => {
    const m = new Match({ seed: 11, difficulty: 'nightmare', flameUnlocked: false });
    // Игрок ничего не делает — рано или поздно дверь ломают.
    runUntil(m, (mm) => mm.player.caught, 2400);
    expect(m.player.caught).toBe(true);
    expect(m.survivors).toBeGreaterThan(0);
    expect(m.player.spirit).toBe(true);
    expect(m.result).toBeNull();
    expect(m.phase).toBe('night');
    // Матч идёт дальше: ночь продолжается и после поимки.
    const t = m.nightTime;
    stepSec(m, 5);
    expect(m.nightTime).toBeGreaterThan(t);
  });

  it('test_match_all_caught_is_lose', () => {
    // Arrange: все соседи уже пойманы, у игрока дверь на последнем издыхании.
    const m = inRoomMatch();
    nightNow(m);
    for (const r of m.rooms) {
      if (r.ownerId === null || r.ownerId === m.playerId) continue;
      r.eliminated = true;
      m.chars[r.ownerId].caught = true;
    }
    const room = m.playerRoom!;
    room.door.hp = 1;
    pinGhostAtDoor(m, room);
    // Act
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 20 && !m.result; i++) {
      m.step();
      events.push(...m.events);
    }
    // Assert: последнего поймали — поражение, духом не стал (карточки духа нет).
    expect(m.result).toBe('lose');
    expect(m.resultReason).toBe('allCaught');
    expect(m.player.caught).toBe(true);
    expect(m.player.spirit).toBe(false);
    expect(events.some((e) => e.type === 'spirit')).toBe(false);
  });

  it('test_match_spirit_team_win', () => {
    // Arrange: игрока поймали — он дух.
    const m = inRoomMatch();
    nightNow(m);
    const room = m.playerRoom!;
    room.door.hp = 1;
    pinGhostAtDoor(m, room);
    runUntil(m, (mm) => mm.player.spirit, 20);
    expect(m.player.spirit).toBe(true);
    // Призрак почти добит и стоит на пушке соседа.
    const nb = m.rooms.find((r) => r.ownerId !== null && r.ownerId !== m.playerId && !r.eliminated)!;
    const cell = nb.door.inside;
    nb.buildings.push(mkBuilding('cannon', cell.x, cell.y));
    pinGhostAtDoor(m, nb);
    m.ghost.x = cell.x + 0.5;
    m.ghost.y = cell.y + 0.5;
    m.ghost.hp = 1;
    // Act
    runUntil(m, (mm) => mm.result !== null, 5);
    // Assert
    expect(m.result).toBe('win');
    expect(m.resultReason).toBe('ghost');
    expect(m.teamWin).toBe(true);
  });

  it('test_match_same_seed_same_outcome', () => {
    const run = () => {
      const m = new Match({ seed: 5, difficulty: 'nightmare', flameUnlocked: true, autoPlayer: true });
      runToEnd(m);
      return { result: m.result, nightTime: m.nightTime, level: m.ghost.level, team: m.teamWin };
    };
    expect(run()).toEqual(run());
  });
});

describe('sofa gate', () => {
  it('test_sofa_upgrade_without_door_level_returns_reason', () => {
    // Arrange
    const m = inRoomMatch();
    const room = m.playerRoom!;
    room.sofa.level = 2;
    room.door.level = 1;
    room.candy = 9999;
    // Act
    const err = m.command(0, { type: 'upgradeSofa' });
    // Assert
    expect(err).toMatch(/Сначала дверь до ур\. 2/);
    for (let i = 0; i < 20 * 5; i++) m.step();
    expect(room.sofa.level).toBe(2);
  });

  it('test_sofa_upgrade_with_door_level_succeeds', () => {
    // Arrange
    const m = inRoomMatch();
    const room = m.playerRoom!;
    room.sofa.level = 2;
    room.door.level = 2;
    room.door.maxHp = room.door.hp = doorMaxHp(2);
    room.candy = 9999;
    // Act
    const err = m.command(0, { type: 'upgradeSofa' });
    finishTask(m);
    // Assert
    expect(err).toBeNull();
    expect(room.sofa.level).toBe(3);
  });

  it('test_sofa_blockedBy_table_matches_needDoor', () => {
    // Arrange
    const m = inRoomMatch();
    const room = m.playerRoom!;
    room.door.level = 1;
    // Act & Assert
    for (let lvl = 1; lvl <= 7; lvl++) {
      room.sofa.level = lvl;
      const need = sofaNeedDoor(lvl + 1);
      expect(m.sofaBlockedBy(room)).toBe(need > 1 ? need : null);
    }
    room.sofa.level = B.sofa.max;
    expect(m.sofaBlockedBy(room)).toBeNull();
  });

  it('test_npc_sofa_blocked_never_orders_sofa', () => {
    // Arrange
    const m = new Match({ seed: 13, difficulty: 'easy', flameUnlocked: true, autoPlayer: true });
    while (m.phase === 'pick') m.step();
    nightNow(m);
    // Act
    stepSec(m, 600);
    // Assert: дверь не может понизиться в уровне сама по себе — раз диван добрался до текущего уровня,
    // дверь уже тогда была нужного уровня и с тех пор могла только подрасти.
    for (const r of m.rooms) {
      if (r.ownerId === null) continue;
      expect(r.door.level).toBeGreaterThanOrEqual(sofaNeedDoor(r.sofa.level));
    }
  });
});
