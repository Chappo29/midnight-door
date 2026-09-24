import { describe, expect, it } from 'vitest';
import { B, TICK } from '../src/sim/balance';
import { ghostDamage, ghostXpNeed } from '../src/sim/ghost';
import { Match } from '../src/sim/match';
import type { SimEvent } from '../src/sim/types';
import { TutorialDirector } from '../src/tutorial/director';
import { inRoomMatch, nightNow, pinGhostAtDoor, stepSec } from './helpers';

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
