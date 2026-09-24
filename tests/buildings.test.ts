import { describe, expect, it } from 'vitest';
import { B, TICK, doorMaxHp, sofaNeedDoor } from '../src/sim/balance';
import { ghostHitInterval, ghostHitIntervalAt } from '../src/sim/ghost';
import { Match } from '../src/sim/match';
import { occupantAt, roomCells } from '../src/sim/roomgrid';
import type { BuildKind, Room, SimEvent, Vec } from '../src/sim/types';
import { inRoomMatch, mkBuilding, nightNow, pinGhostAtDoor, quietFloor, runUntil, stepSec } from './helpers';

/** Дверь сразу нужного уровня (HP — полное). */
function setDoor(r: Room, level: number): void {
  r.door.level = level;
  r.door.maxHp = r.door.hp = doorMaxHp(level);
}

/** Свободные клетки комнаты под пушку, по порядку (без rng — тесты не сдвигают генератор). */
function freeCells(m: Match, r: Room): Vec[] {
  return roomCells(r).filter((v) => m.canPlace(r, v.x, v.y, 'cannon') === null);
}

/** Две свободные клетки поближе друг к другу — чтобы призрак между ними был в радиусе обеих. */
function twoCloseCells(m: Match, r: Room): [Vec, Vec] {
  const cells = freeCells(m, r);
  const a = cells[0];
  const b = cells
    .slice(1)
    .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
  return [a, b];
}

/** Шагает sec секунд и собирает все события этого времени. */
function collect(m: Match, sec: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(sec / TICK); i++) {
    m.step();
    out.push(...m.events);
  }
  return out;
}

const count = (ev: readonly SimEvent[], type: SimEvent['type']) => ev.filter((e) => e.type === type).length;

/** Ночь, этаж тихий, призрак ломится в дверь игрока; дверь почти вечная. */
function nightSiege(): Match {
  const m = inRoomMatch();
  nightNow(m);
  quietFloor(m);
  const door = m.playerRoom!.door;
  door.maxHp = door.hp = 1e6;
  pinGhostAtDoor(m, m.playerRoom!);
  return m;
}

describe('поздние постройки: замок дверью и лимиты', () => {
  it('test_buildings_trap_locked_until_door_2_then_allowed', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    r.candy = 9999;
    const c = freeCells(m, r)[0];
    expect(m.buildLocked(r, 'trap')).toBe(2);
    expect(m.canPlace(r, c.x, c.y, 'trap')).toMatch(/дверь до ур\. 2/);
    expect(m.command(0, { type: 'build', kind: 'trap', ...c })).toMatch(/дверь до ур\. 2/);
    setDoor(r, 2);
    expect(m.buildLocked(r, 'trap')).toBeNull();
    expect(m.canPlace(r, c.x, c.y, 'trap')).toBeNull();
  });

  it('test_buildings_workbench_needs_door_3_fridge_needs_door_4', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    const c = freeCells(m, r)[0];
    setDoor(r, 2);
    expect(m.canPlace(r, c.x, c.y, 'workbench')).toMatch(/дверь до ур\. 3/);
    expect(m.canPlace(r, c.x, c.y, 'fridge')).toMatch(/дверь до ур\. 4/);
    setDoor(r, 3);
    expect(m.canPlace(r, c.x, c.y, 'workbench')).toBeNull();
    expect(m.canPlace(r, c.x, c.y, 'fridge')).toMatch(/дверь до ур\. 4/);
    setDoor(r, 4);
    expect(m.canPlace(r, c.x, c.y, 'fridge')).toBeNull();
  });

  it('test_buildings_cannon_and_pumpkin_never_locked', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    expect(m.buildLocked(r, 'cannon')).toBeNull();
    expect(m.buildLocked(r, 'pumpkin')).toBeNull();
  });

  it('test_buildings_tutorial_new_kinds_always_locked', () => {
    const m = new Match({ seed: 20260924, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const r = m.rooms[0];
    setDoor(r, 5);
    for (const k of ['trap', 'workbench', 'fridge'] as BuildKind[]) expect(m.buildLocked(r, k)).not.toBeNull();
    expect(m.buildLocked(r, 'cannon')).toBeNull();
  });

  it('test_buildings_trap_cap_two_per_room', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    r.candy = 9999;
    // Замок проверяется раньше лимита — открываем капкан дверью.
    setDoor(r, 2);
    const [a, b] = freeCells(m, r);
    r.buildings.push(mkBuilding('trap', a.x, a.y), mkBuilding('trap', b.x, b.y));
    const c = freeCells(m, r)[0];
    expect(c).toBeDefined();
    expect(m.canPlace(r, c.x, c.y, 'trap')).toBe('Больше нельзя');
    expect(m.command(0, { type: 'build', kind: 'trap', ...c })).toBe('Больше нельзя');
    // Пушку туда же поставить можно — лимит только у капканов.
    expect(m.canPlace(r, c.x, c.y, 'cannon')).toBeNull();
  });

  it('test_buildings_workbench_and_fridge_one_per_room', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    setDoor(r, 4);
    const [a, b] = freeCells(m, r);
    r.buildings.push(mkBuilding('workbench', a.x, a.y), mkBuilding('fridge', b.x, b.y));
    const c = freeCells(m, r)[0];
    expect(m.canPlace(r, c.x, c.y, 'workbench')).toBe('Больше нельзя');
    expect(m.canPlace(r, c.x, c.y, 'fridge')).toBe('Больше нельзя');
  });

  it('test_buildings_new_kinds_not_on_soil', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    setDoor(r, 4);
    const s = r.soil.find((v) => occupantAt(r, v.x, v.y) === null)!;
    for (const k of ['trap', 'workbench', 'fridge'] as BuildKind[]) expect(m.canPlace(r, s.x, s.y, k)).toBe('Грядка — для тыкв');
  });

  it('test_buildings_fridge_without_flame_says_flame', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    setDoor(r, 4);
    r.candy = 9999;
    r.flame = 0;
    const c = freeCells(m, r)[0];
    expect(m.command(0, { type: 'build', kind: 'fridge', ...c })).toBe('Не хватает пламени');
  });

  it('test_buildings_player_builds_trap_it_starts_armed', () => {
    const m = inRoomMatch();
    const r = m.playerRoom!;
    setDoor(r, 2);
    r.candy = 9999;
    const c = freeCells(m, r)[0];
    expect(m.command(0, { type: 'build', kind: 'trap', ...c })).toBeNull();
    runUntil(m, (mm) => mm.playerRoom!.buildings.some((q) => q.kind === 'trap'), 15);
    const t = r.buildings.find((q) => q.kind === 'trap')!;
    expect(t.level).toBe(1);
    expect(t.cooldown).toBe(0);
    // Заплачено (за время стройки диван успел накапать немного конфет).
    expect(r.candy).toBeLessThan(9999 - B.trap.cost.candy + 10);
  });

  it('test_buildings_upgrade_cost_table', () => {
    const m = inRoomMatch();
    expect(m.upgradeCost({ kind: 'fridge', level: 1 })).toEqual(B.fridge.up[0]);
    expect(m.upgradeCost({ kind: 'fridge', level: 3 })).toBeNull();
    expect(m.upgradeCost({ kind: 'trap', level: 1 })).toEqual(B.trap.up[0]);
    expect(m.upgradeCost({ kind: 'workbench', level: 2 })).toEqual(B.workbench.up[1]);
    // Первый матч: пламя переводится в конфеты.
    const first = inRoomMatch({ flameUnlocked: false });
    const up = B.fridge.up[0];
    expect(first.upgradeCost({ kind: 'fridge', level: 1 })).toEqual({ candy: up.candy + up.flame * B.flameToCandy, flame: 0 });
    expect(first.buildCost('fridge')).toEqual({ candy: B.fridge.cost.candy + B.fridge.cost.flame * B.flameToCandy, flame: 0 });
  });

  it('test_buildings_hasBuildCell_does_not_touch_rng', () => {
    const a = inRoomMatch();
    const b = inRoomMatch();
    for (let i = 0; i < 50; i++) expect(a.hasBuildCell(a.playerRoom!, 'cannon')).toBe(true);
    stepSec(a, 20);
    stepSec(b, 20);
    expect(a.rng.next()).toBe(b.rng.next());
    expect(a.chars.map((c) => [c.x, c.y])).toEqual(b.chars.map((c) => [c.x, c.y]));
  });
});

describe('капкан', () => {
  it('test_trap_holds_ghost_then_recharges', () => {
    const m = inRoomMatch();
    nightNow(m);
    quietFloor(m);
    const r = m.playerRoom!;
    const [a] = twoCloseCells(m, r);
    r.buildings.push(mkBuilding('trap', a.x, a.y));
    const g = m.ghost;
    g.state = 'moving';
    g.targetRoom = r.id;
    g.x = g.prevX = a.x + 0.5 + 1.5;
    g.y = g.prevY = a.y + 0.5;
    g.waypoints = [{ x: g.x + 40, y: g.y }];
    g.held = g.holdImmune = 0;

    m.step();
    expect(count(m.events, 'trapped')).toBe(1);
    expect(g.held).toBeCloseTo(B.trap.hold[0], 6);
    expect(r.buildings[r.buildings.length - 1].cooldown).toBeCloseTo(B.trap.recharge[0], 6);
    const pos = { x: g.x, y: g.y };
    stepSec(m, 1.0);
    expect(g.x).toBe(pos.x);
    expect(g.y).toBe(pos.y);
    expect(g.state).toBe('moving');
    stepSec(m, 0.7);
    expect(g.x).toBeGreaterThan(pos.x);
    // Перезарядка идёт своим ходом.
    expect(r.buildings[r.buildings.length - 1].cooldown).toBeCloseTo(B.trap.recharge[0] - 1.7, 3);
  });

  it('test_trap_immunity_blocks_second_trap_for_4s', () => {
    const m = nightSiege();
    const r = m.playerRoom!;
    const [a, b] = twoCloseCells(m, r);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(2 * B.trap.radius);
    r.buildings.push(mkBuilding('trap', a.x, a.y), mkBuilding('trap', b.x, b.y));
    const g = m.ghost;
    // Призрак ломится в дверь (стоит на месте), но между двумя капканами.
    g.x = g.prevX = (a.x + b.x) / 2 + 0.5;
    g.y = g.prevY = (a.y + b.y) / 2 + 0.5;

    const first = collect(m, TICK);
    expect(count(first, 'trapped')).toBe(1);
    const later = collect(m, B.trap.hold[0] + B.trap.immune - 0.1);
    expect(count(later, 'trapped')).toBe(0);
    const after = collect(m, 0.3);
    expect(count(after, 'trapped')).toBe(1);
  });

  it('test_trap_ignores_entering_and_healing_ghost', () => {
    for (const state of ['entering', 'healing'] as const) {
      const m = inRoomMatch();
      nightNow(m);
      quietFloor(m);
      const r = m.playerRoom!;
      const [a] = twoCloseCells(m, r);
      r.buildings.push(mkBuilding('trap', a.x, a.y));
      const g = m.ghost;
      g.state = state;
      g.targetRoom = r.id;
      g.healTimer = 5;
      g.x = g.prevX = a.x + 0.5;
      g.y = g.prevY = a.y + 1.5;
      g.waypoints = [{ x: g.x + 40, y: g.y }];
      const ev = collect(m, 0.5);
      expect(count(ev, 'trapped')).toBe(0);
      expect(g.held).toBe(0);
    }
  });

  it('test_trap_hold_does_not_trigger_stalled_giveup', () => {
    const m = nightSiege();
    const r = m.playerRoom!;
    const [a] = twoCloseCells(m, r);
    r.buildings.push(mkBuilding('trap', a.x, a.y, 3));
    const g = m.ghost;
    g.x = g.prevX = a.x + 0.5;
    g.y = g.prevY = a.y + 0.5;
    m.step();
    expect(g.held).toBeCloseTo(B.trap.hold[2], 6);
    const siege = g.siegeTime;
    const hit = g.hitTimer;
    const ev = collect(m, B.trap.hold[2] - 0.1);
    expect(g.siegeTime).toBe(siege);
    expect(g.hitTimer).toBe(hit);
    expect(g.state).toBe('attacking');
    expect(count(ev, 'doorHit')).toBe(0);
    expect(count(ev, 'ghostLeft')).toBe(0);
  });

  it('test_trap_held_ghost_still_takes_cannon_hits', () => {
    const m = nightSiege();
    const r = m.playerRoom!;
    const [a, b] = twoCloseCells(m, r);
    r.buildings.push(mkBuilding('trap', a.x, a.y), mkBuilding('cannon', b.x, b.y));
    const g = m.ghost;
    g.x = g.prevX = a.x + 0.5;
    g.y = g.prevY = a.y + 0.5;
    const hp = g.hp;
    collect(m, 1);
    expect(g.held).toBeGreaterThan(0);
    expect(g.hp).toBeLessThan(hp);
  });
});

describe('верстак', () => {
  it('test_workbench_heals_door_every_4s_at_night_only', () => {
    const m = inRoomMatch();
    quietFloor(m);
    const r = m.playerRoom!;
    const d = r.door;
    setDoor(r, 3);
    r.items = [];
    const [a] = freeCells(m, r);
    r.buildings.push(mkBuilding('workbench', a.x, a.y));
    d.hp = d.maxHp * 0.5;
    // Подготовка — верстак не работает.
    const prep = collect(m, 4.05);
    expect(m.phase).toBe('prep');
    expect(d.hp).toBe(d.maxHp * 0.5);
    expect(count(prep, 'benchFix')).toBe(0);

    // Ночь: заряжен с начала — чинит в первый же тик ночи.
    nightNow(m);
    m.ghost.state = 'hidden';
    m.ghost.waypoints = [];
    expect(count(m.events, 'benchFix')).toBe(1);
    const step = d.maxHp * B.workbench.heal[0];
    expect(d.hp).toBeCloseTo(d.maxHp * 0.5 + step, 6);
    // Следующая починка — через interval, не раньше.
    expect(count(collect(m, B.workbench.interval - 0.1), 'benchFix')).toBe(0);
    expect(count(collect(m, 0.2), 'benchFix')).toBe(1);
    expect(d.hp).toBeCloseTo(d.maxHp * 0.5 + 2 * step, 6);

    // Целую дверь не трогает и событие не шлёт.
    d.hp = d.maxHp;
    expect(count(collect(m, B.workbench.interval + 0.2), 'benchFix')).toBe(0);
    expect(d.hp).toBe(d.maxHp);

    // Сломанную не чинит.
    d.hp = 0;
    d.broken = true;
    expect(count(collect(m, B.workbench.interval + 0.2), 'benchFix')).toBe(0);
    expect(d.hp).toBe(0);
  });
});

describe('холодильник', () => {
  it('test_fridge_hit_interval_helper', () => {
    const m = nightSiege();
    const r = m.playerRoom!;
    expect(ghostHitIntervalAt(m, r)).toBeCloseTo(ghostHitInterval(m.ghost.level), 9);
    const [a] = freeCells(m, r);
    r.buildings.push(mkBuilding('fridge', a.x, a.y, 2));
    expect(ghostHitIntervalAt(m, r)).toBeCloseTo(ghostHitInterval(m.ghost.level) / (1 - B.fridge.slow[1]), 9);
  });

  it('test_fridge_slows_ghost_hits', () => {
    const hits = (fridge: boolean) => {
      const m = nightSiege();
      const r = m.playerRoom!;
      if (fridge) {
        const [a] = freeCells(m, r);
        r.buildings.push(mkBuilding('fridge', a.x, a.y));
      }
      return collect(m, 30).filter((e) => e.type === 'doorHit' && e.roomId === r.id).length;
    };
    const without = hits(false);
    const withFridge = hits(true);
    expect(without).toBeGreaterThan(15);
    expect(withFridge).toBeLessThan(without);
    expect(withFridge).toBeLessThanOrEqual(Math.round(without * (1 - B.fridge.slow[0])) + 1);
  });
});

describe('соседи и поздние постройки', () => {
  it('test_npc_late_buildings_respect_locks_and_caps', () => {
    let traps = 0;
    for (const difficulty of ['easy', 'nightmare'] as const) {
      for (const seed of [3, 5]) {
        const m = new Match({ seed, difficulty, flameUnlocked: true, autoPlayer: true });
        for (let i = 0; i < 20 * 900 && m.phase !== 'end'; i++) {
          m.step();
          for (const e of m.events) {
            if (e.type !== 'built' || e.kind === 'cannon' || e.kind === 'pumpkin') continue;
            const r = m.rooms[e.roomId];
            expect(r.door.level).toBeGreaterThanOrEqual(B.unlock[e.kind]);
            if (e.kind === 'trap') traps++;
          }
        }
        for (const r of m.rooms) {
          for (const k of ['trap', 'workbench', 'fridge'] as const) {
            expect(r.buildings.filter((b) => b.kind === k).length).toBeLessThanOrEqual(B[k].maxPerRoom);
          }
          // Диван-гейт (этап A) не сломан новыми опциями.
          expect(r.door.level).toBeGreaterThanOrEqual(sofaNeedDoor(r.sofa.level));
        }
      }
    }
    // Капкан ставят и лёгкие соседи (очки от умения, а не порог).
    expect(traps).toBeGreaterThan(0);
  });
});
