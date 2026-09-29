/**
 * Регрессия FINAL_QA_REPORT.md QA-02 / QA-03 / QA-08 / QA-21: настоящий src/main.ts (boot → меню → старт →
 * итоги → облако) с заглушками Phaser, Hud, сцены, звука и спрайтов и поддельным SDK Яндекса.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const qa: Any = ((globalThis as Any).__qa = (globalThis as Any).__qa ?? {});

vi.mock('phaser', () => {
  class Scene {
    load = { on() {}, off() {}, once() {}, maxParallelDownloads: 0 };
  }
  class Game {
    scale = { getParentBounds() {}, refresh() {} };
    scene: Any;
    constructor() {
      const q = (globalThis as Any).__qa;
      const active = new Set<string>();
      const starts: Any[] = [];
      this.scene = {
        add: (k: string, cls: Any) => {
          if (k === 'boot') q.BootScene = cls;
        },
        start: (k: string, d: Any) => {
          active.add(k);
          starts.push(d);
        },
        stop: (k: string) => void active.delete(k),
        isActive: (k: string) => active.has(k),
        starts,
      };
      q.game = this;
    }
  }
  return { default: { Game, Scene, Scale: { RESIZE: 3 }, Loader: { Events: { COMPLETE: 'complete' } } } };
});
vi.mock('../src/fonts.css', () => ({}));
vi.mock('../src/style.css', () => ({}));
vi.mock('../src/view/GameScene', () => ({ GameScene: class {} }));
vi.mock('../src/view/sprites', () => ({ prefetchSkin() {}, preloadSprites() {} }));
vi.mock('../src/platform/diag', () => ({ rendererType: () => 0, startDiag() {} }));
vi.mock('../src/audio/sfx', () => ({
  SFX_GROUPS: {},
  loadMusic() {},
  preloadSfx() {},
  Sfx: class {
    muted = false;
    setMuted() {}
    play() {}
    playMusic() {}
    suspend() {}
    musicLoaded() {}
  },
}));
vi.mock('../src/platform/yandex', async (orig) => {
  const real: Any = await orig();
  return {
    ...real,
    initYandexSdk: async () => (globalThis as Any).__qa.sdk,
    lateYandexSdk: () => (globalThis as Any).__qa.late ?? Promise.resolve(null),
  };
});
vi.mock('../src/ui/hud', () => ({
  Hud: class {
    calls: [string, Any[]][] = [];
    screen: [string, Any[]] | null = null;
    onSound = () => {};
    onToggleMute = () => false;
    constructor() {
      const self = this as Any;
      (globalThis as Any).__qa.hud = self;
      return new Proxy(self, {
        get(t, p: string) {
          if (p in t) return t[p];
          return (...a: Any[]) => {
            t.calls.push([p, a]);
            if (p.startsWith('show') && p !== 'showMenu') t.screen = [p, a];
            if (p === 'hideScreen') t.screen = null;
          };
        },
      });
    }
  },
}));

const docListeners: Record<string, Array<() => void>> = {};
function el(): Any {
  return { classList: { add() {}, remove() {} }, style: { setProperty() {}, cssText: '' }, appendChild() {}, remove() {} };
}
function installGlobals() {
  for (const k of Object.keys(docListeners)) delete docListeners[k];
  vi.stubGlobal('document', {
    addEventListener: (t: string, f: () => void) => (docListeners[t] ??= []).push(f),
    getElementById: () => el(),
    createElement: () => el(),
    body: el(),
    hidden: false,
    visibilityState: 'visible',
  });
  vi.stubGlobal('window', {
    addEventListener() {},
    innerWidth: 800,
    innerHeight: 600,
    setTimeout: (...a: Any[]) => (setTimeout as Any)(...a),
    clearTimeout: (...a: Any[]) => (clearTimeout as Any)(...a),
  });
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('screen', {});
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
}

const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const snapshot = (rev: number, progress: Any) => ({ v: 2, rev, at: rev, progress });
const returning = (extra: Any = {}) => ({ matches: 10, tutorial: 'done', meta: { coins: 100, daily: { last: today, step: 1 } }, ...extra });

interface SdkOpts {
  local?: Any;
  authorized?: boolean | (() => boolean);
  getData?: () => Promise<Any>;
}
function makeSdk(o: SdkOpts) {
  const safe = new Map<string, string>();
  if (o.local) safe.set('midnight-door-progress', JSON.stringify(o.local));
  let adCbs: Any = null;
  const adCalls: string[] = [];
  const gameplay: string[] = [];
  const auth = typeof o.authorized === 'function' ? o.authorized : () => !!o.authorized;
  const player = { isAuthorized: auth, getData: vi.fn(o.getData ?? (async () => ({}))), setData: vi.fn(async () => {}) };
  const sdk = {
    getPlayer: vi.fn(async () => player),
    getStorage: async () => ({ getItem: (k: string) => safe.get(k) ?? null, setItem: (k: string, v: string) => void safe.set(k, v), removeItem: (k: string) => void safe.delete(k) }),
    auth: { openAuthDialog: vi.fn(async () => {}) },
    environment: { i18n: { lang: 'ru' } },
    features: { LoadingAPI: { ready: vi.fn() }, GameplayAPI: { start: () => gameplay.push('start'), stop: () => gameplay.push('stop') } },
    adv: {
      showFullscreenAdv: ({ callbacks }: Any) => (adCalls.push('fs'), (adCbs = callbacks)),
      showRewardedVideo: ({ callbacks }: Any) => (adCalls.push('rw'), (adCbs = callbacks)),
    },
    on() {},
  };
  return { sdk, player, safe, adCalls, gameplay, ad: () => adCbs };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
async function bootMain(sdk: Any, late: Promise<Any> | null = null) {
  qa.sdk = sdk;
  qa.late = late;
  vi.resetModules();
  await import('../src/main');
}
const spritesDone = () => new qa.BootScene().create();
const lastCall = (name: string) => [...qa.hud.calls].reverse().find((c: Any) => c[0] === name)?.[1];
const starts = (): Any[] => qa.game.scene.starts;

beforeEach(() => {
  vi.useFakeTimers();
  installGlobals();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('main.ts: переходы не обгоняют друг друга (QA-02, QA-03)', () => {
  it('test_double_tap_difficulty_during_interstitial_starts_one_match_of_last_tap', async () => {
    const f = makeSdk({ local: snapshot(10, returning()) });
    await bootMain(f.sdk);
    await flush();
    spritesDone();
    await flush();
    const onPlay = lastCall('showStart')![1];
    onPlay('easy');
    onPlay('nightmare'); // второй тап, пока ролик ещё не закрыл экран
    await flush();
    expect(f.adCalls).toEqual(['fs']);
    expect(starts()).toHaveLength(0); // никакого матча под рекламой
    f.ad().onClose(true);
    await flush();
    expect(starts()).toHaveLength(1);
    expect(starts()[0].match.opts.difficulty).toBe('nightmare');
  });

  it('test_again_then_menu_during_interstitial_stays_in_menu', async () => {
    const f = makeSdk({ local: snapshot(10, returning()) });
    await bootMain(f.sdk);
    await flush();
    spritesDone();
    await flush();
    lastCall('showStart')![1]('easy');
    await flush();
    f.ad().onClose(false);
    await flush();
    const d = starts().at(-1);
    d.match.result = 'lose';
    d.match.nightTime = 125;
    d.onEnd();
    const [, , onAgain, onMenu] = lastCall('showResult')!;
    onAgain();
    onMenu(); // передумал, пока ролик не появился
    await flush();
    const before = starts().length;
    f.ad().onClose(true);
    await flush();
    expect(starts()).toHaveLength(before); // из меню матч сам не стартует
    expect(qa.hud.screen[0]).toBe('showStart');
  });

  it('test_double_tap_try_on_unlock_preview_starts_one_match', async () => {
    const f = makeSdk({ local: snapshot(10, returning({ matches: 1, unlocks: { pumpkin: 'justUnlocked' } })) });
    await bootMain(f.sdk);
    await flush();
    spritesDone();
    await flush();
    const [kind, onTry] = lastCall('showUnlock')!;
    expect(kind).toBe('pumpkin');
    onTry();
    onTry();
    await flush();
    expect(f.adCalls).toEqual(['fs']);
    f.ad().onClose(true);
    await flush();
    expect(starts()).toHaveLength(1);
  });

  it('test_late_cloud_during_tutorial_load_shows_menu_without_tutorial_underneath', async () => {
    let answer!: (v: Any) => void;
    const f = makeSdk({ authorized: true, getData: () => new Promise((r) => (answer = r)) });
    await bootMain(f.sdk);
    await vi.advanceTimersByTimeAsync(4000); // запуск перестал ждать облако — обучение ждёт спрайты
    answer({ save: snapshot(40, returning()) }); // облако: обучение пройдено
    await flush();
    expect(qa.hud.screen[0]).toBe('showStart');
    spritesDone();
    await flush();
    expect(starts()).toHaveLength(0);
    expect(qa.game.scene.isActive('game')).toBe(false);
    expect(qa.hud.screen[0]).toBe('showStart');
    expect(f.sdk.features.LoadingAPI.ready).toHaveBeenCalledTimes(1);
  });

  it('test_late_cloud_after_difficulty_tap_cancels_pending_match', async () => {
    let answer!: (v: Any) => void;
    const f = makeSdk({ local: snapshot(10, returning()), authorized: true, getData: () => new Promise((r) => (answer = r)) });
    await bootMain(f.sdk);
    await vi.advanceTimersByTimeAsync(4000);
    lastCall('showStart')![1]('hard');
    await flush();
    f.ad().onClose(false);
    await flush(); // start() ждёт спрайты
    answer({ save: snapshot(50, returning({ matches: 7 })) });
    await flush();
    spritesDone();
    await flush();
    expect(starts()).toHaveLength(0);
    expect(qa.hud.screen[0]).toBe('showStart');
  });
});

describe('main.ts: SDK и игрок, ответившие позже запуска (QA-08, QA-21)', () => {
  it('test_late_sdk_gets_game_ready_pause_and_ads', async () => {
    const f = makeSdk({});
    // Без SDK прогресс читается из обычного localStorage.
    localStorage.setItem('midnight-door-progress', JSON.stringify(snapshot(10, returning())));
    let arrive!: (s: Any) => void;
    await bootMain(null, new Promise((r) => (arrive = r)));
    await flush();
    expect(lastCall('showStart')).toBeTruthy(); // меню без SDK
    arrive(f.sdk);
    await flush();
    expect(f.sdk.features.LoadingAPI.ready).toHaveBeenCalledTimes(1); // Game Ready ушёл опоздавшему SDK
    // Реклама перед матчем теперь идёт через SDK.
    lastCall('showStart')![1]('easy');
    await flush();
    expect(f.adCalls).toEqual(['fs']);
  });

  it('test_save_button_hidden_after_cloud_attached_by_retry', async () => {
    let authed = false;
    let fail = true;
    const f = makeSdk({
      local: snapshot(10, returning()),
      authorized: () => authed,
      getData: async () => {
        if (fail) throw new Error('network');
        return { save: snapshot(99, returning({ matches: 9 })) };
      },
    });
    await bootMain(f.sdk);
    await flush();
    const meta = lastCall('showStart')![3];
    expect(typeof meta.onCloud).toBe('function');
    authed = true;
    meta.onCloud();
    await flush();
    fail = false;
    await vi.advanceTimersByTimeAsync(30_000); // повтор подключил облако и заменил прогресс
    expect(lastCall('showStart')![3].onCloud).toBeUndefined();
  });

  it('test_double_tap_save_opens_one_sign_in', async () => {
    let finishAuth!: () => void;
    const f = makeSdk({ local: snapshot(10, returning()) });
    f.sdk.auth.openAuthDialog = vi.fn(() => new Promise<void>((r) => (finishAuth = r)));
    await bootMain(f.sdk);
    await flush();
    const meta = lastCall('showStart')![3];
    meta.onCloud();
    meta.onCloud(); // второй тап, пока окно входа ещё открыто
    await flush();
    expect(f.sdk.auth.openAuthDialog).toHaveBeenCalledTimes(1);
    finishAuth();
    await flush();
  });
});
