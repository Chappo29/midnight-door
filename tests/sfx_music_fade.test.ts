import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Регрессия FINAL_QA_REPORT.md QA-10: трек плейлиста доиграл, пока музыка затухала (конец матча, выход в меню) —
 * Phaser уничтожал звук, setVolume в таймере затухания бросал, таймер не останавливался, и ошибка сыпалась
 * каждые 30 мс до перезагрузки.
 */
vi.mock('phaser', () => ({ default: { Sound: { Events: { COMPLETE: 'complete', UNLOCKED: 'unlocked' } } } }));
const { Sfx } = await import('../src/audio/sfx');

/** Звук как WebAudioSound в Phaser 3.90: после destroy() узел громкости null — setVolume бросает. */
function fakeSound(key: string) {
  const handlers: Record<string, () => void> = {};
  return {
    key,
    pendingRemove: false,
    volume: 1,
    once: (ev: string, fn: () => void) => void (handlers[ev] = fn),
    play: vi.fn(),
    setVolume(v: number) {
      if (this.pendingRemove) throw new TypeError("Cannot set properties of null (setting 'volume')");
      this.volume = v;
    },
    destroy() {
      this.pendingRemove = true;
    },
    /** Трек доиграл до конца. */
    complete: () => handlers.complete?.(),
  };
}

function fakeGame() {
  const sounds: ReturnType<typeof fakeSound>[] = [];
  const sound = {
    masterMuteNode: { gain: { value: 1, cancelScheduledValues() {} } },
    locked: false,
    pauseAll() {},
    resumeAll() {},
    once() {},
    add: (key: string) => {
      const s = fakeSound(key);
      sounds.push(s);
      return s;
    },
  };
  return { game: { sound, cache: { audio: { exists: () => true } } } as never, sounds };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval, clearInterval });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('музыка: затухание и конец трека (QA-10)', () => {
  it('test_music_track_ending_during_fade_out_stops_the_fade_quietly', () => {
    const { game, sounds } = fakeGame();
    const sfx = new Sfx(game);
    sfx.playMusic(['night1', 'night2'], 0);
    const track = sounds[0];
    sfx.playMusic(null, 400); // конец матча: музыка затухает
    vi.advanceTimersByTime(60);
    track.complete(); // и тут трек доиграл
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0); // таймер затухания остановлен
    expect(track.pendingRemove).toBe(true);
    expect(sounds).toHaveLength(1); // следующий трек плейлиста не заиграл после «тишины»
  });

  it('test_music_fade_to_new_track_survives_old_track_ending', () => {
    const { game, sounds } = fakeGame();
    const sfx = new Sfx(game);
    sfx.playMusic(['night1', 'night2'], 0);
    const old = sounds[0];
    sfx.playMusic('menu', 800); // выход в меню: игровая музыка затухает, меню нарастает
    vi.advanceTimersByTime(90);
    old.complete();
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    const menu = sounds.find((s) => s.key === 'bgm_menu')!;
    expect(menu.pendingRemove).toBe(false);
    expect(menu.volume).toBeGreaterThan(0); // новая музыка доиграла нарастание
  });

  it('test_music_normal_fade_out_still_destroys_track', () => {
    const { game, sounds } = fakeGame();
    const sfx = new Sfx(game);
    sfx.playMusic(['night1', 'night2'], 0);
    sfx.playMusic(null, 400);
    vi.advanceTimersByTime(1000);
    expect(sounds[0].volume).toBe(0);
    expect(sounds[0].pendingRemove).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
