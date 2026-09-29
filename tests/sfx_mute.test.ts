import { describe, expect, it, vi } from 'vitest';

// Sfx трогает Phaser только в методах со звуком; для выключения звука хватает заглушки.
vi.mock('phaser', () => ({ default: {} }));
const { Sfx } = await import('../src/audio/sfx');

/** Поддельная игра: общий узел громкости как у WebAudioSoundManager и счётчики пауз. */
function fakeGame() {
  const gain = { value: 1, cancelScheduledValues: vi.fn() };
  const sound = { masterMuteNode: { gain }, pauseAll: vi.fn(), resumeAll: vi.fn(), locked: false };
  return { game: { sound } as never, gain, sound };
}

describe('Звук: кнопка игрока и пауза платформы (правила Яндекса 1.3, 4.7)', () => {
  it('test_sfx_mute_button_toggles_repeatedly', () => {
    // Регрессия: в Phaser 3.90 выключение срабатывало только в первый раз.
    const { game, gain } = fakeGame();
    const sfx = new Sfx(game);
    for (let i = 0; i < 3; i++) {
      sfx.setMuted(true);
      expect(gain.value).toBe(0);
      sfx.setMuted(false);
      expect(gain.value).toBe(1);
    }
  });

  it('test_sfx_platform_pause_silences_and_restores_player_choice', () => {
    const { game, gain, sound } = fakeGame();
    const sfx = new Sfx(game);
    sfx.suspend(true);
    expect(gain.value).toBe(0);
    expect(sound.pauseAll).toHaveBeenCalledTimes(1);
    // Кнопка звука во время рекламы не включает звук, но выбор запоминается.
    sfx.setMuted(false);
    expect(gain.value).toBe(0);
    sfx.suspend(false);
    expect(gain.value).toBe(1);
    expect(sound.resumeAll).toHaveBeenCalledTimes(1);
  });

  it('test_sfx_player_mute_survives_platform_resume', () => {
    // Игрок выключил звук сам — конец рекламы его не включает.
    const { game, gain } = fakeGame();
    const sfx = new Sfx(game);
    sfx.setMuted(true);
    sfx.suspend(true);
    sfx.suspend(false);
    expect(gain.value).toBe(0);
    expect(sfx.muted).toBe(true);
  });
});
