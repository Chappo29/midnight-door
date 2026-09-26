import Phaser from 'phaser';

/**
 * Звуки из src/assets/sfx/*.mp3. Файл `<ключ>.mp3` или варианты `<ключ>_1.mp3`, `<ключ>_2.mp3`…
 * — тогда играет случайный. Список и источник файлов — scripts/import-sfx.mjs.
 * В игру идут только выбранные звуки. Кандидаты `<ключ>_c<N>.mp3` (68 файлов, ~1 МБ и 68 запросов на заставке) —
 * только для страницы прослушивания ?sounds в разработке; в сборку они не попадают (ветка DEV вырезается).
 */
const chosen = import.meta.glob(['../assets/sfx/*.mp3', '!../assets/sfx/*_c*.mp3'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const candidates: Record<string, string> = import.meta.env.DEV
  ? (import.meta.glob('../assets/sfx/*_c*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)
  : {};
const urls = { ...chosen, ...candidates };

const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(urls).map(([p, url]) => [`sfx_${p.split('/').pop()!.replace(/\.mp3$/, '')}`, url]),
);

/** ключ звука → ключи загруженных файлов (варианты). */
const VARIANTS: Record<string, string[]> = {};
for (const file of Object.keys(FILES)) {
  const key = file.replace(/^sfx_/, '').replace(/_\d+$/, '');
  (VARIANTS[key] ??= []).push(file);
}

/** Звуки по событиям: событие → ключи вариантов (для страницы прослушивания ?sounds). */
export const SFX_GROUPS: Record<string, string[]> = {};
for (const k of Object.keys(VARIANTS).sort()) (SFX_GROUPS[k.replace(/_c\d+$/, '')] ??= []).push(k);

/** Выбранная музыка: src/assets/bgm/<имя>.mp3 (кандидаты лежат в src/assets/music и в сборку не идут). */
const bgmUrls = import.meta.glob('../assets/bgm/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const BGM: Record<string, string> = Object.fromEntries(
  Object.entries(bgmUrls).map(([p, url]) => [`bgm_${p.split('/').pop()!.replace(/\.mp3$/, '')}`, url]),
);

export function preloadSfx(scene: Phaser.Scene): void {
  for (const [key, url] of Object.entries(FILES)) scene.load.audio(key, url);
}

/**
 * Музыка — ~40% веса игры, поэтому её не ждут на заставке: догружается в фоне после старта.
 * `done` — когда пришли все треки (Sfx.musicLoaded включит то, что просили раньше).
 */
export function loadMusic(scene: Phaser.Scene, done: () => void): void {
  for (const [key, url] of Object.entries(BGM)) scene.load.audio(key, url);
  scene.load.once(Phaser.Loader.Events.COMPLETE, done);
  scene.load.start();
}

/** Громкость музыки относительно эффектов — фон, а не главное. */
const MUSIC_VOLUME = 0.35;

export interface PlayOpts {
  /** 0..1, итоговая громкость = volume × общая громкость. */
  volume?: number;
  /** Разброс высоты тона (±доля), чтобы повторы не звучали одинаково. */
  pitch?: number;
  /** Не чаще раза в N мс (для частых звуков: выстрелы, шаги). */
  throttle?: number;
}

/**
 * Звуковые эффекты игры. Один на всю игру: создаётся в main.ts.
 * Выбор «звук выключен» хранит прогресс (settings.muted, platform/save.ts), не этот класс.
 */
export class Sfx {
  private last = new Map<string, number>();
  private _muted = false;

  constructor(private readonly game: Phaser.Game) {}

  get muted(): boolean {
    return this._muted;
  }

  setMuted(v: boolean): void {
    this._muted = v;
    this.game.sound.mute = v;
  }

  /**
   * Заглушить всё на время рекламы (правило Яндекса 4.7) — без записи в настройки игрока,
   * в отличие от setMuted. После ролика звук возвращается к выбору игрока.
   */
  suspend(on: boolean): void {
    this.game.sound.mute = on || this._muted;
    if (on) this.game.sound.pauseAll();
    else this.game.sound.resumeAll();
  }

  private music: Phaser.Sound.BaseSound | null = null;
  private musicKey: string | null = null;
  /** Что просили сыграть, пока музыка ещё грузилась. */
  private wantedMusic: string[] | null = null;
  /** Идущие затухания: у звука одно, новое отменяет старое (иначе нарастание спорит с затуханием). */
  private fades = new Map<Phaser.Sound.BaseSound, number>();

  /**
   * Фоновая музыка с плавной сменой. Одно имя — трек по кругу; массив — плейлист:
   * каждый трек доигрывает до конца и сразу начинается следующий, после последнего — снова первый.
   * null — затихнуть. До первого касания браузер звук не пускает — тогда включится сразу после него.
   */
  playMusic(name: string | string[] | null, fadeMs = 800): void {
    const list = name === null ? [] : Array.isArray(name) ? name : [name];
    const id = list.join(',') || null;
    if (id === this.musicKey) return;
    this.musicKey = id;
    const old = this.music;
    this.music = null;
    if (old) this.fade(old, MUSIC_VOLUME, 0, fadeMs, () => old.destroy());
    this.wantedMusic = null;
    // Тишина (null): старый трек уже затихает, нового нет. Без этой проверки пустой список «загружен» (every по []),
    // и playAt брал keys[0] = undefined — Phaser падал, и экран итогов не появлялся.
    if (!list.length) return;
    const keys = list.map((n) => `bgm_${n}`);
    if (!keys.every((k) => this.game.cache.audio.exists(k))) {
      // Музыка ещё не загружена — не запоминаем, иначе повторный вызов решит, что она уже играет.
      // Включит musicLoaded, когда треки придут.
      this.musicKey = null;
      if (list.length) this.wantedMusic = list;
      return;
    }
    const playAt = (i: number, fade: number) => {
      if (this.musicKey !== id) return;
      const m = this.game.sound.add(keys[i], { loop: keys.length === 1 });
      if (keys.length > 1) m.once(Phaser.Sound.Events.COMPLETE, () => {
        m.destroy();
        playAt((i + 1) % keys.length, 0);
      });
      m.play();
      this.music = m;
      this.fade(m, 0, MUSIC_VOLUME, fade);
    };
    const start = () => playAt(0, fadeMs);
    if (this.game.sound.locked) this.game.sound.once(Phaser.Sound.Events.UNLOCKED, start);
    else start();
  }

  /** Музыка догрузилась (loadMusic) — играем то, что просили, пока её не было. */
  musicLoaded(): void {
    if (this.wantedMusic) this.playMusic(this.wantedMusic);
  }

  /**
   * Плавно меняет громкость from → to. Начальную громкость передаём явно: геттер volume у Phaser
   * читает gain.value, а он обновляется асинхронно — сразу после setVolume там ещё старое значение (1).
   */
  private fade(sound: Phaser.Sound.BaseSound, from: number, to: number, ms: number, done?: () => void): void {
    const s = sound as Phaser.Sound.WebAudioSound;
    window.clearInterval(this.fades.get(sound));
    this.fades.delete(sound);
    s.setVolume(from);
    if (ms <= 0) {
      s.setVolume(to);
      done?.();
      return;
    }
    // Таймер, а не requestAnimationFrame: кадры в фоновой вкладке не рисуются,
    // и старый трек так и остался бы играть поверх нового.
    const t0 = performance.now();
    const timer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      s.setVolume(from + (to - from) * k);
      if (k < 1) return;
      window.clearInterval(timer);
      this.fades.delete(sound);
      done?.();
    }, 30);
    this.fades.set(sound, timer);
  }

  /**
   * «Тук-тук» — сигнал «призрак идёт к тебе»: два глухих низких удара, как сердцебиение (вариант D со страницы
   * public/sounds.html, выбран 2026-09-26 вместо «динь-дон»). Синтез на лету, без файла: не страшный и не похожий
   * на стук в дверь. Громкость и выключение — как у остальных звуков.
   */
  heartbeat(volume = 0.55): void {
    if (this._muted || this.game.sound.locked) return;
    const mgr = this.game.sound as Phaser.Sound.WebAudioSoundManager;
    const ctx = mgr.context;
    const out = mgr.destination as AudioNode | undefined;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime + 0.02;
    // Удар: тон скользит вниз 90 → 55 Гц и быстро гаснет; второй чуть тише и длиннее («тук-ТУК»).
    for (const [at, dur, vol] of [
      [0, 0.22, volume],
      [0.22, 0.26, volume * 0.83],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = t0 + at;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + dur);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  play(key: string, opts: PlayOpts = {}): void {
    // Пока вариант не выбран (npm run sfx -- pick …), играет первый кандидат.
    const variants = VARIANTS[key] ?? VARIANTS[`${key}_c1`];
    if (!variants || this._muted) return;
    const volume = opts.volume ?? 1;
    if (volume <= 0.01) return;
    const now = performance.now();
    if (opts.throttle && now - (this.last.get(key) ?? -1e9) < opts.throttle) return;
    this.last.set(key, now);
    const file = variants[Math.floor(Math.random() * variants.length)];
    if (!this.game.cache.audio.exists(file)) return;
    const pitch = opts.pitch ?? 0.06;
    this.game.sound.play(file, { volume: volume * 0.8, rate: 1 + (Math.random() * 2 - 1) * pitch });
  }
}
