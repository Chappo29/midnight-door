import { beforeEach, describe, expect, it } from 'vitest';
import { B, TICK } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import { HintDirector } from '../src/tutorial/hints';
import {
  BUILDING_UNLOCKS,
  UNLOCK_KINDS,
  badgeKinds,
  isOpen,
  loadUnlocks,
  markBadgeSeen,
  markPreviewSeen,
  matchUnlocks,
  nextPreview,
  previewButtons,
  recordMatchOutcome,
  type MatchOutcome,
  type Unlocks,
} from '../src/meta/unlocks';
import { ProgressStore, SAVE_KEY, parseSnapshot } from '../src/platform/save';
import type { Progress } from '../src/platform/storage';
import type { BuildKind } from '../src/sim/types';

/** Прогресс нового игрока: только счётчик матчей и открытия (то, что трогает recordMatchOutcome). */
const fresh = (): { matches: number; unlocks: Unlocks } => ({ matches: 0, unlocks: loadUnlocks(undefined, 0) });

/** Матч с настройками из открытий, игрок уже в комнате 2. */
function matchFor(u: Unlocks): Match {
  const m = new Match({ seed: 7, difficulty: 'easy', flameUnlocked: true, ...matchUnlocks(u) });
  m.command(0, { type: 'pickRoom', roomId: 2 });
  while (m.phase === 'pick') m.step();
  return m;
}

const menuKinds = (m: Match): BuildKind[] => m.floorMenuKinds(m.playerRoom!).map((k) => k.kind);

describe('открытие построек: порядок', () => {
  it('test_unlocks_config_is_one_building_per_match_in_order', () => {
    expect(BUILDING_UNLOCKS.map((u) => [u.kind, u.afterMatches])).toEqual([
      ['pumpkin', 1],
      ['trap', 2],
      ['workbench', 3],
      ['fridge', 4],
    ]);
  });

  it('test_unlocks_fresh_profile_first_match_has_only_basics', () => {
    // Arrange: новый игрок прошёл обучение (обучение матчем не считается).
    const p = fresh();
    // Act
    const m = matchFor(p.unlocks);
    const r = m.playerRoom!;
    r.door.level = 8; // даже с самой крепкой дверью
    // Assert: тыквы и поздних построек для игрока нет вовсе, пламени нет.
    expect(matchUnlocks(p.unlocks)).toEqual({ lockedKinds: ['pumpkin', 'trap', 'workbench', 'fridge'] });
    expect(m.playerFlameOpen).toBe(false);
    expect(menuKinds(m)).toEqual(['cannon']);
    expect(m.canPlace(r, r.soil[0].x, r.soil[0].y, 'pumpkin')).toBe('Ещё не открыто');
  });

  it('test_unlocks_each_completed_match_opens_next_building', () => {
    const p = fresh();
    const opened: string[][] = [];
    for (let i = 0; i < 5; i++) opened.push(recordMatchOutcome(p, 'lose'));
    expect(opened).toEqual([['pumpkin'], ['trap'], ['workbench'], ['fridge'], []]);
    expect(UNLOCK_KINDS.every((k) => isOpen(p.unlocks, k))).toBe(true);
  });

  it('test_unlocks_second_match_has_pumpkin_but_no_trap', () => {
    const p = fresh();
    recordMatchOutcome(p, 'win');
    const m = matchFor(p.unlocks);
    const r = m.playerRoom!;
    r.door.level = B.unlock.trap; // дверь уже открыла бы капкан — но глобально он ещё закрыт
    expect(m.playerFlameOpen).toBe(true);
    expect(m.canPlace(r, r.soil[0].x, r.soil[0].y, 'pumpkin')).toBeNull();
    expect(menuKinds(m)).toEqual(['cannon']);
  });

  it('test_unlocks_neighbors_are_not_limited', () => {
    // Глобальные замки и «без пламени» — только у игрока: у соседей те же постройки, цены и тыквы, что и раньше
    // (иначе соседи слабеют и меняется сложность: на «Сложной» победы падали с 55% до 27%).
    const m = matchFor(fresh().unlocks);
    const other = m.rooms.find((r) => r !== m.playerRoom)!;
    other.ownerId = 3;
    other.door.level = 3;
    other.buildings.push({ kind: 'pumpkin', x: other.soil[0].x, y: other.soil[0].y, level: 1, cooldown: 0 });
    expect(m.kindOpen(other, 'trap')).toBe(true);
    expect(m.doorUpgradeCost(other)).toEqual({ candy: B.door[3].candy, flame: B.door[3].flame });
    expect(m.flameIncomeOf(other)).toBeGreaterThan(0);
  });
});

describe('открытие построек: соседи и сложность', () => {
  it('test_unlocks_idle_player_match_is_identical_with_or_without_locks', () => {
    // Arrange: игрок ничего не делает — всё решают соседи и призрак. Замки игрока не должны менять ничего в их игре
    // (ни цен, ни тыкв, ни пламени), иначе меняется сложность первых матчей.
    const play = (seed: number, locked: boolean) => {
      const m = new Match({ seed, difficulty: 'hard', flameUnlocked: true, lockedKinds: locked ? [...UNLOCK_KINDS] : [] });
      for (let i = 0; i < 20 * 2400 && m.phase !== 'end'; i++) m.step();
      const others = m.rooms.filter((r) => r.ownerId !== null && r.ownerId !== m.playerId);
      return { result: m.result, night: m.nightTime, buildings: others.map((r) => r.buildings.map((b) => `${b.kind}${b.level}`).sort().join(',')) };
    };
    for (let seed = 1; seed <= 3; seed++) {
      // Act
      const open = play(seed, false);
      const locked = play(seed, true);
      // Assert
      expect(locked).toEqual(open);
    }
  });
});

describe('открытие построек: как закончился матч', () => {
  it.each<MatchOutcome>(['win', 'teamWin', 'lose', 'caughtExit'])('test_unlocks_%s_counts_as_completed', (o) => {
    const p = fresh();
    expect(recordMatchOutcome(p, o)).toEqual(['pumpkin']);
    expect(p.matches).toBe(1);
  });

  it('test_unlocks_quit_does_not_advance_even_many_times', () => {
    // Вход и сразу выход через паузу — не завершённый матч: открытия так не «нафармить».
    const p = fresh();
    for (let i = 0; i < 10; i++) expect(recordMatchOutcome(p, 'quit')).toEqual([]);
    expect(p.matches).toBe(0);
    expect(isOpen(p.unlocks, 'pumpkin')).toBe(false);
  });
});

describe('открытие построек: экран «Новое!» и метка в меню', () => {
  it('test_unlocks_preview_then_badge_then_available', () => {
    const p = fresh();
    recordMatchOutcome(p, 'lose');
    expect(nextPreview(p.unlocks)).toBe('pumpkin');
    expect(badgeKinds(p.unlocks)).toEqual([]);
    markPreviewSeen(p.unlocks, 'pumpkin');
    expect(nextPreview(p.unlocks)).toBeNull();
    expect(badgeKinds(p.unlocks)).toEqual(['pumpkin']);
    markBadgeSeen(p.unlocks, 'pumpkin');
    expect(badgeKinds(p.unlocks)).toEqual([]);
    expect(p.unlocks.pumpkin).toBe('available');
  });

  it('test_unlocks_door_requirement_shows_local_lock_after_global_unlock', () => {
    // Верстак открыт глобально, но в этом матче нужна дверь 3-го уровня — в меню с замком «🚪3».
    const p = fresh();
    for (let i = 0; i < 3; i++) recordMatchOutcome(p, 'lose');
    const m = matchFor(p.unlocks);
    const r = m.playerRoom!;
    const bench = () => m.floorMenuKinds(r).find((k) => k.kind === 'workbench');
    expect(bench()).toEqual({ kind: 'workbench', lockDoor: B.unlock.workbench });
    expect(m.floorMenuKinds(r).some((k) => k.kind === 'fridge')).toBe(false);
    r.door.level = B.unlock.workbench;
    expect(bench()).toEqual({ kind: 'workbench', lockDoor: null });
  });

  it('test_unlocks_hint_about_trap_waits_for_global_unlock', () => {
    // Подсказка «Ловушка-липучка…» не рассказывает про постройку, которой у игрока ещё нет.
    const m = matchFor(fresh().unlocks);
    while (m.phase !== 'prep') m.step();
    m.playerRoom!.door.level = B.unlock.trap;
    const h = new HintDirector(m, new Set(['flame']), () => {});
    const shown: string[] = [];
    for (let i = 0; i < 25 / TICK; i++) {
      m.step();
      h.onEvents(m.events);
      const hint = h.update(TICK);
      if (hint) shown.push(hint.id);
    }
    expect(shown).not.toContain('trap');
  });
});

describe('открытие построек: первый матч без пламени', () => {
  it('test_unlocks_no_flame_dead_end_before_pumpkin', () => {
    // До тыквы пламени взять негде — значит, ни одна цена в пламени не должна его требовать.
    const m = matchFor(fresh().unlocks);
    const r = m.playerRoom!;
    for (let level = 1; level < B.door.length; level++) {
      r.door.level = level;
      expect(m.doorUpgradeCost(r)?.flame).toBe(0);
    }
    for (let level = 1; level < B.cannon.max; level++) expect(m.upgradeCost({ kind: 'cannon', level }, r)?.flame).toBe(0);
    expect(m.flameIncomeOf(r)).toBe(0);
  });

  it('test_unlocks_first_match_plays_to_the_end_without_pumpkin', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const m = new Match({ seed, difficulty: 'easy', flameUnlocked: true, autoPlayer: true, ...matchUnlocks(fresh().unlocks) });
      for (let i = 0; i < 20 * 2400 && m.phase !== 'end'; i++) m.step();
      expect(m.phase).toBe('end');
      expect(m.playerRoom!.buildings.some((b) => b.kind !== 'cannon')).toBe(false);
    }
  });
});

describe('открытие построек: сохранение', () => {
  // Сохранение идёт через ProgressStore (platform/save.ts): «перезагрузка» — новый store из того же хранилища.
  let store: Map<string, string>;
  let stores: Map<Progress, ProgressStore>;
  const kv = () => ({
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  const loadProgress = (): Progress => {
    const s = new ProgressStore(parseSnapshot(store.get(SAVE_KEY)).snapshot, kv(), { log: () => {} });
    stores.set(s.progress, s);
    return s.progress;
  };
  const saveProgress = (p: Progress) => stores.get(p)!.commit();
  beforeEach(() => {
    store = new Map();
    stores = new Map();
  });

  it('test_unlocks_survive_reload', () => {
    const p = loadProgress();
    recordMatchOutcome(p, 'lose');
    recordMatchOutcome(p, 'lose');
    saveProgress(p);
    const again = loadProgress();
    expect(again.matches).toBe(2);
    expect(isOpen(again.unlocks, 'pumpkin')).toBe(true);
    expect(isOpen(again.unlocks, 'trap')).toBe(true);
    expect(isOpen(again.unlocks, 'workbench')).toBe(false);
  });

  it.each(['onTry', 'onMenu'] as const)('test_unlocks_preview_after_%s_not_shown_again_after_reload', (button) => {
    // Arrange: открылась тыква, экран «Новое!» на экране.
    const p = loadProgress();
    recordMatchOutcome(p, 'lose');
    const next: string[] = [];
    const b = previewButtons(p.unlocks, nextPreview(p.unlocks)!, () => saveProgress(p), () => next.push('try'), () => next.push('menu'));
    // Act: ребёнок нажал кнопку.
    b[button]!();
    // Assert: экран пройден, сохранено, игра пошла дальше; после перезагрузки экрана нет, в меню ждёт метка.
    expect(next).toEqual([button === 'onTry' ? 'try' : 'menu']);
    const again = loadProgress();
    expect(nextPreview(again.unlocks)).toBeNull();
    expect(badgeKinds(again.unlocks)).toEqual(['pumpkin']);
  });

  it('test_unlocks_preview_closed_without_button_is_shown_again_after_reload', () => {
    // Arrange: экран «Новое!» показан (кнопки созданы), но ребёнок закрыл вкладку, ничего не нажав.
    const p = loadProgress();
    recordMatchOutcome(p, 'lose');
    saveProgress(p);
    previewButtons(p.unlocks, nextPreview(p.unlocks)!, () => saveProgress(p), () => {}, () => {});
    // Act: перезагрузка.
    const again = loadProgress();
    // Assert: экран покажется снова, метки в меню ещё нет.
    expect(again.unlocks.pumpkin).toBe('justUnlocked');
    expect(nextPreview(again.unlocks)).toBe('pumpkin');
    expect(badgeKinds(again.unlocks)).toEqual([]);
  });

  it('test_unlocks_preview_not_seen_before_reload_is_shown_after', () => {
    // Вышли после поимки и закрыли вкладку, не дойдя до меню, — экран «Новое!» покажется при следующем входе.
    const p = loadProgress();
    recordMatchOutcome(p, 'caughtExit');
    saveProgress(p);
    expect(nextPreview(loadProgress().unlocks)).toBe('pumpkin');
  });

  it('test_unlocks_old_save_with_10_matches_keeps_everything_without_previews', () => {
    // Сохранение до этой системы: поля unlocks нет, сыграно 10 матчей.
    store.set('midnight-door-progress', JSON.stringify({ matches: 10, wins: { easy: 3 }, tutorial: 'done', hints: [] }));
    const p = loadProgress();
    expect(p.matches).toBe(10);
    expect(UNLOCK_KINDS.map((k) => p.unlocks[k])).toEqual(['available', 'available', 'available', 'available']);
    expect(nextPreview(p.unlocks)).toBeNull();
    expect(badgeKinds(p.unlocks)).toEqual([]);
  });

  it('test_unlocks_old_save_with_2_matches_gets_next_preview_only_for_new_unlock', () => {
    store.set('midnight-door-progress', JSON.stringify({ matches: 2, tutorial: 'done' }));
    const p = loadProgress();
    expect(nextPreview(p.unlocks)).toBeNull();
    expect(isOpen(p.unlocks, 'trap')).toBe(true);
    expect(recordMatchOutcome(p, 'lose')).toEqual(['workbench']);
    expect(nextPreview(p.unlocks)).toBe('workbench');
  });

  it('test_unlocks_broken_value_is_repaired_not_reset', () => {
    store.set('midnight-door-progress', JSON.stringify({ matches: 3, unlocks: { pumpkin: 'available', trap: 42 } }));
    const p = loadProgress();
    expect(p.unlocks.pumpkin).toBe('available');
    expect(isOpen(p.unlocks, 'trap')).toBe(true);
    expect(isOpen(p.unlocks, 'fridge')).toBe(false);
  });
});
