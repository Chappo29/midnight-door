import { describe, expect, it } from 'vitest';
import { B, sofaIncome } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import { finishTask, inRoomMatch, nightNow } from './helpers';

/** Сейф покупают в матче (меню пустого пола), как в Ghost at the Door: 1 на комнату, без уровней, даёт конфеты. */
describe('сейф — постройка', () => {
  it('test_safe_not_on_the_map_anymore', () => {
    for (const seed of [1, 2, 3, 7, 11, 42]) {
      const m = new Match({ seed, difficulty: 'easy', flameUnlocked: true });
      expect(m.rooms.some((r) => r.items.some((i) => i.kind === 'safe'))).toBe(false);
    }
  });

  it('test_safe_hidden_in_first_matches_shown_after_trap_unlocked', () => {
    const first = inRoomMatch({ lockedKinds: ['pumpkin', 'trap', 'workbench', 'fridge'] });
    expect(first.floorMenuKinds(first.playerRoom!).map((k) => k.kind)).not.toContain('safe');
    const later = inRoomMatch({ lockedKinds: ['workbench', 'fridge'] });
    expect(later.floorMenuKinds(later.playerRoom!).map((k) => k.kind)).toContain('safe');
  });

  it('test_safe_needs_door_level_2_then_gives_income_once_per_room', () => {
    const m = inRoomMatch();
    nightNow(m);
    const r = m.playerRoom!;
    const cell = m.placeableCells(r, 'cannon')[0];
    r.candy = 1000;
    // Дверь ур. 1: сейф заперт дверью.
    expect(m.buildLocked(r, 'safe')).toBe(B.items.safeDoor);
    expect(m.command(m.playerId, { type: 'build', kind: 'safe', ...cell })).toMatch(/дверь/i);
    // Дверь ур. 2 — можно; цена — конфеты.
    r.door.level = 2;
    const before = r.candy;
    expect(m.command(m.playerId, { type: 'build', kind: 'safe', ...cell })).toBeNull();
    finishTask(m);
    expect(r.buildings.filter((b) => b.kind === 'safe')).toHaveLength(1);
    // Пока герой ставит, конфеты капают: списано цена минус доход за время работы.
    expect(before - r.candy).toBeGreaterThan(B.items.safeCost - 10);
    expect(m.incomeOf(r)).toBeCloseTo(sofaIncome(r.sofa.level, m.opts.difficulty) + B.items.safe, 5);
    // Второй сейф в ту же комнату нельзя; улучшения у сейфа нет; продаётся.
    const spot = m.placeableCells(r, 'cannon')[0];
    expect(m.canPlace(r, spot.x, spot.y, 'safe')).toBe('Больше нельзя');
    const safe = r.buildings.find((b) => b.kind === 'safe')!;
    expect(m.upgradeCost(safe, r)).toBeNull();
    expect(m.sellValue(safe)).toBeGreaterThan(0);
  });
});
