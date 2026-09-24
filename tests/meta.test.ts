import { describe, expect, it } from 'vitest';
import { B, doorMaxHp } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import {
  BOOSTER_MAX,
  DAILY,
  HEROES,
  buyBooster,
  buyHero,
  buySkin,
  claimDaily,
  dailyAvailable,
  emptyMeta,
  matchReward,
  normalizeMeta,
  selectHero,
  takeBoosters,
} from '../src/meta/economy';

describe('монеты и магазин', () => {
  it('test_meta_win_pays_more_than_loss', () => {
    const win = matchReward(true, 'easy', 8 * 60, 5);
    const lose = matchReward(false, 'easy', 8 * 60, 5);
    expect(win.coins).toBeGreaterThan(lose.coins);
    expect(lose.coins).toBeGreaterThan(0);
    expect(win.parts.reduce((s, p) => s + p.coins, 0)).toBe(win.coins);
  });

  it('test_reward_team_win_half_base_plus_neighbours', () => {
    const solo = matchReward(true, 'hard', 600, 3);
    const team = matchReward(true, 'hard', 600, 3, true);
    const soloBase = solo.parts.find((p) => p.label === 'победа')!.coins;
    expect(team.parts).toEqual([
      { label: 'командная победа', coins: Math.round(soloBase * 0.5) },
      { label: 'соседи', coins: 15 },
    ]);
    expect(team.coins).toBe(Math.round(soloBase * 0.5) + 15);
    expect(team.coins).toBeLessThan(solo.coins);
    expect(team.coins).toBeGreaterThan(matchReward(false, 'hard', 600, 3).coins);
  });

  it('test_meta_harder_difficulty_pays_more', () => {
    expect(matchReward(true, 'nightmare', 600, 3).coins).toBeGreaterThan(matchReward(true, 'hard', 600, 3).coins);
    expect(matchReward(true, 'hard', 600, 3).coins).toBeGreaterThan(matchReward(true, 'easy', 600, 3).coins);
  });

  it('test_meta_buy_hero_needs_coins_and_selects_it', () => {
    const m = emptyMeta();
    const mia = HEROES[1];
    expect(buyHero(m, mia.look)).toBe('Не хватает монет');
    m.coins = mia.price;
    expect(buyHero(m, mia.look)).toBeNull();
    expect(m.coins).toBe(0);
    expect(m.hero).toBe(mia.look);
    expect(buyHero(m, mia.look)).toBe('Уже есть');
    expect(selectHero(m, 0)).toBe(true);
    expect(selectHero(m, 5)).toBe(false);
  });

  it('test_meta_unready_skin_cannot_be_bought', () => {
    const m = emptyMeta();
    m.coins = 9999;
    const catalog = { door: [{ id: 'ice', name: 'Ледяная', price: 350, ready: false }], cannon: [] };
    expect(buySkin(m, 'door', 'ice', catalog)).toBe('Скоро');
    expect(m.coins).toBe(9999);
    expect(m.skins.door).not.toContain('ice');
  });

  it('test_meta_ready_skin_bought_and_selected', () => {
    const m = emptyMeta();
    const catalog = { door: [{ id: 'ice', name: 'Ледяная', price: 350, ready: true }], cannon: [] };
    expect(buySkin(m, 'door', 'ice', catalog)).toBe('Не хватает монет');
    m.coins = 350;
    expect(buySkin(m, 'door', 'ice', catalog)).toBeNull();
    expect(m.coins).toBe(0);
    expect(m.skin.door).toBe('ice');
  });

  it('test_meta_boosters_capped_and_consumed_once', () => {
    const m = emptyMeta();
    m.coins = 9999;
    for (let i = 0; i < BOOSTER_MAX; i++) expect(buyBooster(m, 'candy')).toBeNull();
    expect(buyBooster(m, 'candy')).toBe('Больше не взять');
    const b = takeBoosters(m);
    expect(b.candy).toBe(100);
    expect(b.doorLevel).toBe(1);
    expect(m.boosters.candy).toBe(BOOSTER_MAX - 1);
  });

  it('test_meta_corrupt_save_is_repaired', () => {
    const m = normalizeMeta({
      coins: NaN,
      heroes: 'x',
      hero: 9,
      skins: { door: ['classic'], cannon: ['classic'] },
      skin: { door: 'ice', cannon: 'nope' },
      boosters: { candy: -5, door: 99, wrench: NaN },
      daily: { last: 7, step: -1 },
    } as never);
    expect(m.coins).toBe(0);
    expect(m.heroes).toEqual([0]);
    expect(m.hero).toBe(0);
    expect(m.skin).toEqual({ door: 'classic', cannon: 'classic' });
    expect(m.boosters).toEqual({ candy: 0, door: BOOSTER_MAX, wrench: 0 });
    expect(m.daily).toEqual({ last: '', step: 0 });
    expect(buyHero(m, HEROES[1].look)).toBe('Не хватает монет');
  });

  it('test_meta_old_save_gets_defaults', () => {
    const m = normalizeMeta({ coins: 55 } as never);
    expect(m.coins).toBe(55);
    expect(m.heroes).toEqual([0]);
    expect(m.boosters.door).toBe(0);
  });
});

describe('ежедневный подарок', () => {
  it('test_daily_once_per_day_and_cycles_week', () => {
    const m = emptyMeta();
    expect(claimDaily(m, '2026-09-24')).toBe(DAILY[0]);
    expect(dailyAvailable(m, '2026-09-24')).toBe(false);
    expect(claimDaily(m, '2026-09-24')).toBe(0);
    // Пропуск дней серию не сбрасывает.
    expect(claimDaily(m, '2026-09-30')).toBe(DAILY[1]);
    for (let d = 1; d <= 5; d++) claimDaily(m, `2026-10-0${d}`);
    expect(m.daily.step).toBe(0);
    expect(m.coins).toBe(DAILY.reduce((s, c) => s + c, 0));
  });
});

describe('усилители и герой в матче', () => {
  function playerRoom(opts: ConstructorParameters<typeof Match>[0]) {
    const m = new Match(opts);
    m.command(0, { type: 'pickRoom', roomId: 2 });
    return m;
  }

  it('test_match_boosters_apply_to_player_room_only', () => {
    const m = playerRoom({ seed: 7, difficulty: 'easy', flameUnlocked: true, boosters: { candy: 100, doorLevel: 2, repairMul: 0.5 } });
    const r = m.rooms[2];
    expect(r.candy).toBe(B.startCandy + 100);
    expect(r.door.level).toBe(2);
    expect(r.door.hp).toBe(doorMaxHp(2));
    while (m.phase === 'pick') m.step();
    const npcRoom = m.rooms.find((q) => q.ownerId !== null && q.ownerId !== 0)!;
    expect(npcRoom.door.level).toBe(1);
  });

  it('test_match_hero_look_goes_to_player_and_names_neighbors', () => {
    const m = new Match({ seed: 7, difficulty: 'easy', flameUnlocked: true, hero: 3 });
    expect(m.player.look).toBe(3);
    const looks = m.chars.map((c) => c.look).sort();
    expect(looks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(m.chars.find((c) => c.look === 0)!.name).toBe('Сёма');
  });
});
