/**
 * Регрессия FINAL_QA_REPORT.md: QA-01 (облако без таймаута), QA-15 (медленный getPlayer), QA-08 (SDK позже запуска),
 * QA-02 (вторая межстраничная реклама не ждала первую).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressStore, bootSave, memoryStorage, type SaveSnapshot } from '../src/platform/save';
import { emptyProgress } from '../src/platform/storage';
import { YandexPlatform } from '../src/platform/platform';
import type { YaAdvCallbacks, YaSdk } from '../src/platform/yandex';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function snap(rev: number, coins: number, matches = 0): SaveSnapshot {
  const p = emptyProgress();
  p.meta.coins = coins;
  p.matches = matches;
  p.tutorial = 'done';
  return { v: 2, rev, at: rev, progress: p };
}

describe('облако с потолком по времени (QA-01)', () => {
  it('test_cloud_answer_after_minutes_does_not_wipe_new_device_progress', async () => {
    // Новое устройство: сохранения не было; облако отвечает через 5 минут старым снимком.
    const store = new ProgressStore(null, memoryStorage(), { log: () => {} });
    let calls = 0;
    const cloud = {
      load: () => {
        calls++;
        // Первая попытка висит 5 минут; повтор отвечает сразу тем же старым снимком rev 2.
        return calls === 1 ? new Promise((r) => setTimeout(() => r(snap(2, 5)), 5 * 60_000)) : Promise.resolve(snap(2, 5));
      },
      save: vi.fn(async () => {}),
    };
    void store.attachCloud(cloud, { preferCloudIfFresh: true }).catch(() => {});
    // Игрок успевает наиграть: 30 ревизий, 300 монет, 3 матча.
    for (let i = 0; i < 30; i++) store.update((p) => (p.meta.coins = 300), {});
    store.update((p) => (p.matches = 3));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(store.cloudAttached).toBe(true); // повтор подключил облако
    expect(store.progress.meta.coins).toBe(300); // выбор по ревизии: своё новее
    expect(store.progress.matches).toBe(3);
    expect(cloud.save).toHaveBeenCalled(); // и своё ушло в облако
  });

  it('test_hung_getdata_is_retried_and_sign_in_does_not_hang', async () => {
    const store = new ProgressStore(snap(10, 100, 2), memoryStorage(), { log: () => {} });
    let calls = 0;
    const cloud = { load: () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve(snap(3, 1))), save: vi.fn(async () => {}) };
    let settled = false;
    void store
      .attachCloud(cloud)
      .catch(() => {})
      .finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(11_000);
    expect(settled).toBe(true); // висящий getData больше не держит attachCloud вечно
    await vi.advanceTimersByTimeAsync(40_000);
    expect(calls).toBe(2);
    expect(store.cloudAttached).toBe(true);
    expect(store.progress.meta.coins).toBe(100);
  });
});

describe('игрок, ответивший позже запуска (QA-15)', () => {
  it('test_slow_get_player_attaches_cloud_when_it_answers', async () => {
    const player = { isAuthorized: () => true, getData: vi.fn(async () => ({})), setData: vi.fn(async () => {}) };
    const sdk = {
      getStorage: async () => memoryStorage(),
      getPlayer: vi.fn(() => new Promise((r) => setTimeout(() => r(player), 3000))),
      auth: { openAuthDialog: vi.fn(async () => {}) },
    } as unknown as YaSdk;
    const booting = bootSave({ sdk: async () => sdk, browser: () => null, log: () => {} });
    await vi.advanceTimersByTimeAsync(2600);
    const r = await booting;
    expect(r.authorized).toBe(false); // к первому экрану ещё не ответил
    r.store.update((p) => (p.meta.coins = 500), { critical: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.store.cloudAttached).toBe(true);
    expect(player.getData).toHaveBeenCalledTimes(1);
    expect(player.setData).toHaveBeenCalled(); // своё новее — ушло в облако
    expect((sdk.getPlayer as Any).mock.calls.length).toBe(1);
  });
});

describe('SDK, ответивший позже запуска (QA-08)', () => {
  it('test_late_yagames_init_is_returned_by_late_sdk', async () => {
    const sdk = { ok: true } as Any;
    vi.stubGlobal('window', { YaGames: { init: () => new Promise((r) => setTimeout(() => r(sdk), 6000)) } });
    vi.resetModules();
    const y = await import('../src/platform/yandex');
    let early: Any = 'pending';
    void y.initYandexSdk().then((s) => (early = s));
    let late: Any = 'pending';
    void y.lateYandexSdk().then((s) => (late = s));
    await vi.advanceTimersByTimeAsync(4000);
    expect(early).toBeNull(); // запуск не ждёт дольше 4 с
    await vi.advanceTimersByTimeAsync(3000);
    expect(late).toBe(sdk); // но SDK не потерян
  });

  it('test_game_ready_waits_for_sdk_and_is_sent_once', () => {
    const p = new YandexPlatform();
    p.attach(null);
    p.ready(); // меню уже на экране, SDK ещё нет
    const ready = vi.fn();
    const gp: string[] = [];
    p.setGameplay(true);
    p.attach({ features: { LoadingAPI: { ready }, GameplayAPI: { start: () => gp.push('start'), stop: () => gp.push('stop') } } } as unknown as YaSdk);
    p.ready();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(gp).toEqual(['start']); // новый SDK узнаёт, что игра уже идёт
  });
});

describe('реклама: повторный запрос (QA-02)', () => {
  function adSdk() {
    const cbs: YaAdvCallbacks[] = [];
    const shown: string[] = [];
    const sdk = {
      adv: {
        showFullscreenAdv: ({ callbacks }: { callbacks: YaAdvCallbacks }) => (shown.push('fs'), cbs.push(callbacks)),
        showRewardedVideo: ({ callbacks }: { callbacks: YaAdvCallbacks }) => (shown.push('rw'), cbs.push(callbacks)),
      },
    } as unknown as YaSdk;
    return { sdk, cbs, shown };
  }

  it('test_second_interstitial_waits_for_the_running_one', async () => {
    const f = adSdk();
    const p = new YandexPlatform();
    p.attach(f.sdk);
    const order: string[] = [];
    void p.showInterstitial().then(() => order.push('first'));
    void p.showInterstitial().then(() => order.push('second'));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([]); // второй не проскочил, пока идёт первый ролик
    expect(f.shown).toEqual(['fs']);
    f.cbs[0].onClose?.(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['first', 'second']);
    expect(p.paused).toBe(false);
  });

  it('test_rewarded_during_interstitial_gives_no_reward', async () => {
    const f = adSdk();
    const p = new YandexPlatform();
    p.attach(f.sdk);
    void p.showInterstitial();
    await expect(p.showRewarded()).resolves.toBe(false);
    expect(f.shown).toEqual(['fs']);
  });

  it('test_sdk_throwing_synchronously_frees_the_ad_slot', async () => {
    const p = new YandexPlatform();
    p.attach({ adv: { showFullscreenAdv: () => { throw new Error('x'); }, showRewardedVideo: () => {} } } as unknown as YaSdk);
    await p.showInterstitial();
    expect(p.paused).toBe(false);
    // Слот свободен: следующая реклама показывается, а не отвечает «занято».
    const shown = vi.fn();
    p.attach({ adv: { showFullscreenAdv: shown, showRewardedVideo: () => {} } } as unknown as YaSdk);
    void p.showInterstitial();
    expect(shown).toHaveBeenCalledTimes(1);
  });
});

describe('таймауты рекламы (QA-16)', () => {
  function sdkWith(cbs: YaAdvCallbacks[]) {
    return {
      adv: {
        showFullscreenAdv: ({ callbacks }: { callbacks: YaAdvCallbacks }) => cbs.push(callbacks),
        showRewardedVideo: ({ callbacks }: { callbacks: YaAdvCallbacks }) => cbs.push(callbacks),
      },
    } as unknown as YaSdk;
  }

  it('test_interstitial_without_any_callback_releases_start_quickly', async () => {
    const p = new YandexPlatform();
    p.attach(sdkWith([]));
    let done = false;
    void p.showInterstitial().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(true); // раньше — 90 с замороженного старта
    expect(p.paused).toBe(false);
  });

  it('test_long_rewarded_video_keeps_pause_and_reward', async () => {
    const cbs: YaAdvCallbacks[] = [];
    const p = new YandexPlatform();
    p.attach(sdkWith(cbs));
    let result: boolean | null = null;
    void p.showRewarded().then((ok) => (result = ok));
    cbs[0].onOpen?.();
    await vi.advanceTimersByTimeAsync(120_000); // ролик идёт 2 минуты
    expect(p.paused).toBe(true); // звук и игра всё ещё на паузе
    expect(result).toBeNull();
    cbs[0].onRewarded?.();
    cbs[0].onClose?.(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(result).toBe(true);
    expect(p.paused).toBe(false);
  });
});
