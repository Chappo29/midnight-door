import { describe, expect, it } from 'vitest';
import { HOLDOVER_MS, HOLDOVER_PX, isHoldover, menuTopAwayFromFinger } from '../src/ui/inputGuard';

describe('защита от повторных тапов (GAME_AUDIT.md, B5)', () => {
  const anchor = { x: 200, y: 400 };

  it('test_input_guard_second_tap_of_child_double_tap_is_holdover', () => {
    // Двойной тап ребёнка 3–6 лет — ~0,85 с между касаниями, палец почти на том же месте.
    expect(isHoldover(850, 0, anchor, { x: 210, y: 395 })).toBe(true);
  });

  it('test_input_guard_deliberate_tap_elsewhere_is_not_holdover', () => {
    expect(isHoldover(300, 0, anchor, { x: 200, y: 400 + HOLDOVER_PX + 1 })).toBe(false);
  });

  it('test_input_guard_late_tap_on_same_spot_is_not_holdover', () => {
    expect(isHoldover(HOLDOVER_MS + 1, 0, anchor, anchor)).toBe(false);
  });

  it('test_input_guard_menu_on_narrow_screen_never_covers_finger', () => {
    // Портрет 390×844: меню 300 px высотой, тап в разных местах экрана.
    const h = 300;
    const vh = 844;
    for (const y of [60, 200, 422, 600, 800]) {
      const top = menuTopAwayFromFinger(y, h, vh, 18);
      const covers = y >= top && y <= top + h;
      expect(covers, `тап на y=${y}, меню ${top}…${top + h}`).toBe(false);
      expect(top).toBeGreaterThanOrEqual(18);
      expect(top + h).toBeLessThanOrEqual(vh - 18);
    }
  });
});
