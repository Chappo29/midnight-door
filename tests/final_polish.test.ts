/**
 * Final polish перед живым тестом (CORE_LOOP_UX_PASS.md, «Final polish»): итоги на низком экране, «×2 монеты»,
 * ранняя польза пламени, сигнал готового ключа, спокойные сообщения ожидания.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// hud.ts тянет спрайты и иконки через Vite; в узле хватает пустых заглушек.
vi.mock('../src/view/sprites', () => ({ SPRITES: {} }));

const { resultActionsHtml, showDoubledReward, repairReady, REPAIR_READY } = await import('../src/ui/hud');
const { B, cannonUpCost } = await import('../src/sim/balance');
const { inRoomMatch } = await import('./helpers');

const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('итоги на низком экране', () => {
  it('test_result_actions_primary_buttons_come_before_ad', () => {
    // Arrange + Act
    const html = resultActionsHtml(true);
    // Assert: «Ещё раз» и «Меню» раньше рекламы, реклама — не крупная кнопка.
    const again = html.indexOf('id="again"');
    const menu = html.indexOf('id="tomenu"');
    const ad = html.indexOf('id="double"');
    expect(again).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(again);
    expect(ad).toBeGreaterThan(menu);
    expect(html.slice(html.lastIndexOf('<button', ad), ad)).not.toMatch(/btn-big/);
  });

  it('test_result_actions_without_ad_keep_both_buttons', () => {
    const html = resultActionsHtml(false);
    expect(html).toContain('id="again"');
    expect(html).toContain('id="tomenu"');
    expect(html).not.toContain('id="double"');
  });

  it('test_low_height_css_puts_result_buttons_in_one_row_last_in_file', () => {
    // Правила низкого экрана для итогов — последние в файле (иначе старые блоки их перебивают) и ставят кнопки в ряд.
    const lows = [...css.matchAll(/@media \(max-height: 500px\) \{([\s\S]*?)\n\}/g)];
    const last = lows.filter((mm) => mm[1].includes('.result-actions')).at(-1);
    expect(last).toBeDefined();
    expect(last![1]).toMatch(/\.result-actions \{[^}]*flex-direction: row/);
    expect(last![1]).toMatch(/\.result-actions \.diffs \{[^}]*flex-wrap: nowrap/);
    const lastResultRule = Math.max(...[...css.matchAll(/\.result-card \.btn-big/g)].map((mm) => mm.index!));
    expect(last!.index! + last![0].length).toBeGreaterThan(lastResultRule);
    // Совсем низко (≤ 400 px) маскот убран.
    expect(css).toMatch(/@media \(max-height: 400px\) \{\s*\.result-card \.result-mascot \{\s*display: none/);
  });
});

describe('«×2 монеты»', () => {
  function fakeReward() {
    const classes = new Set<string>();
    const total = {
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
      html: '',
      querySelector: (sel: string) => (sel === '.reward-x2' && total.html.includes('reward-x2') ? {} : null),
      insertAdjacentHTML: (_p: InsertPosition, h: string) => (total.html += h),
    };
    const num = { textContent: '55' as string | null, closest: () => total };
    const bank = { textContent: '95' as string | null };
    return { num, total, bank, classes };
  }

  it('test_doubled_reward_updates_number_immediately', () => {
    // Arrange: на итогах +55, в магазине 95.
    const { num, bank, classes, total } = fakeReward();
    // Act: досмотрел рекламу — удвоение 110, всего 150.
    showDoubledReward(num, 110, bank, 150);
    // Assert: сразу новое число (без счёта с нуля), всплеск, метка «×2», новая сумма магазина.
    expect(num.textContent).toBe('110');
    expect(bank.textContent).toBe('150');
    expect(classes.has('doubled')).toBe(true);
    expect(total.html).toContain('×2');
  });

  it('test_doubled_reward_badge_added_once', () => {
    const { num, bank, total } = fakeReward();
    showDoubledReward(num, 110, bank, 150);
    showDoubledReward(num, 110, bank, 150);
    expect(total.html.match(/reward-x2/g)).toHaveLength(1);
  });
});

describe('ранняя польза пламени (только игроку)', () => {
  function room(flame: number, locked: boolean) {
    const m = inRoomMatch(locked ? { lockedKinds: ['pumpkin', 'trap', 'workbench', 'fridge'] } : { lockedKinds: ['trap', 'workbench', 'fridge'] });
    const r = m.playerRoom!;
    r.flame = flame;
    return { m, r };
  }

  it('test_early_flame_cannon_l2_discount_when_flame_available', () => {
    // Arrange: матч 2, есть пламя.
    const { m, r } = room(10, false);
    // Act
    const cost = m.upgradeCost({ kind: 'cannon', level: 1 }, r)!;
    // Assert: часть конфет заменена пламенем по курсу, итог «в конфетах» тот же.
    expect(cost.flame).toBe(B.cannon.earlyFlame);
    expect(cost.candy).toBe(cannonUpCost(1)!.candy - B.cannon.earlyFlame * B.flameToCandy);
    expect(cost.candy + cost.flame * B.flameToCandy).toBe(cannonUpCost(1)!.candy);
  });

  it('test_early_flame_is_optional_without_flame_no_dead_end', () => {
    // Тыква открыта, но не посажена: пламени нет — прежняя цена в конфетах, а не «не хватает пламени».
    const { m, r } = room(0, false);
    expect(m.upgradeCost({ kind: 'cannon', level: 1 }, r)).toEqual(cannonUpCost(1));
  });

  it('test_early_flame_first_match_price_unchanged', () => {
    const { m, r } = room(50, true);
    expect(m.upgradeCost({ kind: 'cannon', level: 1 }, r)).toEqual(cannonUpCost(1));
  });

  it('test_early_flame_neighbors_pay_as_before', () => {
    const { m } = room(0, false);
    const n = m.rooms.find((q) => q.ownerId !== null && q.ownerId !== m.playerId)!;
    n.flame = 100;
    expect(m.upgradeCost({ kind: 'cannon', level: 1 }, n)).toEqual(cannonUpCost(1));
    // Дальше по цепочке ничего не меняется и у игрока.
    const { m: m2, r } = room(100, false);
    expect(m2.upgradeCost({ kind: 'cannon', level: 2 }, r)).toEqual(cannonUpCost(2));
  });

  it('test_early_flame_useful_soon_after_pumpkin', () => {
    // Тыква ур. 1 набирает пламя на раннюю скидку меньше чем за 10 с — польза видна в первую же минуту.
    expect(B.cannon.earlyFlame / B.pumpkin.rate).toBeLessThan(10);
  });
});

describe('ключ ремонта зовёт, когда нужен', () => {
  const base = { night: true, broken: false, busy: false, cd: 0, frac: 0.45 };

  it('test_repair_ready_when_door_below_half_and_key_ready', () => {
    expect(repairReady(base)).toBe(true);
  });

  it('test_repair_not_ready_on_cooldown_healthy_door_busy_or_broken', () => {
    expect(repairReady({ ...base, cd: 5 })).toBe(false);
    expect(repairReady({ ...base, frac: REPAIR_READY })).toBe(false);
    expect(repairReady({ ...base, busy: true })).toBe(false);
    expect(repairReady({ ...base, broken: true })).toBe(false);
    expect(repairReady({ ...base, night: false })).toBe(false);
  });

  it('test_repair_ready_css_pulses_and_stops_on_cooldown', () => {
    expect(css).toMatch(/#repair\.ready:not\(\.cd\) \{\s*animation: repair-ready/);
  });
});
