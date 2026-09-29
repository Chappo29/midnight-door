import { describe, expect, it, vi } from 'vitest';
import { YandexPlatform, interstitialBeforeMatch, type FakeAds } from '../src/platform/platform';
import type { YaAdvCallbacks, YaSdk } from '../src/platform/yandex';

/** Поддельный SDK: запоминает вызовы и отдаёт колбэки рекламы, чтобы тест сам решал, чем закончился ролик. */
function fakeSdk(lang = 'ru') {
  const calls: string[] = [];
  const handlers: Record<string, () => void> = {};
  let lastAd: YaAdvCallbacks = {};
  const sdk: YaSdk = {
    getPlayer: vi.fn(),
    getStorage: vi.fn(),
    auth: { openAuthDialog: vi.fn() },
    environment: { i18n: { lang } },
    features: {
      LoadingAPI: { ready: () => calls.push('ready') },
      GameplayAPI: { start: () => calls.push('start'), stop: () => calls.push('stop') },
    },
    adv: {
      showFullscreenAdv: ({ callbacks }) => {
        calls.push('fullscreen');
        lastAd = callbacks ?? {};
      },
      showRewardedVideo: ({ callbacks }) => {
        calls.push('rewarded');
        lastAd = callbacks ?? {};
      },
    },
    on: (event, cb) => {
      handlers[event] = cb;
    },
  };
  return { sdk, calls, handlers, ad: () => lastAd };
}

describe('Яндекс Игры: обязательное (YANDEX_READINESS.md)', () => {
  it('test_platform_reads_language_on_attach', () => {
    // 2.14: язык из SDK — сразу при подключении.
    const p = new YandexPlatform();
    p.attach(fakeSdk('en').sdk);
    expect(p.lang).toBe('en');
    p.attach(null);
    expect(p.lang).toBe('ru');
  });

  it('test_platform_game_ready_once', () => {
    // 1.19.2: Game Ready — один раз, сколько бы раз ни звали.
    const f = fakeSdk();
    const p = new YandexPlatform();
    p.attach(f.sdk);
    p.ready();
    p.ready();
    expect(f.calls.filter((c) => c === 'ready')).toHaveLength(1);
  });

  it('test_platform_pause_from_yandex_mutes_and_resume_restores', () => {
    // 4.7 / 1.3: game_api_pause (в том числе стартовая реклама) — звук и игра стоят; resume — снимает только эту паузу.
    const f = fakeSdk();
    const p = new YandexPlatform();
    const sound: boolean[] = [];
    p.onPauseChange = (paused) => sound.push(paused);
    p.attach(f.sdk);
    f.handlers.game_api_pause();
    expect(p.paused).toBe(true);
    // Вкладку скрыли, пока шла пауза платформы: resume платформы не снимает паузу скрытой вкладки.
    p.setPause('hidden', true);
    f.handlers.game_api_resume();
    expect(p.paused).toBe(true);
    p.setPause('hidden', false);
    expect(p.paused).toBe(false);
    expect(sound).toEqual([true, false]);
  });

  it('test_platform_gameplay_start_stop_only_on_change_and_stops_on_pause', () => {
    // 1.19.3: start/stop — только при смене состояния; на паузе платформы — stop, после — снова start.
    const f = fakeSdk();
    const p = new YandexPlatform();
    p.attach(f.sdk);
    p.setGameplay(true);
    p.setGameplay(true);
    f.handlers.game_api_pause();
    f.handlers.game_api_resume();
    p.setGameplay(false);
    p.setGameplay(false);
    expect(f.calls.filter((c) => c === 'start' || c === 'stop')).toEqual(['start', 'stop', 'start', 'stop']);
  });

  it('test_platform_works_without_sdk', () => {
    // Без SDK (разработка, GitHub Pages): ничего не падает, рекламы нет.
    const p = new YandexPlatform();
    p.attach(null);
    p.ready();
    p.setGameplay(true);
    expect(p.rewardedAvailable()).toBe(false);
  });
});

describe('Яндекс Игры: реклама', () => {
  it('test_platform_interstitial_pauses_until_closed', async () => {
    // 4.7: на время ролика пауза; после закрытия — снова играем.
    const f = fakeSdk();
    const p = new YandexPlatform();
    p.attach(f.sdk);
    const done = p.showInterstitial();
    expect(f.calls).toContain('fullscreen');
    expect(p.paused).toBe(true);
    f.ad().onClose?.(true);
    await done;
    expect(p.paused).toBe(false);
  });

  it('test_platform_interstitial_not_shown_by_platform_still_continues', async () => {
    // Платформа не показала (слишком часто): onClose(false) — игра идёт дальше.
    const f = fakeSdk();
    const p = new YandexPlatform();
    p.attach(f.sdk);
    const done = p.showInterstitial();
    f.ad().onClose?.(false);
    await expect(done).resolves.toBeUndefined();
    expect(p.paused).toBe(false);
  });

  it('test_platform_rewarded_only_when_watched', async () => {
    // 4.5: награда — только если досмотрел (onRewarded); закрыл раньше — без награды.
    const f = fakeSdk();
    const p = new YandexPlatform();
    p.attach(f.sdk);
    const early = p.showRewarded();
    f.ad().onClose?.();
    expect(await early).toBe(false);
    const watched = p.showRewarded();
    f.ad().onRewarded?.();
    f.ad().onClose?.();
    expect(await watched).toBe(true);
  });

  it('test_platform_ad_error_does_not_hang', async () => {
    const f = fakeSdk();
    const p = new YandexPlatform();
    p.attach(f.sdk);
    const r = p.showRewarded();
    f.ad().onError?.(new Error('нет рекламы'));
    expect(await r).toBe(false);
    expect(p.paused).toBe(false);
  });

  it('test_platform_fake_ads_without_sdk', async () => {
    // Имитация (разработка, ?fakeads): путь рекламы проверяется без Яндекса.
    const fake: FakeAds = { show: vi.fn(async () => true) };
    const p = new YandexPlatform(fake);
    p.attach(null);
    expect(p.rewardedAvailable()).toBe(true);
    expect(await p.showRewarded()).toBe(true);
    expect(fake.show).toHaveBeenCalledWith('rewarded');
  });

  it('test_platform_interstitial_from_second_match', () => {
    // Первый настоящий матч после обучения — без рекламы; дальше — перед каждым матчем (частоту режет платформа).
    expect(interstitialBeforeMatch({ matches: 0 })).toBe(false);
    expect(interstitialBeforeMatch({ matches: 1 })).toBe(true);
  });
});
