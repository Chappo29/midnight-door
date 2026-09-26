import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOSTERS, HEROES, TUTORIAL_GIFT, buyBooster, buyHero, claimDaily, selectHero, spendBoosters, planBoosters } from '../src/meta/economy';
import { isOpen, markPreviewSeen, nextPreview, recordMatchOutcome } from '../src/meta/unlocks';
import {
  CORRUPT_KEY,
  CLOUD_KEY,
  LEGACY_MUTE_KEY,
  ProgressStore,
  SAVE_KEY,
  SCHEMA_VERSION,
  bootSave,
  chooseSnapshot,
  legacyRevision,
  parseSnapshot,
  signInAndSync,
  type KeyValueStorage,
  type SaveSnapshot,
} from '../src/platform/save';
import { emptyProgress, finishTutorial, resolveTutorialOnBoot, type Progress } from '../src/platform/storage';
import type { YaPlayer, YaSdk } from '../src/platform/yandex';

// ---------------- фабрики ----------------

/** Хранилище в памяти + доступ к сырым данным (как localStorage или safeStorage). */
function kvMap(init: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const quiet = () => {};

interface FakePlayer extends YaPlayer {
  setData: ReturnType<typeof vi.fn> & YaPlayer['setData'];
  getData: ReturnType<typeof vi.fn> & YaPlayer['getData'];
  cloud: Record<string, unknown>;
}

function fakePlayer(opts: { authorized?: boolean; cloud?: Record<string, unknown>; failGet?: boolean; failSet?: boolean } = {}): FakePlayer {
  const p = {
    cloud: { ...(opts.cloud ?? {}) },
    isAuthorized: () => !!opts.authorized,
  } as FakePlayer;
  p.getData = vi.fn(async (keys?: string[]) => {
    if (opts.failGet) throw new Error('network');
    return Object.fromEntries(Object.entries(p.cloud).filter(([k]) => !keys || keys.includes(k)));
  }) as FakePlayer['getData'];
  p.setData = vi.fn(async (data: Record<string, unknown>) => {
    if (opts.failSet) throw new Error('network');
    p.cloud = JSON.parse(JSON.stringify(data));
  }) as FakePlayer['setData'];
  return p;
}

function fakeSdk(storage: KeyValueStorage | null, players: FakePlayer[]): YaSdk & { getPlayer: ReturnType<typeof vi.fn> } {
  let i = 0;
  return {
    getStorage: async () => {
      if (!storage) throw new Error('no storage');
      return storage;
    },
    getPlayer: vi.fn(async () => players[Math.min(i++, players.length - 1)]),
    auth: { openAuthDialog: vi.fn(async () => {}) },
  };
}

/** Перезагрузка страницы: новый store из того же хранилища, без SDK. */
async function reload(kv: KeyValueStorage): Promise<ProgressStore> {
  return (await bootSave({ sdk: async () => null, browser: () => kv, log: quiet })).store;
}

/** Снимок с прогрессом, изменённым mutate. */
function snap(rev: number, at: number, mutate: (p: Progress) => void = () => {}): SaveSnapshot {
  const progress = emptyProgress();
  mutate(progress);
  return { v: SCHEMA_VERSION, rev, at, progress };
}

// ---------------- обучение ----------------

describe('сохранение: обучение', () => {
  it('test_save_clean_profile_starts_tutorial', async () => {
    const s = await reload(kvMap());
    expect(resolveTutorialOnBoot(s.progress).start).toBe('tutorial');
  });

  it('test_save_tutorial_completed_survives_reload', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    s.update((p) => finishTutorial(p, 'done'), { critical: true });
    const again = await reload(kv);
    expect(again.progress.tutorial).toBe('done');
    expect(resolveTutorialOnBoot(again.progress).start).toBe('menu');
  });

  it('test_save_tutorial_skipped_survives_reload', async () => {
    const kv = kvMap();
    (await reload(kv)).update((p) => finishTutorial(p, 'skipped'));
    const again = await reload(kv);
    expect(again.progress.tutorial).toBe('skipped');
    expect(resolveTutorialOnBoot(again.progress).start).toBe('menu');
  });

  it('test_save_tutorial_gift_given_once', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    let gift = 0;
    s.update((p) => (gift = finishTutorial(p, 'done')));
    expect(gift).toBe(TUTORIAL_GIFT);
    const again = await reload(kv);
    again.update((p) => (gift = finishTutorial(p, 'done')));
    expect(gift).toBe(0);
    expect((await reload(kv)).progress.meta.coins).toBe(TUTORIAL_GIFT);
  });

  it('test_save_repeat_tutorial_does_not_reset_profile', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    s.update((p) => {
      finishTutorial(p, 'done');
      recordMatchOutcome(p, 'win');
      recordMatchOutcome(p, 'lose');
      p.meta.coins = 500;
    });
    const before = JSON.parse(JSON.stringify(s.progress));
    // Повтор из меню: пропустили, потом прошли снова.
    s.update((p) => finishTutorial(p, 'skipped'));
    s.update((p) => finishTutorial(p, 'done'));
    const again = await reload(kv);
    expect(again.progress).toEqual(before);
    expect(again.progress.tutorial).toBe('done');
    expect(again.progress.matches).toBe(2);
    expect(again.progress.meta.coins).toBe(500);
    expect(isOpen(again.progress.unlocks, 'trap')).toBe(true);
  });

  it('test_save_skipping_repeated_tutorial_keeps_done', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    s.update((p) => finishTutorial(p, 'done'));
    s.update((p) => finishTutorial(p, 'skipped'));
    expect((await reload(kv)).progress.tutorial).toBe('done');
  });

  it('test_save_leaving_tutorial_to_menu_counts_as_skipped', async () => {
    // Выход в меню из обучения раньше не сохранялся — после перезагрузки обучение запускалось снова.
    const kv = kvMap();
    (await reload(kv)).update((p) => finishTutorial(p, 'skipped'));
    const again = await reload(kv);
    expect(resolveTutorialOnBoot(again.progress).start).toBe('menu');
    expect(again.progress.meta.coins).toBe(0);
  });

  it('test_save_old_player_without_tutorial_goes_to_menu', async () => {
    const kv = kvMap({ [SAVE_KEY]: JSON.stringify({ matches: 3 }) });
    const s = await reload(kv);
    const r = resolveTutorialOnBoot(s.progress);
    expect(r).toEqual({ start: 'menu', changed: true });
  });
});

// ---------------- матчи, монеты, открытия ----------------

describe('сохранение: матчи и монеты', () => {
  it('test_save_completed_match_increments_and_survives_reload', async () => {
    const kv = kvMap();
    (await reload(kv)).update((p) => recordMatchOutcome(p, 'lose'), { critical: true });
    expect((await reload(kv)).progress.matches).toBe(1);
  });

  it('test_save_quit_does_not_increment', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    expect(recordMatchOutcome(s.progress, 'quit')).toEqual([]);
    expect(s.progress.matches).toBe(0);
    expect((await reload(kv)).progress.matches).toBe(0);
  });

  it('test_save_reward_and_purchase_persist_without_restoring_spent_coins', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    s.update((p) => (p.meta.coins += 300), { critical: true });
    s.update((p) => buyHero(p.meta, 1), { critical: true });
    const again = await reload(kv);
    expect(again.progress.meta.coins).toBe(300 - HEROES[1].price);
    expect(again.progress.meta.heroes).toContain(1);
  });
});

describe('сохранение: открытия построек', () => {
  it('test_save_first_match_unlocks_pumpkin_and_it_stays', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    let fresh: string[] = [];
    s.update((p) => (fresh = recordMatchOutcome(p, 'lose')), { critical: true });
    expect(fresh).toEqual(['pumpkin']);
    const again = await reload(kv);
    expect(again.progress.unlocks).toEqual({ pumpkin: 'justUnlocked', trap: 'locked', workbench: 'locked', fridge: 'locked' });
    // Ожидающий экран «Новое!» не потерян.
    expect(nextPreview(again.progress.unlocks)).toBe('pumpkin');
  });

  it('test_save_confirmed_preview_is_not_repeated', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    s.update((p) => recordMatchOutcome(p, 'win'));
    s.update((p) => markPreviewSeen(p.unlocks, 'pumpkin'));
    const again = await reload(kv);
    expect(again.progress.unlocks.pumpkin).toBe('seen');
    expect(nextPreview(again.progress.unlocks)).toBeNull();
    expect(isOpen(again.progress.unlocks, 'fridge')).toBe(false);
  });
});

describe('сохранение: герои, усилители, подарок, настройки', () => {
  it('test_save_hero_purchase_and_selection_persist', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    s.update((p) => {
      p.meta.coins = 1000;
      buyHero(p.meta, 2);
    });
    s.update((p) => selectHero(p.meta, 0));
    const again = await reload(kv);
    expect(again.progress.meta.heroes).toEqual([0, 2]);
    expect(again.progress.meta.hero).toBe(0);
  });

  it('test_save_booster_consumption_is_not_restored_by_reload', async () => {
    const kv = kvMap();
    const s = await reload(kv);
    s.update((p) => {
      p.meta.coins = 1000;
      buyBooster(p.meta, 'candy');
      buyBooster(p.meta, 'candy');
    });
    expect((await reload(kv)).progress.meta.boosters.candy).toBe(2);
    const s2 = await reload(kv);
    s2.update((p) => spendBoosters(p.meta, planBoosters(p.meta)));
    const again = await reload(kv);
    expect(again.progress.meta.boosters.candy).toBe(1);
    expect(again.progress.meta.coins).toBe(1000 - 2 * BOOSTERS.candy.price);
  });

  it('test_save_daily_claim_cannot_be_repeated_after_reload', async () => {
    const kv = kvMap();
    (await reload(kv)).update((p) => claimDaily(p.meta, '2026-09-26'), { critical: true });
    const again = await reload(kv);
    expect(claimDaily(again.progress.meta, '2026-09-26')).toBe(0);
    expect(again.progress.meta.daily).toEqual({ last: '2026-09-26', step: 1 });
  });

  it('test_save_mute_setting_persists', async () => {
    const kv = kvMap();
    (await reload(kv)).update((p) => (p.settings.muted = true));
    expect((await reload(kv)).progress.settings.muted).toBe(true);
  });
});

// ---------------- гость, нет SDK ----------------

describe('сохранение: гость и без SDK', () => {
  it('test_save_guest_uses_safe_storage_and_never_touches_cloud', async () => {
    const safe = kvMap();
    const plain = kvMap();
    const player = fakePlayer({ authorized: false });
    const sdk = fakeSdk(safe, [player]);
    const r = await bootSave({ sdk: async () => sdk, browser: () => plain, log: quiet });
    expect(r.backend).toBe('Yandex safeStorage');
    expect(r.authorized).toBe(false);
    r.store.update((p) => finishTutorial(p, 'done'), { critical: true });
    expect(parseSnapshot(safe.map.get(SAVE_KEY)).snapshot!.progress.tutorial).toBe('done');
    expect(plain.map.has(SAVE_KEY)).toBe(false);
    expect(player.getData).not.toHaveBeenCalled();
    expect(player.setData).not.toHaveBeenCalled();
    expect(sdk.auth.openAuthDialog).not.toHaveBeenCalled();
  });

  it('test_save_no_sdk_falls_back_to_local_storage', async () => {
    const plain = kvMap();
    const r = await bootSave({ sdk: async () => null, browser: () => plain, log: quiet });
    expect(r.backend).toBe('localStorage');
    r.store.update((p) => recordMatchOutcome(p, 'lose'));
    expect(parseSnapshot(plain.map.get(SAVE_KEY)).snapshot!.progress.matches).toBe(1);
  });

  it('test_save_safe_storage_failure_falls_back_to_local_storage', async () => {
    const plain = kvMap();
    const sdk = fakeSdk(null, [fakePlayer()]);
    const r = await bootSave({ sdk: async () => sdk, browser: () => plain, log: quiet });
    expect(r.backend).toBe('localStorage');
  });

  it('test_save_no_storage_at_all_still_plays_in_memory', async () => {
    const r = await bootSave({ sdk: async () => null, browser: () => null, log: quiet });
    expect(r.backend).toBe('memory');
    expect(() => r.store.update((p) => (p.meta.coins += 5))).not.toThrow();
    expect(r.store.progress.meta.coins).toBe(5);
  });

  it('test_save_local_write_error_does_not_throw', async () => {
    const broken: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    const s = new ProgressStore(null, broken, { log: quiet });
    expect(() => s.update((p) => (p.meta.coins = 1))).not.toThrow();
  });

  it('test_save_hanging_sdk_does_not_hang_boot', async () => {
    const hang = new Promise<never>(() => {});
    const sdk = { getStorage: () => hang, getPlayer: () => hang, auth: { openAuthDialog: () => hang } } as unknown as YaSdk;
    const plain = kvMap({ [SAVE_KEY]: JSON.stringify(snap(4, 1, (p) => (p.matches = 2))) });
    const r = await bootSave({ sdk: async () => sdk, browser: () => plain, log: quiet, timeouts: { storage: 10, player: 10, cloud: 10 } });
    expect(r.backend).toBe('localStorage');
    expect(r.store.progress.matches).toBe(2);
  });
});

// ---------------- облако ----------------

describe('сохранение: облако Яндекса', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('test_save_cloud_load_gives_progress_and_writes_it_locally', async () => {
    const safe = kvMap();
    const player = fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: snap(7, 100, (p) => (p.matches = 4)) } });
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [player]), log: quiet });
    expect(r.authorized).toBe(true);
    expect(r.store.progress.matches).toBe(4);
    expect(r.store.revision).toBe(7);
    expect(parseSnapshot(safe.map.get(SAVE_KEY)).snapshot!.rev).toBe(7);
    // Облако и так новее — отправлять нечего.
    await vi.advanceTimersByTimeAsync(10000);
    expect(player.setData).not.toHaveBeenCalled();
  });

  it('test_save_mutation_eventually_calls_set_data_with_latest_snapshot_once', async () => {
    const player = fakePlayer({ authorized: true });
    const r = await bootSave({ sdk: async () => fakeSdk(kvMap(), [player]), log: quiet });
    r.store.update((p) => p.hints.push('a'));
    r.store.update((p) => p.hints.push('b'));
    r.store.update((p) => p.hints.push('c'));
    expect(player.setData).not.toHaveBeenCalled(); // локально — сразу, облако — пачкой
    await vi.advanceTimersByTimeAsync(2500);
    expect(player.setData).toHaveBeenCalledTimes(1);
    const [data, flush] = player.setData.mock.calls[0];
    expect(flush).toBe(false);
    expect((data as { save: SaveSnapshot }).save.rev).toBe(3);
    expect((data as { save: SaveSnapshot }).save.progress.hints).toEqual(['a', 'b', 'c']);
  });

  it('test_save_critical_event_uses_flush_and_respects_min_interval', async () => {
    const player = fakePlayer({ authorized: true });
    const r = await bootSave({ sdk: async () => fakeSdk(kvMap(), [player]), log: quiet });
    r.store.update((p) => (p.meta.coins = 100), { critical: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(player.setData).toHaveBeenCalledTimes(1);
    expect(player.setData.mock.calls[0][1]).toBe(true);
    // Сразу ещё одно важное — не раньше 5 с после прошлой записи (лимит SDK).
    r.store.update((p) => (p.meta.coins = 50), { critical: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.setData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4500);
    expect(player.setData).toHaveBeenCalledTimes(2);
  });

  it('test_save_cloud_failure_keeps_local_and_retries', async () => {
    const safe = kvMap();
    const player = fakePlayer({ authorized: true, failSet: true });
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [player]), log: quiet });
    r.store.update((p) => (p.meta.coins = 70), { critical: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(player.setData).toHaveBeenCalledTimes(1);
    expect(r.store.cloudDirty).toBe(true);
    expect(r.store.progress.meta.coins).toBe(70);
    expect(parseSnapshot(safe.map.get(SAVE_KEY)).snapshot!.progress.meta.coins).toBe(70);
    // Сеть вернулась — повтор отправит тот же снимок.
    player.setData.mockImplementation(async (data: Record<string, unknown>) => void (player.cloud = data));
    await vi.advanceTimersByTimeAsync(6000);
    expect(player.setData).toHaveBeenCalledTimes(2);
    expect(r.store.cloudDirty).toBe(false);
    expect((player.cloud[CLOUD_KEY] as SaveSnapshot).progress.meta.coins).toBe(70);
  });

  it('test_save_cloud_load_failure_uses_local_and_does_not_overwrite_cloud', async () => {
    const safe = kvMap({ [SAVE_KEY]: JSON.stringify(snap(3, 1, (p) => (p.matches = 1))) });
    const player = fakePlayer({ authorized: true, failGet: true });
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [player]), log: quiet });
    expect(r.store.progress.matches).toBe(1);
    expect(r.store.cloudAttached).toBe(false);
    r.store.update((p) => (p.meta.coins = 1), { critical: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(player.setData).not.toHaveBeenCalled();
  });

  it('test_save_flush_on_page_hide_sends_pending', async () => {
    const player = fakePlayer({ authorized: true });
    const r = await bootSave({ sdk: async () => fakeSdk(kvMap(), [player]), log: quiet });
    r.store.update((p) => p.hints.push('x'));
    r.store.flushCloud();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.setData).toHaveBeenCalledTimes(1);
    expect(player.setData.mock.calls[0][1]).toBe(true);
  });
});

// ---------------- выбор снимка ----------------

describe('сохранение: локальный или облачный', () => {
  const L = (rev: number, at: number) => snap(rev, at, (p) => (p.matches = 100 + rev));
  it.each([
    ['local newer revision', L(12, 1), L(10, 9), 'local'],
    ['cloud newer revision', L(10, 9), L(12, 1), 'cloud'],
    ['same revision, local newer time', L(5, 20), L(5, 10), 'local'],
    ['same revision, cloud newer time', L(5, 10), L(5, 20), 'cloud'],
    ['cloud missing', L(1, 1), null, 'local'],
    ['local missing', null, L(1, 1), 'cloud'],
    ['both missing', null, null, null],
  ] as const)('test_save_choose_%s', (_name, local, cloud, expected) => {
    expect(chooseSnapshot(local, cloud)).toBe(expected);
  });

  it('test_save_never_merges_fields', async () => {
    // Облако: 1000 монет; локально: 500 и уже куплен герой. Max по монетам вернул бы потраченное.
    const cloud = snap(10, 1, (p) => (p.meta.coins = 1000));
    const local = snap(11, 2, (p) => {
      p.meta.coins = 500;
      p.meta.heroes = [0, 4];
    });
    const safe = kvMap({ [SAVE_KEY]: JSON.stringify(local) });
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: cloud } })]), log: quiet });
    expect(r.store.progress.meta.coins).toBe(500);
    expect(r.store.progress.meta.heroes).toEqual([0, 4]);
  });

  it('test_save_malformed_local_uses_cloud_and_keeps_backup', async () => {
    const safe = kvMap({ [SAVE_KEY]: '{not json' });
    const cloud = snap(4, 1, (p) => (p.matches = 3));
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: cloud } })]), log: quiet });
    expect(r.store.progress.matches).toBe(3);
    expect(safe.map.get(CORRUPT_KEY)).toBe('{not json');
  });

  it('test_save_malformed_cloud_uses_local_and_repairs_cloud', async () => {
    vi.useFakeTimers();
    const safe = kvMap({ [SAVE_KEY]: JSON.stringify(snap(4, 1, (p) => (p.matches = 2))) });
    const player = fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: 'garbage' } });
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [player]), log: quiet });
    expect(r.store.progress.matches).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect((player.cloud[CLOUD_KEY] as SaveSnapshot).progress.matches).toBe(2);
    vi.useRealTimers();
  });

  it('test_save_both_malformed_gives_default_profile_without_crash', async () => {
    const safe = kvMap({ [SAVE_KEY]: '[1,2' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: 42 } })]), log: quiet });
    expect(r.store.progress).toEqual(emptyProgress());
    expect(resolveTutorialOnBoot(r.store.progress).start).toBe('tutorial');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('test_save_repairs_broken_fields_instead_of_resetting', () => {
    const parsed = parseSnapshot(JSON.stringify({ v: 2, rev: 9, at: 5, progress: { matches: 3, hints: 'abc', wins: { easy: 'x' }, tutorial: 'done' } }));
    expect(parsed.snapshot!.progress.matches).toBe(3);
    expect(parsed.snapshot!.progress.hints).toEqual([]);
    expect(parsed.snapshot!.progress.wins.easy).toBe(0);
    expect(parsed.snapshot!.progress.tutorial).toBe('done');
    expect(parsed.snapshot!.rev).toBe(9);
  });
});

// ---------------- вход в Яндекс ----------------

describe('сохранение: гость → вход в Яндекс', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function guestWithProgress(cloud: Record<string, unknown>) {
    const safe = kvMap();
    const guest = fakePlayer({ authorized: false });
    const authed = fakePlayer({ authorized: true, cloud });
    const sdk = fakeSdk(safe, [guest, authed]);
    const r = await bootSave({ sdk: async () => sdk, log: quiet });
    // Гость прошёл обучение и сыграл 8 матчей.
    r.store.update((p) => finishTutorial(p, 'done'));
    for (let i = 0; i < 8; i++) r.store.update((p) => recordMatchOutcome(p, 'lose'));
    for (let i = 0; i < 11; i++) r.store.update((p) => p.hints.push(`h${i}`));
    return { r, sdk, safe, authed };
  }

  it('test_save_guest_progress_newer_than_cloud_is_kept_and_uploaded', async () => {
    const { r, sdk, authed } = await guestWithProgress({ [CLOUD_KEY]: snap(10, 5, (p) => (p.matches = 4)) });
    expect(r.store.revision).toBe(20);
    const progressRef = r.store.progress;
    expect(await signInAndSync(sdk, r.store)).toBe('local');
    // Игрок взят заново после окна входа.
    expect(sdk.getPlayer).toHaveBeenCalledTimes(2);
    expect(r.store.progress).toBe(progressRef);
    expect(r.store.progress.matches).toBe(8);
    await vi.advanceTimersByTimeAsync(1000);
    expect((authed.cloud[CLOUD_KEY] as SaveSnapshot).rev).toBe(20);
    expect((authed.cloud[CLOUD_KEY] as SaveSnapshot).progress.matches).toBe(8);
  });

  it('test_save_newer_cloud_wins_after_sign_in_and_replaces_in_place', async () => {
    const onReplaced = vi.fn();
    const safe = kvMap();
    const authed = fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: snap(50, 5, (p) => (p.matches = 30)) } });
    const sdk = fakeSdk(safe, [fakePlayer(), authed]);
    const r = await bootSave({ sdk: async () => sdk, log: quiet, onReplaced });
    const ref = r.store.progress;
    expect(await signInAndSync(sdk, r.store)).toBe('cloud');
    expect(r.store.progress).toBe(ref);
    expect(ref.matches).toBe(30);
    expect(onReplaced).toHaveBeenCalledTimes(1);
    expect(parseSnapshot(safe.map.get(SAVE_KEY)).snapshot!.rev).toBe(50);
    // После перезагрузки — тот же прогресс.
    const again = await bootSave({ sdk: async () => fakeSdk(safe, [authed]), log: quiet });
    expect(again.store.progress.matches).toBe(30);
  });

  it('test_save_empty_new_browser_takes_cloud', async () => {
    const safe = kvMap();
    const authed = fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: snap(1, 5, (p) => (p.tutorial = 'done')) } });
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [authed]), log: quiet });
    expect(r.store.progress.tutorial).toBe('done');
  });

  it('test_save_cancelled_sign_in_changes_nothing', async () => {
    const { r, sdk } = await guestWithProgress({});
    (sdk.auth.openAuthDialog as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('closed'));
    expect(await signInAndSync(sdk, r.store)).toBe('cancelled');
    expect(r.store.cloudAttached).toBe(false);
    expect(r.store.progress.matches).toBe(8);
  });
});

// ---------------- миграция ----------------

describe('сохранение: миграция старых сохранений', () => {
  /** Настоящее сохранение текущей версии игры (снято в браузере 2026-09-26) + покупки. */
  const OLD_REAL = JSON.stringify({
    matches: 3,
    wins: { easy: 2, hard: 1, nightmare: 0 },
    hints: ['build', 'upgrade', 'repair'],
    meta: {
      coins: 245,
      heroes: [0, 1, 3],
      hero: 3,
      skins: { door: ['classic', 'ginger'], cannon: ['classic'] },
      skin: { door: 'ginger', cannon: 'classic' },
      boosters: { candy: 1, door: 0, wrench: 2 },
      daily: { last: '2026-09-25', step: 4 },
      tutorialGift: true,
    },
    unlocks: { pumpkin: 'available', trap: 'available', workbench: 'seen', fridge: 'locked' },
    tutorial: 'done',
  });

  it('test_save_migrates_real_old_save_without_loss', async () => {
    const plain = kvMap({ [SAVE_KEY]: OLD_REAL, [LEGACY_MUTE_KEY]: '1' });
    const r = await bootSave({ sdk: async () => null, browser: () => plain, log: quiet });
    const old = JSON.parse(OLD_REAL);
    const p = r.store.progress;
    expect(p.matches).toBe(3);
    expect(p.wins).toEqual(old.wins);
    expect(p.hints).toEqual(old.hints);
    expect(p.meta).toEqual(old.meta);
    expect(p.unlocks).toEqual(old.unlocks);
    expect(p.tutorial).toBe('done');
    expect(p.settings.muted).toBe(true);
    // Ревизия не 0 и сохранено уже в новой схеме, звук — внутри снимка.
    expect(r.store.revision).toBe(legacyRevision(p));
    expect(r.store.revision).toBeGreaterThan(10);
    const stored = JSON.parse(plain.map.get(SAVE_KEY)!);
    expect(stored.v).toBe(SCHEMA_VERSION);
    expect(stored.rev).toBe(r.store.revision);
    expect(plain.map.has(LEGACY_MUTE_KEY)).toBe(false);
  });

  it('test_save_migrates_oldest_save_without_meta_and_unlocks', async () => {
    const plain = kvMap({ [SAVE_KEY]: JSON.stringify({ matches: 10, wins: { easy: 3 }, tutorial: 'done', hints: [] }) });
    const p = (await reload(plain)).progress;
    expect(p.matches).toBe(10);
    expect(p.wins.easy).toBe(3);
    expect(Object.values(p.unlocks)).toEqual(['available', 'available', 'available', 'available']);
  });

  it('test_save_old_local_storage_save_moves_into_safe_storage', async () => {
    const safe = kvMap();
    const plain = kvMap({ [SAVE_KEY]: OLD_REAL });
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [fakePlayer()]), browser: () => plain, log: quiet });
    expect(r.store.progress.matches).toBe(3);
    expect(JSON.parse(safe.map.get(SAVE_KEY)!).v).toBe(SCHEMA_VERSION);
  });

  it('test_save_migrated_old_save_is_not_overwritten_by_small_cloud', async () => {
    vi.useFakeTimers();
    // Старое сохранение на этом устройстве, а в облаке пара действий с другого (ревизия 3).
    const plain = kvMap({ [SAVE_KEY]: OLD_REAL });
    const safe = kvMap();
    const authed = fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: snap(3, Date.now(), (p) => (p.tutorial = 'skipped')) } });
    const r = await bootSave({ sdk: async () => fakeSdk(safe, [authed]), browser: () => plain, log: quiet });
    expect(r.store.progress.matches).toBe(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect((authed.cloud[CLOUD_KEY] as SaveSnapshot).progress.matches).toBe(3);
    vi.useRealTimers();
  });

  it('test_save_default_profile_is_not_pushed_over_cloud', async () => {
    vi.useFakeTimers();
    const player = fakePlayer({ authorized: true });
    await bootSave({ sdk: async () => fakeSdk(kvMap(), [player]), log: quiet });
    await vi.advanceTimersByTimeAsync(10000);
    expect(player.setData).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// ---------------- размер ----------------

describe('сохранение: размер', () => {
  it('test_save_snapshot_is_far_below_player_data_limit', () => {
    const s = new ProgressStore(null, kvMap(), { log: quiet });
    s.update((p) => {
      p.matches = 999;
      p.hints = Array.from({ length: 30 }, (_, i) => `hint_${i}`);
      p.meta.heroes = HEROES.map((h) => h.look);
      p.meta.skins = { door: ['classic', 'ginger', 'ice', 'candy'], cannon: ['classic', 'ginger', 'ice'] };
    });
    const bytes = new TextEncoder().encode(JSON.stringify({ [CLOUD_KEY]: s.snapshot() })).length;
    expect(bytes).toBeLessThan(2 * 1024);
  });
});

// ---------------- гонки очереди облака (по итогам ревью) ----------------

/** Промис, который разрешаем вручную. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('сохранение: гонки облака', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function attached(player = fakePlayer({ authorized: true })) {
    const r = await bootSave({ sdk: async () => fakeSdk(kvMap(), [player]), log: quiet });
    return { store: r.store, player };
  }

  it('test_save_flush_during_in_flight_send_is_sent_right_after', async () => {
    const { store, player } = await attached();
    const gate = deferred();
    player.setData.mockImplementationOnce(() => gate.promise);
    store.update((p) => p.hints.push('a'));
    await vi.advanceTimersByTimeAsync(2100); // ушла отправка rev 1
    store.update((p) => (p.meta.coins = 99), { critical: true }); // итоги матча, пока rev 1 в пути
    store.flushCloud(); // вкладку закрывают
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.setData).toHaveBeenCalledTimes(2);
    const [data, flush] = player.setData.mock.calls[1];
    expect(flush).toBe(true);
    expect((data as { save: SaveSnapshot }).save.progress.meta.coins).toBe(99);
  });

  it('test_save_queued_non_flush_write_is_pushed_with_flush_on_page_hide', async () => {
    const { store, player } = await attached();
    store.update((p) => p.hints.push('a'));
    await vi.advanceTimersByTimeAsync(2100);
    expect(player.setData.mock.calls[0][1]).toBe(false);
    store.flushCloud();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.setData).toHaveBeenCalledTimes(2);
    expect(player.setData.mock.calls[1][1]).toBe(true);
  });

  it('test_save_mutation_during_send_goes_out_afterwards', async () => {
    const { store, player } = await attached();
    const gate = deferred();
    player.setData.mockImplementationOnce(() => gate.promise);
    store.update((p) => p.hints.push('a'));
    await vi.advanceTimersByTimeAsync(2100);
    store.update((p) => p.hints.push('b'));
    gate.resolve();
    await vi.advanceTimersByTimeAsync(6000);
    expect(player.setData).toHaveBeenCalledTimes(2);
    expect((player.setData.mock.calls[1][0] as { save: SaveSnapshot }).save.progress.hints).toEqual(['a', 'b']);
  });

  it('test_save_concurrent_attach_reads_cloud_once', async () => {
    const player = fakePlayer({ authorized: true });
    const s = new ProgressStore(null, kvMap(), { log: quiet });
    const cloud = { load: () => player.getData(['save']).then((d) => d.save), save: (x: SaveSnapshot, f: boolean) => player.setData({ save: x }, f) };
    await Promise.all([s.attachCloud(cloud), s.attachCloud(cloud)]);
    await s.attachCloud(cloud);
    expect(player.getData).toHaveBeenCalledTimes(1);
  });

  it('test_save_retry_chain_stops_after_successful_attach', async () => {
    const player = fakePlayer({ authorized: true, failGet: true });
    const sdk = fakeSdk(kvMap(), [player]);
    const r = await bootSave({ sdk: async () => sdk, log: quiet });
    expect(player.getData).toHaveBeenCalledTimes(1);
    // Сеть вернулась, облако подключилось по входу — повтор с запуска больше не ходит.
    player.getData.mockImplementation(async () => ({}));
    await r.store.attachCloud({ load: () => player.getData(['save']), save: async () => {} });
    await vi.advanceTimersByTimeAsync(5 * 30000);
    expect(player.getData).toHaveBeenCalledTimes(2);
  });

  it('test_save_late_cloud_on_fresh_device_beats_tutorial_commits', async () => {
    const gate = deferred<Record<string, unknown>>();
    const player = fakePlayer({ authorized: true });
    player.getData.mockImplementationOnce(() => gate.promise);
    const booting = bootSave({ sdk: async () => fakeSdk(kvMap(), [player]), log: quiet, timeouts: { cloud: 100 } });
    await vi.advanceTimersByTimeAsync(200);
    const r = await booting;
    // Облако не успело — обучение пошло, на новом устройстве набежало несколько ревизий.
    for (let i = 0; i < 6; i++) r.store.update((p) => p.hints.push(`t${i}`));
    gate.resolve({ [CLOUD_KEY]: snap(4, 1, (p) => ((p.matches = 9), (p.meta.heroes = [0, 2]))) });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.store.progress.matches).toBe(9);
    expect(r.store.progress.meta.heroes).toEqual([0, 2]);
  });

  it('test_save_mutation_during_outage_respects_retry_backoff', async () => {
    const { store, player } = await attached(fakePlayer({ authorized: true, failSet: true }));
    store.update((p) => (p.meta.coins = 1), { critical: true });
    await vi.advanceTimersByTimeAsync(400); // 1-й сбой → повтор не раньше 5 с
    await vi.advanceTimersByTimeAsync(5000); // 2-й сбой → не раньше 10 с
    expect(player.setData).toHaveBeenCalledTimes(2);
    store.update((p) => (p.meta.coins = 2), { critical: true });
    await vi.advanceTimersByTimeAsync(9000);
    expect(player.setData).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(player.setData).toHaveBeenCalledTimes(3);
  });

  it('test_save_refresh_takes_newer_cloud_from_other_device_throttled', async () => {
    const onReplaced = vi.fn();
    const player = fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: snap(10, 1) } });
    const r = await bootSave({ sdk: async () => fakeSdk(kvMap(), [player]), log: quiet, onReplaced });
    onReplaced.mockClear(); // при запуске облако уже выбрано — это не то, что проверяем
    player.cloud = { [CLOUD_KEY]: snap(15, 2, (p) => (p.matches = 7)) }; // другое устройство
    await r.store.refreshCloud(); // сразу после запуска — рано
    expect(r.store.progress.matches).toBe(0);
    await vi.advanceTimersByTimeAsync(61000);
    await r.store.refreshCloud();
    expect(r.store.progress.matches).toBe(7);
    expect(onReplaced).toHaveBeenCalledTimes(1);
  });

  it('test_save_sign_in_with_failing_get_player_reports_failed', async () => {
    const sdk = fakeSdk(kvMap(), [fakePlayer()]);
    sdk.getPlayer.mockRejectedValueOnce(new Error('network'));
    const s = new ProgressStore(null, kvMap(), { log: quiet });
    expect(await signInAndSync(sdk, s)).toBe('failed');
  });
});

describe('сохранение: схема', () => {
  it('test_save_newer_schema_fields_survive_this_version', () => {
    const raw = { v: 3, rev: 5, at: 1, progress: { ...emptyProgress(), matches: 2, pets: ['cat'] } };
    const parsed = parseSnapshot(JSON.stringify(raw));
    const s = new ProgressStore(parsed.snapshot, kvMap(), { log: quiet });
    s.update((p) => (p.meta.coins = 5));
    expect((s.snapshot().progress as unknown as { pets: string[] }).pets).toEqual(['cat']);
  });

  it('test_save_legacy_revision_with_matches_only_is_positive', () => {
    expect(parseSnapshot(JSON.stringify({ matches: 4 })).snapshot!.rev).toBe(1 + 4 * 2);
  });

  it('test_save_time_stays_monotonic_when_clock_goes_back', () => {
    let t = 1000;
    const kv = kvMap();
    const s = new ProgressStore(null, kv, { log: quiet, now: () => t });
    s.update((p) => (p.meta.coins = 1));
    t = 500;
    s.update((p) => (p.meta.coins = 2));
    expect(s.snapshot().at).toBe(1001);
  });
});

// ---------------- повторная проверка (N1–N6) ----------------

describe('сохранение: гонки облака, второй проход', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function attachedStore(player = fakePlayer({ authorized: true })) {
    const r = await bootSave({ sdk: async () => fakeSdk(kvMap(), [player]), log: quiet });
    return { store: r.store, player };
  }

  it('test_save_hide_during_non_flush_send_pushes_it_with_flush', async () => {
    const { store, player } = await attachedStore();
    // Прошлая запись ушла с flush — в очереди SDK ничего нет.
    store.update((p) => (p.meta.coins = 1), { critical: true });
    await vi.advanceTimersByTimeAsync(400);
    // Обычное изменение: отправка без flush ещё в пути, когда вкладку прячут.
    const gate = deferred();
    player.setData.mockImplementationOnce(() => gate.promise);
    store.update((p) => p.hints.push('a'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(player.setData).toHaveBeenCalledTimes(2);
    expect(player.setData.mock.calls[1][1]).toBe(false);
    store.flushCloud();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.setData).toHaveBeenCalledTimes(3);
    expect(player.setData.mock.calls[2][1]).toBe(true);
  });

  it('test_save_double_page_hide_does_not_resend_or_leave_stale_flush', async () => {
    const { store, player } = await attachedStore();
    store.update((p) => p.hints.push('a'));
    await vi.advanceTimersByTimeAsync(2100); // ушло без flush
    store.flushCloud(); // visibilitychange → hidden
    store.flushCloud(); // pagehide
    await vi.advanceTimersByTimeAsync(0);
    expect(player.setData).toHaveBeenCalledTimes(2);
    // Следующая мелочь снова уходит обычной пачкой, без flush.
    store.update((p) => p.hints.push('b'));
    await vi.advanceTimersByTimeAsync(6000);
    expect(player.setData).toHaveBeenCalledTimes(3);
    expect(player.setData.mock.calls[2][1]).toBe(false);
  });

  it('test_save_retry_after_boot_chooses_by_revision_not_cloud_first', async () => {
    const player = fakePlayer({ authorized: true, failGet: true });
    const r = await bootSave({ sdk: async () => fakeSdk(kvMap(), [player]), log: quiet });
    // Сеть легла на запуске; ребёнок прошёл обучение и сыграл — 20 ревизий.
    for (let i = 0; i < 20; i++) r.store.update((p) => p.hints.push(`h${i}`));
    player.getData.mockImplementation(async () => ({ [CLOUD_KEY]: snap(2, 1) }));
    await vi.advanceTimersByTimeAsync(30000);
    expect(r.store.cloudAttached).toBe(true);
    expect(r.store.progress.hints).toHaveLength(20);
  });

  it('test_save_refresh_ignores_cloud_if_we_pushed_during_load', async () => {
    const player = fakePlayer({ authorized: true, cloud: { [CLOUD_KEY]: snap(10, 1) } });
    const { store } = await attachedStore(player);
    await vi.advanceTimersByTimeAsync(61000);
    const gate = deferred<Record<string, unknown>>();
    player.getData.mockImplementationOnce(() => gate.promise);
    const refreshing = store.refreshCloud();
    // Пока читали: изменение ушло и дошло.
    store.update((p) => (p.meta.coins = 5), { critical: true });
    await vi.advanceTimersByTimeAsync(400);
    gate.resolve({ [CLOUD_KEY]: snap(30, 2, (p) => (p.matches = 3)) });
    await refreshing;
    expect(store.progress.meta.coins).toBe(5);
  });
});

describe('сохранение: схема, второй проход', () => {
  it('test_save_newer_schema_nested_fields_survive', () => {
    const progress = emptyProgress() as unknown as Record<string, Record<string, unknown>>;
    progress.meta = { ...progress.meta, gems: 7 };
    progress.settings = { ...progress.settings, volume: 0.4 };
    const parsed = parseSnapshot(JSON.stringify({ v: 3, rev: 5, at: 1, progress }));
    const out = parsed.snapshot!.progress as unknown as Record<string, Record<string, unknown>>;
    expect(out.meta.gems).toBe(7);
    expect(out.settings.volume).toBe(0.4);
    expect(out.meta.coins).toBe(0);
  });
});
