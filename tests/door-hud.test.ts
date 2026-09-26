import { describe, expect, it } from 'vitest';
import { DOOR_HUD_DANGER, DOOR_HUD_HURT, DOOR_HUD_LINGER, doorHudState, type DoorHudInput } from '../src/ui/doorHud';

const calm: DoorHudInput = { active: true, threat: false, frac: 1, now: 100, until: 0 };

describe('индикатор своей двери', () => {
  it('test_door_hud_full_door_no_attack_hidden', () => {
    expect(doorHudState(calm).visible).toBe(false);
  });

  it('test_door_hud_ghost_targets_player_shows', () => {
    // Призрак выбрал игрока (ещё идёт) — индикатор появляется, даже при целой двери.
    expect(doorHudState({ ...calm, threat: true })).toMatchObject({ visible: true, level: 'ok' });
  });

  it('test_door_hud_levels_by_hp', () => {
    expect(doorHudState({ ...calm, threat: true, frac: DOOR_HUD_HURT - 0.01 }).level).toBe('hurt');
    expect(doorHudState({ ...calm, threat: true, frac: DOOR_HUD_DANGER - 0.01 }).level).toBe('danger');
    expect(doorHudState({ ...calm, threat: true, frac: DOOR_HUD_HURT + 0.01 }).level).toBe('ok');
  });

  it('test_door_hud_danger_visible_without_ghost', () => {
    // Дверь почти сломана, призрак ушёл к соседям — индикатор остаётся: дверь надо чинить.
    expect(doorHudState({ ...calm, frac: DOOR_HUD_DANGER - 0.05 }).visible).toBe(true);
  });

  it('test_door_hud_hides_after_linger_when_safe', () => {
    // Arrange: призрак бил дверь (осталось 60%) и ушёл.
    const attacked = doorHudState({ ...calm, threat: true, frac: 0.6 });
    // Act + Assert: ещё немного виден, потом скрывается.
    const soon = doorHudState({ ...calm, frac: 0.6, now: calm.now + DOOR_HUD_LINGER - 0.5, until: attacked.until });
    const later = doorHudState({ ...calm, frac: 0.6, now: calm.now + DOOR_HUD_LINGER + 0.1, until: soon.until });
    expect(soon.visible).toBe(true);
    expect(later.visible).toBe(false);
  });

  it('test_door_hud_inactive_hidden', () => {
    // Не ночь, игрок пойман или дверь сломана — индикатора нет, и задержка не тянется в следующий раз.
    expect(doorHudState({ ...calm, active: false, threat: true, frac: 0.1 })).toMatchObject({ visible: false, until: 0 });
  });
});
