import { describe, expect, it } from 'vitest';
import { B, TICK } from '../src/sim/balance';
import { ghostDamage, ghostXpNeed } from '../src/sim/ghost';
import { Match } from '../src/sim/match';
import type { SimEvent } from '../src/sim/types';
import { TutorialDirector } from '../src/tutorial/director';
import { inRoomMatch, nightNow, pinGhostAtDoor, quietFloor, runUntil, stepSec } from './helpers';

/** Ночь, призрак бьёт дверь игрока; дверь почти вечная, пушек на этаже нет — ничто не мешает считать. */
function siege(): Match {
  const m = inRoomMatch();
  nightNow(m);
  for (const r of m.rooms) r.buildings = r.buildings.filter((b) => b.kind !== 'cannon');
  const door = m.playerRoom!.door;
  door.maxHp = door.hp = 1e6;
  m.ghost.xp = 0;
  m.ghost.levelTimer = 0;
  pinGhostAtDoor(m, m.playerRoom!);
  return m;
}

/** Шагает до первого события type (не дольше maxSec), возвращает события этого тика. */
function stepUntilEvent(m: Match, type: SimEvent['type'], maxSec: number): readonly SimEvent[] {
  for (let i = 0; i < maxSec * 20; i++) {
    m.step();
    if (m.events.some((e) => e.type === type)) return m.events;
  }
  throw new Error(`нет события ${type} за ${maxSec} с`);
}

describe('уровень призрака от ударов', () => {
  it('test_ghost_xp_full_hits_level_up_and_carry_over', () => {
    const m = siege();
    m.ghost.xp = ghostXpNeed(m, 1) - 0.5;
    stepUntilEvent(m, 'doorHit', 2);
    expect(m.ghost.level).toBe(2);
    expect(m.ghost.xp).toBeCloseTo(0.5, 6);
  });

  it('test_ghost_xp_partial_hit_counts_fraction', () => {
    const m = siege();
    const door = m.playerRoom!.door;
    door.maxHp = 1000;
    door.hp = 0.25 * ghostDamage(m, m.ghost.level);
    pinGhostAtDoor(m, m.playerRoom!);
    stepUntilEvent(m, 'doorBroken', 2);
    expect(m.ghost.xp).toBeCloseTo(0.25, 6);
    expect(m.ghost.level).toBe(1);
  });

  it('test_ghost_level_need_grows_5_percent_per_level', () => {
    const m = new Match({ seed: 7, difficulty: 'hard', flameUnlocked: true });
    expect(ghostXpNeed(m, 1)).toBeCloseTo(m.diff.hitsPerLevel, 9);
    expect(ghostXpNeed(m, 3)).toBeCloseTo(m.diff.hitsPerLevel * (1 + 2 * B.ghost.xpGrowth), 9);
  });

  it('test_ghost_fallback_timer_levels_without_hits', () => {
    const m = inRoomMatch();
    nightNow(m);
    expect(m.ghost.state).toBe('moving');
    m.ghost.xp = 0;
    m.ghost.levelTimer = m.diff.levelFallback - 0.1;
    stepSec(m, 0.2);
    expect(m.ghost.level).toBe(2);
    expect(m.ghost.levelTimer).toBeLessThan(0.2);
  });

  it('test_ghost_new_level_resets_fallback_timer', () => {
    const m = siege();
    m.ghost.levelTimer = m.diff.levelFallback - 1;
    m.ghost.xp = ghostXpNeed(m, 1) - 0.5;
    stepUntilEvent(m, 'ghostLevel', 2);
    expect(m.ghost.levelTimer).toBeLessThan(TICK + 1e-9);
  });

  it('test_ghost_new_level_heals_10_percent', () => {
    const m = siege();
    m.ghost.hp = m.ghost.maxHp * 0.5;
    m.ghost.siegeHp = m.ghost.hp;
    m.ghost.xp = ghostXpNeed(m, 1) - 0.5;
    stepUntilEvent(m, 'ghostLevel', 2);
    expect(m.ghost.hp / m.ghost.maxHp).toBeCloseTo(0.5 + B.ghost.levelHeal, 2);
  });

  it('test_ghost_caught_owner_still_gives_level', () => {
    const m = siege();
    const door = m.playerRoom!.door;
    door.maxHp = 1000;
    door.hp = 1;
    pinGhostAtDoor(m, m.playerRoom!);
    const events = stepUntilEvent(m, 'caught', 20);
    expect(events.some((e) => e.type === 'ghostLevel')).toBe(true);
    expect(m.ghost.level).toBe(2);
  });

  it('test_ghost_tutorial_never_gains_xp', () => {
    const m = new Match({ seed: 20260924, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const d = new TutorialDirector(m);
    d.allowTap(0, 0);
    m.command(0, { type: 'pickRoom', roomId: 0 });
    const tick = () => {
      m.step();
      d.onEvents(m.events);
      d.update(TICK);
    };
    for (let i = 0; i < 20 * 20; i++) tick();
    m.script!.holdPhase = false;
    m.script!.ghostTarget = m.player.roomId;
    let hits = 0;
    for (let i = 0; i < 20 * 300 && m.phase !== 'end'; i++) {
      tick();
      hits += m.events.filter((e) => e.type === 'doorHit' && e.dmg > 0).length;
    }
    expect(hits).toBeGreaterThan(0);
    expect(m.ghost.xp).toBe(0);
    expect(m.ghost.level).toBe(1);
  });
});

/**
 * Призрак прилетает в гнездо с 10% HP и лечится до конца отдыха; возвращает, сколько вылечил (доля макс. HP).
 * Соседи спят, пушки убраны — ничто не мешает лечению.
 */
function nestVisit(m: Match): number {
  const g = m.ghost;
  g.x = g.prevX = m.nest.x;
  g.y = g.prevY = m.nest.y;
  g.waypoints = [];
  g.state = 'retreating';
  g.levelTimer = 0;
  g.hp = g.maxHp * 0.1;
  const before = g.hp;
  m.step();
  expect(g.state).toBe('healing');
  runUntil(m, (mm) => mm.ghost.state !== 'healing', B.ghost.healTime + 1);
  return (g.hp - before) / g.maxHp;
}

describe('лечение в гнезде', () => {
  function nestMatch(): Match {
    const m = inRoomMatch();
    nightNow(m);
    quietFloor(m);
    m.playerRoom!.buildings = [];
    return m;
  }

  it('test_ghost_nest_first_visit_heals_full_frac', () => {
    const m = nestMatch();
    expect(nestVisit(m)).toBeCloseTo(B.ghost.healFrac, 2);
  });

  // Регрессия: раньше каждый заход лечил одинаково (+40%), призрак бегал лечиться бесконечно,
  // а к 35-й минуте перерастал пушки — матчи тянулись по 48–54 минуты (сиды 4, 40, 195 × 7919, лёгкая, пламя закрыто).
  it('test_ghost_nest_heal_weakens_each_visit', () => {
    const m = nestMatch();
    const first = nestVisit(m);
    const second = nestVisit(m);
    const third = nestVisit(m);
    expect(second).toBeCloseTo(first * B.ghost.healDecay, 2);
    expect(third).toBeCloseTo(first * B.ghost.healDecay ** 2, 2);
  });

  it('test_ghost_nest_heal_above_retreat_still_retreats_later', () => {
    const m = nestMatch();
    const g = m.ghost;
    nestVisit(m);
    expect(g.desperate).toBe(false);
    g.hp = g.maxHp * B.ghost.retreatAt * 0.5;
    let retreats = 0;
    for (let i = 0; i < 20 && !retreats; i++) {
      m.step();
      retreats += m.events.filter((e) => e.type === 'ghostRetreat').length;
    }
    expect(retreats).toBe(1);
  });

  // Гнездо больше не поднимает выше порога бегства — раньше призрак тут же убегал снова и крутился у гнезда сотни раз.
  it('test_ghost_nest_cant_heal_above_retreat_fights_to_end', () => {
    const m = nestMatch();
    const g = m.ghost;
    g.nestVisits = 100;
    nestVisit(m);
    expect(g.hp / g.maxHp).toBeLessThan(B.ghost.retreatAt);
    expect(g.state).toBe('moving');
    const visits = g.nestVisits;
    let retreats = 0;
    for (let i = 0; i < 20 * 30; i++) {
      m.step();
      retreats += m.events.filter((e) => e.type === 'ghostRetreat').length;
    }
    expect(retreats).toBe(0);
    expect(g.nestVisits).toBe(visits);
  });
});

describe('сигнал «Призрак идёт к тебе»', () => {
  it('test_ghost_emits_target_event_matching_its_target_room', () => {
    // Arrange: ночь только началась.
    const m = inRoomMatch();
    // Act
    nightNow(m);
    const events = stepUntilEvent(m, 'ghostTarget', 30);
    const e = events.find((q) => q.type === 'ghostTarget');
    // Assert: событие говорит, к какой двери он пошёл, — ровно та цель, что в симуляции.
    expect(e && e.type === 'ghostTarget' && e.roomId).toBe(m.ghost.targetRoom);
  });

  it('test_ghost_target_event_once_per_choice', () => {
    // Не спамить: одно событие на один выбор двери, а не каждый тик похода.
    const m = inRoomMatch();
    nightNow(m);
    let count = 0;
    let choices = 0;
    let last = -2;
    for (let i = 0; i < 20 * 60; i++) {
      const before = m.ghost.targetRoom;
      m.step();
      count += m.events.filter((q) => q.type === 'ghostTarget').length;
      if (m.ghost.targetRoom !== before && m.ghost.targetRoom >= 0 && m.ghost.state === 'moving') choices++;
      last = m.ghost.targetRoom;
    }
    expect(last).not.toBe(-2);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(choices + 1);
  });
});
