import { describe, expect, it } from 'vitest';
import { skinOf } from '../src/view/sprites';

describe('спрайты скинов грузятся только выбранные', () => {
  it('test_sprites_skin_keys_are_recognized', () => {
    expect(skinOf('door_ginger_l3')).toEqual({ slot: 'door', id: 'ginger' });
    expect(skinOf('cannon_base_ice_l2')).toEqual({ slot: 'cannon', id: 'ice' });
    expect(skinOf('cannon_barrel_ginger_l6')).toEqual({ slot: 'cannon', id: 'ginger' });
  });

  it('test_sprites_regular_keys_are_not_skins', () => {
    // Обычные двери и пушки нужны всегда — их нельзя принять за скин и не загрузить.
    for (const key of ['door_l1', 'door_l8', 'door_broken', 'cannon_base', 'cannon_base_l2', 'cannon_barrel', 'cannon_barrel_l6', 'pumpkin']) {
      expect(skinOf(key)).toBeNull();
    }
  });
});
