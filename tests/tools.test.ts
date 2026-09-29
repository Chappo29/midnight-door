import { describe, expect, it } from 'vitest';
import { B, TICK, sofaIncome, toolPrice } from '../src/sim/balance';
import type { Difficulty, Room } from '../src/sim/types';
import { inRoomMatch, mkBuilding, nightNow, pinGhostAtDoor, quietFloor, stepSec } from './helpers';
import type { Match } from '../src/sim/match';

/** Инструменты сейфа: чеснок, запасной ключ, супер-конфеты — купить впрок, применить одним нажатием. */
function setup(difficulty: Difficulty = 'easy', sofa = 3): { m: Match; r: Room } {
  const m = inRoomMatch({ difficulty });
  quietFloor(m);
  nightNow(m);
  const r = m.playerRoom!;
  r.sofa.level = sofa;
  r.door.level = 3;
  r.candy = 5000;
  const cell = m.placeableCells(r, 'cannon');
  r.buildings.push(mkBuilding('safe', cell[0].x, cell[0].y), mkBuilding('cannon', cell[1].x, cell[1].y), mkBuilding('cannon', cell[2].x, cell[2].y));
  return { m, r };
}
/** Призрак бьёт дверь комнаты уже по-настоящему (как после подхода к двери: осада идёт). */
function siege(m: Match, r: Room): void {
  pinGhostAtDoor(m, r);
  const g = m.ghost;
  g.siegeRoom = r.id;
  g.siegeStart = m.nightTime;
  g.siegeHits = 0;
  g.siegeDmg = 0;
}
const buy = (m: Match, t: 'garlic' | 'key' | 'charge') => m.command(m.playerId, { type: 'tool', tool: t, op: 'buy' });
const use = (m: Match, t: 'garlic' | 'key' | 'charge') => m.command(m.playerId, { type: 'tool', tool: t, op: 'use' });

describe('цены инструментов', () => {
  it('test_tool_prices_easy_flat_and_garlic_rises', () => {
    expect(toolPrice('garlic', 'easy', 3, 0)).toBe(60);
    expect(toolPrice('garlic', 'easy', 3, 1)).toBe(90);
    expect(toolPrice('key', 'easy', 3, 0)).toBe(35);
    expect(toolPrice('charge', 'easy', 5, 0)).toBe(35);
  });

  it('test_tool_prices_hard_follow_sofa_income_within_bounds', () => {
    expect(toolPrice('garlic', 'hard', 4, 0)).toBe(100);
    expect(toolPrice('garlic', 'nightmare', 4, 1)).toBe(150);
    const p4 = toolPrice('key', 'hard', 4, 0);
    expect(p4).toBe(Math.round((6 * sofaIncome(4, 'hard')) / 5) * 5);
    expect(p4).toBeGreaterThanOrEqual(B.tools.minPrice);
    expect(toolPrice('key', 'hard', 8, 0)).toBe(B.tools.maxPrice);
    expect(toolPrice('key', 'hard', 1, 0)).toBe(B.tools.minPrice);
  });
});

describe('покупка', () => {
  it('test_tool_buy_needs_safe_and_sofa_level_and_pays_at_purchase', () => {
    const { m, r } = setup('easy', 2);
    expect(buy(m, 'key')).toMatch(/диван/i);
    r.sofa.level = 3;
    const before = r.candy;
    expect(buy(m, 'key')).toBeNull();
    expect(before - r.candy).toBe(35);
    expect(r.tools!.stock.key).toBe(true);
    expect(buy(m, 'key')).toBe('Уже в сейфе');
    // Без сейфа нельзя.
    r.buildings = r.buildings.filter((b) => b.kind !== 'safe');
    expect(buy(m, 'garlic')).toBe('Нужен сейф');
  });

  it('test_tool_hard_needs_sofa_4', () => {
    const { m, r } = setup('hard', 3);
    expect(buy(m, 'garlic')).toMatch(/диван до ур\. 4/);
    r.sofa.level = 4;
    expect(buy(m, 'garlic')).toBeNull();
  });

  it('test_tool_buy_limited_per_match_and_price_rises', () => {
    const { m, r } = setup('easy');
    expect(buy(m, 'garlic')).toBeNull();
    r.tools!.stock.garlic = false; // применили
    const before = r.candy;
    expect(buy(m, 'garlic')).toBeNull();
    expect(before - r.candy).toBe(90);
    r.tools!.stock.garlic = false;
    expect(buy(m, 'garlic')).toBe('Больше нельзя за матч');
  });

  it('test_tool_not_enough_candy_keeps_candy', () => {
    const { m, r } = setup('easy');
    r.candy = 10;
    expect(buy(m, 'key')).not.toBeNull();
    expect(r.candy).toBe(10);
    expect(r.tools?.stock.key ?? false).toBe(false);
  });

  it('test_tools_only_for_player_and_not_in_tutorial', () => {
    const { m } = setup('easy');
    const npc = m.chars.find((c) => !c.isPlayer)!;
    expect(m.command(npc.id, { type: 'tool', tool: 'key', op: 'buy' })).not.toBeNull();
    const t = inRoomMatch({ difficulty: 'easy', tutorial: true });
    expect(t.command(t.playerId, { type: 'tool', tool: 'key', op: 'buy' })).not.toBeNull();
  });
});

describe('чеснок', () => {
  it('test_garlic_scares_ghost_away_and_protects_room', () => {
    const { m, r } = setup('easy');
    r.candy = 5000;
    buy(m, 'garlic');
    expect(use(m, 'garlic')).toMatch(/не бьёт/); // призрака ещё нет
    siege(m, r);
    stepSec(m, 2.5); // пара ударов
    expect(m.ghost.siegeHits).toBeGreaterThanOrEqual(1);
    expect(use(m, 'garlic')).toBeNull();
    const g = m.ghost;
    expect(g.state).not.toBe('attacking');
    expect(g.targetRoom).not.toBe(r.id);
    expect(g.avoidRoom).toBe(r.id);
    expect(g.avoidTimer).toBeGreaterThan(B.tools.scareSecs - 1);
    expect(r.tools!.stock.garlic).toBe(false);
    expect(m.events.some((e) => e.type === 'siegeEnd' && e.reason === 'scared')).toBe(true);
    // 20 с в комнату не возвращается.
    for (let i = 0; i < Math.floor(15 / TICK); i++) {
      m.step();
      expect(m.ghost.targetRoom).not.toBe(r.id);
    }
  });

  it('test_garlic_blocked_when_door_broken_or_last_neighbor', () => {
    const { m, r } = setup('easy');
    buy(m, 'garlic');
    siege(m, r);
    stepSec(m, 2.5);
    r.door.broken = true;
    expect(use(m, 'garlic')).toBe('Дверь сломана');
    r.door.broken = false;
    for (const q of m.rooms) if (q.id !== r.id) q.eliminated = true;
    expect(use(m, 'garlic')).toBe('Ему некуда уйти');
    expect(r.tools!.stock.garlic).toBe(true); // не потратился
  });
});

describe('запасной ключ', () => {
  it('test_spare_key_repairs_instantly_without_touching_normal_key_and_has_cooldown', () => {
    const { m, r } = setup('easy');
    buy(m, 'key');
    expect(use(m, 'key')).toBe('Дверь целая');
    r.door.hp = r.door.maxHp * 0.3;
    r.door.repairCd = 12;
    expect(use(m, 'key')).toBeNull();
    expect(r.door.hp).toBeCloseTo(r.door.maxHp * (0.3 + B.repair.amount), 5);
    expect(r.door.repairCd).toBe(12); // обычный ключ не тронут
    // Второй сразу нельзя: откат.
    buy(m, 'key');
    expect(use(m, 'key')).toMatch(/Готово через/);
    stepSec(m, B.tools.cooldown.key + 1);
    r.door.hp = r.door.maxHp * 0.2;
    expect(use(m, 'key')).toBeNull();
  });

  it('test_spare_key_not_when_door_broken', () => {
    const { m, r } = setup('easy');
    buy(m, 'key');
    r.door.broken = true;
    expect(use(m, 'key')).toBe('Дверь сломана');
  });
});

describe('супер-конфеты', () => {
  it('test_charge_boosts_all_cannons_only_at_door_and_not_twice', () => {
    const { m, r } = setup('easy');
    buy(m, 'charge');
    expect(use(m, 'charge')).toBe('Призрака у двери нет');
    pinGhostAtDoor(m, r);
    stepSec(m, 1);
    expect(use(m, 'charge')).toBeNull();
    const cannons = r.buildings.filter((b) => b.kind === 'cannon');
    expect(cannons.length).toBe(2);
    for (const b of cannons) {
      expect(b.boost).toBeGreaterThan(B.spirit.sparkTime - 1);
      expect(b.boostMul).toBe(B.tools.chargeMul);
    }
    buy(m, 'charge');
    expect(use(m, 'charge')).toBe('Уже горят');
  });

  it('test_charge_needs_cannons', () => {
    const { m, r } = setup('easy');
    r.buildings = r.buildings.filter((b) => b.kind !== 'cannon');
    buy(m, 'charge');
    pinGhostAtDoor(m, r);
    expect(use(m, 'charge')).toBe('Нет пушек');
  });
});

describe('сейф продан', () => {
  it('test_tools_not_usable_without_safe_but_stock_kept_until_rebuilt', () => {
    const { m, r } = setup('easy');
    buy(m, 'key');
    r.door.hp = r.door.maxHp * 0.3;
    const safe = r.buildings.find((b) => b.kind === 'safe')!;
    r.buildings = r.buildings.filter((b) => b !== safe);
    expect(use(m, 'key')).toBe('Нужен сейф');
    expect(r.tools!.stock.key).toBe(true);
    r.buildings.push(safe);
    expect(use(m, 'key')).toBeNull();
  });

  it('test_spark_after_charge_uses_spark_multiplier_again', () => {
    const { m, r } = setup('easy');
    buy(m, 'charge');
    siege(m, r);
    stepSec(m, 1);
    use(m, 'charge');
    const cannon = r.buildings.find((b) => b.kind === 'cannon')!;
    stepSec(m, B.spirit.sparkTime + 1);
    expect(cannon.boost).toBe(0);
    expect(cannon.boostMul).toBeUndefined();
  });
});
