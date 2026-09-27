import { describe, expect, it } from 'vitest';
import { HOLDOVER_MS, HOLDOVER_PX, TAP_SLOP_TOUCH_PX, isDrag, isEchoAfterScreenChange, isHoldover, menuTopAwayFromFinger, staleTouchPointers } from '../src/ui/inputGuard';

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

  it('test_input_guard_second_tap_into_new_screen_is_echo', () => {
    // «Выйти в меню» в t=0, меню открылось в t=5, второй тап того же пальца через 0,6 с — не «Кошмар».
    const last = { t: 0, x: 200, y: 400 };
    expect(isEchoAfterScreenChange(600, last, 5, { x: 205, y: 402 })).toBe(true);
  });

  it('test_input_guard_second_tap_on_same_screen_is_not_echo', () => {
    // Экран не менялся (например, две кнопки одного окна) — второй тап настоящий.
    const last = { t: 100, x: 200, y: 400 };
    expect(isEchoAfterScreenChange(600, last, 50, { x: 205, y: 402 })).toBe(false);
  });

  it('test_input_guard_tap_elsewhere_in_new_screen_is_not_echo', () => {
    const last = { t: 0, x: 200, y: 400 };
    expect(isEchoAfterScreenChange(300, last, 5, { x: 200, y: 520 })).toBe(false);
  });

  it('test_input_guard_smudged_child_tap_is_still_a_tap', () => {
    // Палец ребёнка уезжает на 14–20 px — это тап, а не перетаскивание (регрессия R2: 14 px терялся).
    for (const d of [6, 14, 20, TAP_SLOP_TOUCH_PX]) expect(isDrag(d, true), `${d} px`).toBe(false);
    expect(isDrag(40, true)).toBe(true);
    expect(isDrag(14, false)).toBe(true);
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

describe('зависшие касания (Galaxy S24, «не могу двигаться и кликать»)', () => {
  const pointer = (id: number, active: boolean, identifier: number) => ({ id, active, identifier });

  it('test_input_guard_lost_touchend_pointer_is_stale', () => {
    // Arrange: указатель 1 «прижат» пальцем 5, но на экране сейчас только новый палец 9.
    const pointers = [pointer(0, true, 0), pointer(1, true, 5), pointer(2, false, 0)];
    // Act + Assert: зависший — только указатель 1; мышь и свободный не трогаем.
    expect(staleTouchPointers(pointers, [9]).map((q) => q.id)).toEqual([1]);
  });

  it('test_input_guard_real_second_finger_is_not_stale', () => {
    // Настоящий щипок: оба пальца на экране — ничего не сбрасываем.
    const pointers = [pointer(0, true, 0), pointer(1, true, 5), pointer(2, true, 6)];
    expect(staleTouchPointers(pointers, [5, 6, 7])).toEqual([]);
  });
});
