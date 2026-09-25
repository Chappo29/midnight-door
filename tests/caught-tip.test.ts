import { describe, expect, it } from 'vitest';
import { caughtTip } from '../src/ui/caughtTip';

describe('совет на карточке поимки', () => {
  const base = { cannons: 2, doorLevel: 4, missedRepair: false, couldUpgradeDoor: false };

  it('test_caught_tip_no_cannon_says_build_cannon', () => {
    expect(caughtTip({ ...base, cannons: 0, missedRepair: true, doorLevel: 1 }).kind).toBe('cannon');
  });

  it('test_caught_tip_missed_repair_says_use_key', () => {
    expect(caughtTip({ ...base, missedRepair: true, doorLevel: 1 }).kind).toBe('repair');
  });

  it('test_caught_tip_weak_or_affordable_door_says_upgrade', () => {
    expect(caughtTip({ ...base, doorLevel: 1 }).kind).toBe('door');
    expect(caughtTip({ ...base, couldUpgradeDoor: true }).kind).toBe('door');
  });

  it('test_caught_tip_did_everything_is_not_blamed', () => {
    // Всё сделал правильно — без совета «ты ошибся».
    const t = caughtTip(base);
    expect(t.kind).toBe('strong');
    expect(t.text).not.toMatch(/не |неправ|ошиб/i);
  });

  it('test_caught_tip_texts_are_short_without_numbers', () => {
    for (const s of [{ ...base, cannons: 0 }, { ...base, missedRepair: true }, { ...base, doorLevel: 1 }, base]) {
      const t = caughtTip(s).text;
      expect(t.split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(t).not.toMatch(/\d/);
    }
  });
});
