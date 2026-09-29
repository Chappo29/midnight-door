import { describe, expect, it } from 'vitest';
import { B, sofaIncome, sofaMaxLevel, sofaUpCost } from '../src/sim/balance';

/** Поздний хвост дохода дивана срезан: ранний рост прежний, дальше линейно; у лёгкой диван кончается на 6-м уровне. */
describe('доход дивана: хвост', () => {
  it('test_sofa_hard_income_table_early_doubles_late_linear', () => {
    const inc = [1, 2, 3, 4, 5, 6, 7, 8].map((l) => sofaIncome(l, 'hard'));
    expect(inc.slice(0, 4).map((v) => +v.toFixed(2))).toEqual([1, 2.2, 4.84, 10.65]);
    expect(inc.slice(4)).toEqual([20, 30, 40, 50]);
    expect(sofaIncome(8, 'nightmare')).toBe(50);
  });

  it('test_sofa_easy_formula_unchanged_but_capped_at_level_6', () => {
    expect(sofaIncome(1, 'easy')).toBe(2);
    expect(sofaIncome(4, 'easy')).toBeCloseTo(2 * 1.45 ** 3, 5);
    expect(sofaMaxLevel('easy')).toBe(6);
    expect(sofaUpCost(5, 'easy')).not.toBeNull();
    expect(sofaUpCost(6, 'easy')).toBeNull();
  });

  it('test_sofa_hard_reaches_level_8_and_then_maxes', () => {
    expect(sofaMaxLevel('hard')).toBe(B.sofa.max);
    expect(sofaUpCost(7, 'hard')).not.toBeNull();
    expect(sofaUpCost(8, 'hard')).toBeNull();
  });
});
