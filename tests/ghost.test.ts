import { describe, expect, it } from 'vitest';
import { B, DIFF, TICK } from '../src/sim/balance';
import { ghostDamage, ghostHealsLeft, ghostMaxHp, ghostXpNeed, spawnGhost } from '../src/sim/ghost';
import { Match } from '../src/sim/match';
import type { SimEvent } from '../src/sim/types';
import { TutorialDirector } from '../src/tutorial/director';
import { inRoomMatch, mkBuilding, nightNow, pinGhostAtDoor, quietFloor, runUntil, stepSec } from './helpers';

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
 * Один полный заход в гнездо «по-честному»: призрак идёт по этажу, HP падает до 10% — он сам убегает,
 * долетает до гнезда и отлечивается. Возвращает событие бегства и долю HP после лечения.
 * Уровень не растёт (таймер-страховка обнулён, по дверям он не бьёт) — ничто не мешает считать.
 */
function retreatCycle(m: Match): { retreat: SimEvent | undefined; hpFrac: number; events: SimEvent[] } {
  const g = m.ghost;
  // Подальше от гнезда (ночь начинается с призраком прямо в нём): у двери игрока.
  const f = m.playerRoom!.door.front;
  g.x = g.prevX = f.x;
  g.y = g.prevY = f.y;
  g.waypoints = [];
  g.levelTimer = 0;
  g.hp = g.maxHp * 0.1;
  const events: SimEvent[] = [];
  const tick = () => {
    m.step();
    events.push(...m.events);
  };
  tick();
  expect(g.state).toBe('retreating');
  for (let i = 0; i < 20 * 120 && g.state === 'retreating'; i++) tick();
  expect(g.state).toBe('healing');
  for (let i = 0; i < 20 * (B.ghost.healTime + 1) && g.state === 'healing'; i++) tick();
  expect(g.state).toBe('moving');
  return { retreat: events.find((e) => e.type === 'ghostRetreat'), hpFrac: g.hp / g.maxHp, events };
}

describe('лечение в гнезде', () => {
  function nestMatch(): Match {
    const m = inRoomMatch();
    nightNow(m);
    quietFloor(m);
    m.playerRoom!.buildings = [];
    return m;
  }

  // Регрессия: раньше призрак убегал ~10 раз за матч (лечил 40% × 0.85^заходов без лимита), и половина ночи была
  // циклом «почти убили → убежал» (GHOST_HEAL_BALANCE.md). Теперь 3 захода: до 75 / 65 / 55%, потом дерётся до конца.
  it('test_ghost_nest_three_heals_to_targets_then_desperate', () => {
    const m = nestMatch();
    const g = m.ghost;
    const [t1, t2, t3] = B.ghost.healTargets;
    expect(B.ghost.healTargets).toEqual([0.75, 0.65, 0.55]);

    const first = retreatCycle(m);
    expect(first.retreat).toEqual({ type: 'ghostRetreat', left: 2 });
    expect(first.hpFrac).toBeCloseTo(t1, 3);
    expect(g.nestVisits).toBe(1);
    expect(g.desperate).toBe(false);

    const second = retreatCycle(m);
    expect(second.retreat).toEqual({ type: 'ghostRetreat', left: 1 });
    expect(second.hpFrac).toBeCloseTo(t2, 3);
    expect(g.nestVisits).toBe(2);
    expect(g.desperate).toBe(false);

    const third = retreatCycle(m);
    expect(third.retreat).toEqual({ type: 'ghostRetreat', left: 0 });
    expect(third.hpFrac).toBeCloseTo(t3, 3);
    expect(g.nestVisits).toBe(3);
    expect(g.desperate).toBe(true);
    expect(third.events.filter((e) => e.type === 'ghostDesperate')).toHaveLength(1);
    expect(first.events.concat(second.events).some((e) => e.type === 'ghostDesperate')).toBe(false);

    // Четвёртого бегства нет: с 10% HP полминуты — ни одного события бегства, в гнездо не летит.
    g.hp = g.maxHp * 0.1;
    let retreats = 0;
    for (let i = 0; i < 20 * 30; i++) {
      m.step();
      retreats += m.events.filter((e) => e.type === 'ghostRetreat').length;
      expect(g.state === 'retreating' || g.state === 'healing').toBe(false);
    }
    expect(retreats).toBe(0);
    expect(g.nestVisits).toBe(3);
  });

  it('test_ghost_nest_heal_is_gradual_over_heal_time', () => {
    const m = nestMatch();
    const g = m.ghost;
    g.levelTimer = 0;
    g.hp = g.maxHp * 0.1;
    runUntil(m, (mm) => mm.ghost.state === 'healing', 120);
    const start = g.hp / g.maxHp;
    stepSec(m, B.ghost.healTime / 2);
    expect(g.state).toBe('healing');
    // Равномерно: к середине отдыха — половина пути до цели (не рывок в начале и не в конце).
    expect(g.hp / g.maxHp).toBeCloseTo(start + (B.ghost.healTargets[0] - start) / 2, 1);
  });

  it('test_ghost_new_spawn_resets_heals', () => {
    const m = nestMatch();
    const g = m.ghost;
    for (let i = 0; i < B.ghost.healTargets.length; i++) retreatCycle(m);
    expect(g.desperate).toBe(true);
    expect(ghostHealsLeft(g)).toBe(0);

    spawnGhost(m);
    expect(g.nestVisits).toBe(0);
    expect(g.desperate).toBe(false);
    expect(ghostHealsLeft(g)).toBe(3);
    expect(retreatCycle(m).retreat).toEqual({ type: 'ghostRetreat', left: 2 });
  });

  // Страховка от петли: если лечение почему-то не подняло выше порога бегства — больше не убегает, даже если заходы остались.
  it('test_ghost_nest_heal_below_threshold_still_desperate', () => {
    const ghostCfg = B.ghost as unknown as { healTargets: number[] };
    const targets = ghostCfg.healTargets;
    ghostCfg.healTargets = [B.ghost.retreatAt * 0.8, 0.65, 0.55];
    try {
      const m = nestMatch();
      retreatCycle(m);
      expect(m.ghost.nestVisits).toBe(1);
      expect(m.ghost.desperate).toBe(true);
    } finally {
      ghostCfg.healTargets = targets;
    }
  });

  // По бегущему призраку можно стрелять: убили по дороге — он мёртв, в гнездо не долетает и не лечится.
  it('test_ghost_killed_while_retreating_stays_dead', () => {
    const m = nestMatch();
    const g = m.ghost;
    const room = m.playerRoom!;
    const f = room.door.front;
    const cell = m.buildCells(room, 'cannon').sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0];
    room.buildings = [mkBuilding('cannon', cell.x, cell.y)];
    g.x = g.prevX = f.x;
    g.y = g.prevY = f.y;
    g.waypoints = [];
    g.state = 'moving';
    g.hp = 1;
    m.step();
    expect(m.events.some((e) => e.type === 'ghostRetreat')).toBe(true);
    expect(m.events.some((e) => e.type === 'ghostDead')).toBe(true);
    expect(g.state).toBe('dead');
    expect(m.result).toBe('win');
    let healing = false;
    let retreats = 0;
    for (let i = 0; i < 20 * 10; i++) {
      m.step();
      healing ||= m.ghost.state === 'healing';
      retreats += m.events.filter((e) => e.type === 'ghostRetreat').length;
    }
    expect(healing).toBe(false);
    expect(retreats).toBe(0);
    expect(g.hp).toBe(0);
    expect(g.nestVisits).toBe(0);
  });

  it('test_ghost_tutorial_never_retreats', () => {
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
    for (let i = 0; i < 20 * 120 && !(m.phase === 'night' && m.ghost.state === 'moving'); i++) tick();
    expect(m.ghost.state).toBe('moving');
    let retreats = 0;
    let ticks = 0;
    for (; ticks < 20 * 20 && m.phase !== 'end'; ticks++) {
      m.ghost.hp = m.ghost.maxHp * 0.1;
      tick();
      retreats += m.events.filter((e) => e.type === 'ghostRetreat').length;
    }
    // Все 20 с прошли с живым призраком — иначе «ни одного бегства» ничего бы не доказывало.
    expect(ticks).toBe(20 * 20);
    expect(m.ghost.state).not.toBe('dead');
    expect(retreats).toBe(0);
    expect(m.ghost.nestVisits).toBe(0);
  });
});

describe('HP призрака по сложности', () => {
  it('test_ghost_hp_mul_scales_hp_only', () => {
    expect(DIFF.easy.ghostHpMul).toBe(1.3);
    expect(DIFF.hard.ghostHpMul).toBe(1);
    expect(DIFF.nightmare.ghostHpMul).toBe(1);
    for (const difficulty of ['easy', 'hard', 'nightmare'] as const) {
      const m = new Match({ seed: 7, difficulty, flameUnlocked: true });
      const k = DIFF[difficulty];
      expect(ghostMaxHp(m, 1)).toBeCloseTo(B.ghost.hp * k.ghostMul * k.ghostHpMul, 6);
      expect(ghostMaxHp(m, 3)).toBeCloseTo(B.ghost.hp * B.ghost.hpMul ** 2 * k.ghostMul * k.ghostHpMul, 6);
      // Урон от ghostHpMul не зависит.
      expect(ghostDamage(m, 1)).toBeCloseTo(B.ghost.dmg * k.ghostMul, 6);
      expect(ghostDamage(m, 3)).toBeCloseTo(B.ghost.dmg * B.ghost.dmgMul ** 2 * k.ghostMul, 6);
    }
  });

  it('test_ghost_spawn_uses_difficulty_hp', () => {
    const easy = inRoomMatch({ difficulty: 'easy' });
    nightNow(easy);
    expect(easy.ghost.maxHp).toBeCloseTo(B.ghost.hp * DIFF.easy.ghostMul * 1.3, 6);
    expect(easy.ghost.hp).toBe(easy.ghost.maxHp);
    const hard = inRoomMatch({ difficulty: 'hard' });
    nightNow(hard);
    expect(hard.ghost.maxHp).toBeCloseTo(B.ghost.hp * DIFF.hard.ghostMul, 6);
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
