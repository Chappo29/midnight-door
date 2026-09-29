import type { YaAdvCallbacks, YaSdk } from './yandex';

/**
 * Связка игры с Яндекс Играми (YANDEX_READINESS.md): Game Ready, язык, пауза от платформы, разметка геймплея
 * и реклама. Без SDK (разработка, GitHub Pages) всё работает вхолостую; реклама тогда либо не показывается,
 * либо имитируется (fake — для проверки пути в разработке и по ?fakeads).
 *
 * Пауза собирается из причин: платформа (game_api_pause: стартовая реклама, реклама, сворачивание), скрытая
 * вкладка, наша реклама. Пока есть хоть одна — звук выключен (1.3, 4.7) и матч стоит. Пауза, которую поставил
 * сам игрок, сюда не входит: resume платформы её не снимает (1.19.4).
 */
export type PauseReason = 'platform' | 'hidden' | 'ad';

/** Имитация рекламы без SDK: показать «ролик» и сказать, досмотрен ли он. */
export interface FakeAds {
  show(kind: 'interstitial' | 'rewarded'): Promise<boolean>;
}

/**
 * Реклама не должна навсегда повесить игру, если SDK не ответил (FINAL_QA_REPORT.md, QA-16). Пока ролик не открылся
 * (onOpen), ждём недолго: иначе межстраничная без колбэков держала старт матча 90 с. Открылся — ждём onClose долго:
 * длинный ролик за награду нельзя обрывать по таймеру (пауза снималась под рекламой, награда терялась).
 */
export const AD_OPEN_TIMEOUT_MS = 10_000;
/** Потолок на весь показ после onOpen (и на имитацию без SDK). */
export const AD_TIMEOUT_MS = 300_000;

/**
 * Полноэкранная реклама перед матчем — со второго завершённого матча. Первый настоящий матч после обучения —
 * без рекламы: ребёнок сначала втягивается (правилами не требуется, решение по удержанию, 2026-09-27).
 */
export function interstitialBeforeMatch(p: { matches: number }): boolean {
  return p.matches >= 1;
}

export class YandexPlatform {
  private sdk: YaSdk | null = null;
  private reasons = new Set<PauseReason>();
  private readySent = false;
  /** Игра уже готова (меню или обучение на экране), а SDK ещё нет — Game Ready уйдёт, когда он подключится. */
  private wantReady = false;
  private wantGameplay = false;
  private gameplayOn = false;
  /** Идущая реклама. Повторный запрос той же межстраничной ждёт её, а не отвечает «занято» мгновенно. */
  private ad: { kind: 'interstitial' | 'rewarded'; done: Promise<boolean> } | null = null;
  /** Язык игрока из SDK (2.14); без SDK — русский. Игра пока только на русском. */
  lang = 'ru';
  /** Пауза целиком включилась или снялась — сюда подключается звук. */
  onPauseChange: (paused: boolean) => void = () => {};

  constructor(private readonly fake: FakeAds | null = null) {}

  /**
   * Подключить SDK (или null). Язык читается сразу — до первого текста на экране (2.14).
   * SDK может прийти и позже запуска (медленная сеть): тогда он получает отложенный Game Ready
   * и текущее состояние геймплея.
   */
  attach(sdk: YaSdk | null): void {
    this.sdk = sdk;
    this.lang = sdk?.environment?.i18n?.lang || 'ru';
    sdk?.on?.('game_api_pause', () => this.setPause('platform', true));
    sdk?.on?.('game_api_resume', () => this.setPause('platform', false));
    this.sendReady();
    // Без SDK start/stop никуда не уходили — сообщаем новому SDK, что сейчас на самом деле.
    this.gameplayOn = false;
    this.syncGameplay();
  }

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  setPause(reason: PauseReason, on: boolean): void {
    const was = this.paused;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (was !== this.paused) this.onPauseChange(this.paused);
    this.syncGameplay();
  }

  /** Game Ready (1.19.2): игрок уже может играть (меню или обучение на экране). Только один раз, не по таймеру. */
  ready(): void {
    this.wantReady = true;
    this.sendReady();
  }

  /** Game Ready считается отправленным, только когда его правда получил SDK (иначе опоздавший SDK его не увидит). */
  private sendReady(): void {
    const api = this.sdk?.features?.LoadingAPI;
    if (this.readySent || !this.wantReady || !api) return;
    this.readySent = true;
    try {
      api.ready();
    } catch {
      // Сбой LoadingAPI игре не мешает.
    }
  }

  /**
   * Идёт ли сейчас игровой процесс (матч или обучение без паузы и окон). GameplayAPI получает start/stop
   * только на смену состояния; на время паузы от платформы, рекламы и скрытой вкладки — stop (1.19.3).
   */
  setGameplay(active: boolean): void {
    this.wantGameplay = active;
    this.syncGameplay();
  }

  private syncGameplay(): void {
    const on = this.wantGameplay && !this.paused;
    if (on === this.gameplayOn) return;
    this.gameplayOn = on;
    try {
      const g = this.sdk?.features?.GameplayAPI;
      if (on) g?.start();
      else g?.stop();
    } catch {
      // Нет GameplayAPI — не страшно.
    }
  }

  /** Есть ли реклама за награду (SDK или имитация). */
  rewardedAvailable(): boolean {
    return !!this.sdk?.adv || !!this.fake;
  }

  /**
   * Полноэкранная реклама. Звать только сразу после действия игрока (4.4). Игра и звук на паузе на время
   * ролика (4.7). Промис выполняется, когда можно продолжать (показали, не показали или ошибка).
   */
  showInterstitial(): Promise<void> {
    return this.runAd('interstitial').then(() => undefined);
  }

  /** Реклама за награду: true — досмотрел, выдать награду; false — закрыл раньше или ошибка (4.5). */
  showRewarded(): Promise<boolean> {
    return this.runAd('rewarded');
  }

  private runAd(kind: 'interstitial' | 'rewarded'): Promise<boolean> {
    const adv = this.sdk?.adv;
    // Межстраничная уже идёт (двойной тап «Ещё раз») — ждём её же: второй старт не должен обгонять ролик.
    // За награду поверх идущей рекламы — нет (награду выдаёт только свой досмотренный ролик).
    if (this.ad) return this.ad.kind === kind && kind === 'interstitial' ? this.ad.done : Promise.resolve(false);
    if (!adv && !this.fake) return Promise.resolve(false);
    // Слот занят до создания промиса: SDK может ответить синхронно (ошибка) прямо внутри вызова.
    const slot: { kind: typeof kind; done: Promise<boolean> } = { kind, done: Promise.resolve(false) };
    this.ad = slot;
    this.setPause('ad', true);
    slot.done = new Promise<boolean>((resolve) => {
      let rewarded = false;
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        if (this.ad === slot) this.ad = null;
        this.setPause('ad', false);
        resolve(kind === 'interstitial' ? true : rewarded);
      };
      let timer = setTimeout(finish, adv ? AD_OPEN_TIMEOUT_MS : AD_TIMEOUT_MS);
      if (!adv) {
        void this.fake!.show(kind).then((ok) => {
          rewarded = ok;
          finish();
        });
        return;
      }
      const callbacks: YaAdvCallbacks = {
        onOpen: () => {
          clearTimeout(timer);
          timer = setTimeout(finish, AD_TIMEOUT_MS);
        },
        onClose: finish,
        onError: finish,
        onOffline: finish,
      };
      if (kind === 'rewarded') callbacks.onRewarded = () => (rewarded = true);
      try {
        if (kind === 'rewarded') adv.showRewardedVideo({ callbacks });
        else adv.showFullscreenAdv({ callbacks });
      } catch {
        finish();
      }
    });
    return slot.done;
  }
}

/**
 * Имитация рекламы без SDK (разработка, ?fakeads на GitHub Pages): тёмный экран «Реклама (проверка)» на 2 с.
 * Нужна, чтобы проверить весь путь — пауза, звук, награда — без Яндекса.
 */
export const domFakeAds: FakeAds = {
  show(kind) {
    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;inset:0;z-index:100000;display:grid;place-items:center;background:rgba(10,6,20,.94);color:#fff;' +
        'font:800 22px/1.4 system-ui,sans-serif;text-align:center';
      box.textContent = kind === 'rewarded' ? 'Реклама за награду (проверка)' : 'Реклама (проверка)';
      document.body.appendChild(box);
      setTimeout(() => {
        box.remove();
        resolve(true);
      }, 2000);
    });
  },
};
