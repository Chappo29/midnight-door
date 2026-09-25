import Phaser from 'phaser';
import { B, LATE_KINDS, TICK, benchHeal, fridgeSlow, isLateKind, trapHold, type LateKind } from '../sim/balance';
import { H, Tile, W } from '../sim/map';
import type { Match } from '../sim/match';
import { inRoom, isSoil, key, occupantAt, roomAtCell, roomByDoor, roomCells, roomCenter, walkable } from '../sim/roomgrid';
import type { BuildKind, Building, Character, Cmd, Cost, Room, SimEvent } from '../sim/types';
import type { Hud, MenuOption } from '../ui/hud';
import { anchorY, doorKeys, firstSprite, fitImage, hasSprite, preloadSprites } from './sprites';
import { ghostHitIntervalAt, ghostXpNeed } from '../sim/ghost';
import type { PlayOpts, Sfx } from '../audio/sfx';
import { TutorialDirector, type TutorialTrack } from '../tutorial/director';
import { TutorialOverlay } from '../tutorial/overlay';
import { HintDirector } from '../tutorial/hints';
import { isDrag } from '../ui/inputGuard';
import { caughtTip } from '../ui/caughtTip';
import type { Target } from '../tutorial/steps';

const TS = 48;
const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';

export interface GameData {
  match: Match;
  hud: Hud;
  sfx: Sfx;
  onEnd: () => void;
  /** Игрок сам вышел в меню (пауза, карточка поимки). Награду за выход решает main.ts. */
  onMenu: () => void;
  /** Началась ночь — усилители реально пошли в дело, пора их списать. */
  onNightStart?: () => void;
  /** Сколько монет даст выход в меню прямо сейчас (подпись на кнопке «В меню»). */
  exitCoins?: () => number;
  /** Обучение: что делать при пропуске и куда слать шаги воронки. */
  tutorial?: { onSkip: () => void; track?: TutorialTrack };
  /** Подсказки по ходу игры: какие уже показаны и куда отметить новую. */
  hints?: { seen: Set<string>; onSeen: (id: string) => void; firstMatches?: boolean };
  /** Игрок вернулся в комнату за рекламу (для аналитики). Пока не вызывается: кнопку убрали из UI до Yandex SDK. */
  onRevive?: () => void;
}

interface CharView {
  c: Character;
  root: Phaser.GameObjects.Container;
  /** Поза: точка вращения и сжатия — у ног персонажа. */
  body: Phaser.GameObjects.Container;
  hammer: Phaser.GameObjects.Container;
  shovel: Phaser.GameObjects.Container;
  emote: Phaser.GameObjects.Text;
  /** Картинка персонажа; при покадровой анимации меняем ей текстуру. */
  img: Phaser.GameObjects.Image | null;
  /** Есть нарисованные кадры (charN_idle, _walk1, _walk2, _hammer1, _hammer2, _scared). */
  frames: boolean;
  /** Куда смотрит: вниз (к камере), вверх (спиной), вбок (профиль, flip = влево). */
  dir: Dir;
  flip: boolean;
  /** Масштаб картинки для «старых» кадров (вписанных в рамку). */
  baseScale: number;
  /** Номер последнего удара молотком — чтобы пыль летела ровно в момент удара. */
  lastHit: number;
  /** Сдвиг фазы, чтобы соседи не шагали в ногу. */
  off: number;
}

type Dir = 'down' | 'up' | 'side';

/**
 * Направленные кадры: charN_<dir>_<поза>, нарезаны с --idle=210 (рост в позе покоя),
 * поэтому масштаб у всех направлений общий и герой не меняет размер при повороте.
 */
const DIR_FRAMES = { idlePx: 210, heightPx: 52 } as const;
/** Кадры призрака нарезаны так же (--idle=210); на экране он крупнее детей. */
const GHOST_FRAMES = { idlePx: 210, heightPx: 68 } as const;
/** Цвета окружения: тёплые комнаты, тёмные прохладные коридоры, фиолетовое гнездо. */
const PAL = {
  plank: 0xe2b98a,
  plankSeam: 0xb98a5c,
  soil: 0x6b3f22,
  soilDark: 0x4e2c16,
  soilRim: 0x8a5a36,
  sprout: 0x6fcf5a,
  hall: 0x33304f,
  hallGrout: 0x1c1a2c,
  hallWall: 0x3d355e,
  hallBoard: 0x241f38,
  nest: 0x4a2a6e,
  wallTop: 0x2a2342,
  wallTopLine: 0x352d52,
  wallEdge: 0x6a5a96,
  paper: 0xf3d7c4,
  paperStripe: 0xecc6b0,
  board: 0x9b6a42,
} as const;
/** Где у ствола шарнир (доля ширины от левого края) — у каждой модели свой. */
const CANNON_PIVOT: Record<string, number> = {
  cannon_barrel_l2: 0.19,
  cannon_barrel_l3: 0.19,
  cannon_barrel_l4: 0.17,
  cannon_barrel_l5: 0.13,
  cannon_barrel_l6: 0.16,
  // Скины: шарнир-кружок у всех стволов серии примерно в одном месте (замер по листу).
  cannon_barrel_ginger_l1: 0.15,
  cannon_barrel_ginger_l2: 0.15,
  cannon_barrel_ginger_l3: 0.15,
  cannon_barrel_ginger_l4: 0.15,
  cannon_barrel_ginger_l5: 0.16,
  cannon_barrel_ginger_l6: 0.15,
  cannon_barrel_ice_l1: 0.15,
  cannon_barrel_ice_l2: 0.15,
  cannon_barrel_ice_l3: 0.15,
  cannon_barrel_ice_l4: 0.15,
  cannon_barrel_ice_l5: 0.15,
  cannon_barrel_ice_l6: 0.15,
};

/** Параметры анимации персонажей (мс и доли). */
const ANIM = {
  stepMs: 150,
  hop: 7,
  waddle: 0.11,
  swingMs: { build: 380, plant: 420, upgrade: 380, door: 380, sofa: 380, sell: 300, repair: 300 } as Record<string, number>,
  breatheMs: 650,
  walkFrameMs: 120,
} as const;

const ITEM_ICON = { lavender: '🌸', safe: '💰', toolbox: '🧰' } as const;
const ITEM_INFO = {
  lavender: 'Лаванда: даёт конфеты, когда бьют дверь',
  safe: 'Сейф: +1.5 🍬 в секунду',
  toolbox: 'Ящик: сам понемногу чинит дверь',
} as const;
/** Подписи построек в меню и в баннере «Новое!» (desc — серая строчка под названием). */
const BUILD_INFO: Record<BuildKind, { label: string; desc?: string }> = {
  cannon: { label: 'Пушка' },
  pumpkin: { label: 'Тыква' },
  trap: { label: 'Капкан', desc: 'держит призрака' },
  workbench: { label: 'Верстак', desc: 'чинит дверь ночью' },
  fridge: { label: 'Холодильник', desc: 'призрак бьёт реже' },
};
const DOOR_COLORS = [0x8b5a2b, 0x9c6b35, 0xb07d42, 0x8a8f99, 0x9fa8b3, 0xd4a82c, 0xe8c24a, 0x9ef0ff];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class GameScene extends Phaser.Scene {
  private m!: Match;
  private hud!: Hud;
  private sfx!: Sfx;
  private lastTick = -1;
  private gd!: GameData;
  private acc = 0;
  private userPaused = false;
  private hiddenPaused = false;
  /** Игрока поймали: карточка «Играть духом / вернуться» на экране, игра стоит. */
  private caughtPaused = false;
  private ended = false;
  private low!: Phaser.GameObjects.Graphics;
  private high!: Phaser.GameObjects.Graphics;
  private buildingViews = new Map<string, Phaser.GameObjects.Container>();
  private popKeys = new Set<string>();
  private charViews: CharView[] = [];
  private ghostView!: Phaser.GameObjects.Container;
  private ghostBody!: Phaser.GameObjects.Container;
  private ghostLabel!: Phaser.GameObjects.Text;
  private ghostFlash = 0;
  /** Кадровый призрак (ghost_<dir>_<поза>); null — старая одиночная картинка. */
  private ghostImg: Phaser.GameObjects.Image | null = null;
  private ghostDir: 'down' | 'up' | 'side' = 'down';
  private ghostHurtUntil = 0;
  private ghostLaughUntil = 0;
  private sofaLabels: Phaser.GameObjects.Text[] = [];
  private roomLabels: Phaser.GameObjects.Text[] = [];
  private doorShake = new Map<number, number>();
  /** Пункт меню упёрся в дверь (диван и т.п.) — тап по нему подсвечивает дверь до этого момента (this.time.now). */
  private doorPulse = new Map<number, number>();
  private selected: { x: number; y: number } | null = null;
  private drag = { down: false, sx: 0, sy: 0, scrollX: 0, scrollY: 0, dragging: false };
  /** Когда (performance.now) палец коснулся поля: тап засчитываем, только если жест начался после смены экрана. */
  private downAt = 0;
  private pinch = { active: false, dist: 0, zoom: 1 };
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private doorImgs: (Phaser.GameObjects.Image | null)[] = [];
  /** Построитель открытого меню — пересчитывается, пока меню на экране. */
  private menuBuild: (() => { title: string; options: MenuOption[] } | null) | null = null;
  private menuTimer = 0;
  private tut: TutorialDirector | null = null;
  private tutOverlay: TutorialOverlay | null = null;
  private tutIndex = -1;
  /** Камера сейчас ведёт призрака по просьбе обучения (вернуть к комнате, когда шаг сменится). */
  private tutFollow = false;
  /** Выбор комнаты: «весь этаж» вместо крупного вида у героя (переключает кнопка «домой»). */
  private pickOverview = false;
  /** Камера сейчас ведёт героя к его комнате (см. followPlayerToRoom). */
  private walkFollow = false;
  private hints: HintDirector | null = null;
  private hintOverlay: TutorialOverlay | null = null;
  /** Поздние постройки, про которые уже сказали «Новое!» (или открытые ещё до получения комнаты). */
  private seenUnlock = new Set<LateKind>();
  /** Первая проверка уже была: всё, что открыто к этому моменту (усилитель двери), — без баннера. */
  private unlockPrimed = false;
  /** Открылись в этом матче и ещё не построены — в меню с меткой «Новое!». */
  private newKinds = new Set<LateKind>();
  /** Сколько секунд подряд дверь мигает, а готовый ключ не жмут; и было ли так в этой осаде (совет на карточке поимки). */
  private missedRepairT = 0;
  private missedRepair = false;

  constructor() {
    super('game');
  }

  /**
   * Phaser переиспользует объект сцены между матчами, поэтому здесь сбрасывается ВСЁ состояние,
   * которое живёт в пределах одного матча. Новое поле сцены — добавь его сюда.
   */
  init(data: GameData): void {
    this.gd = data;
    this.m = data.match;
    this.hud = data.hud;
    this.sfx = data.sfx;
    this.lastTick = -1;
    this.acc = 0;
    this.userPaused = false;
    this.hiddenPaused = document.hidden;
    this.caughtPaused = false;
    this.ended = false;
    this.buildingViews = new Map();
    this.popKeys = new Set();
    this.charViews = [];
    this.sofaLabels = [];
    this.roomLabels = [];
    this.doorShake = new Map();
    this.doorPulse = new Map();
    this.selected = null;
    this.drag = { down: false, sx: 0, sy: 0, scrollX: 0, scrollY: 0, dragging: false };
    this.downAt = 0;
    this.pinch = { active: false, dist: 0, zoom: 1 };
    this.ghostFlash = 0;
    this.ghostImg = null;
    this.ghostDir = 'down';
    this.ghostHurtUntil = 0;
    this.ghostLaughUntil = 0;
    this.doorImgs = [];
    this.menuBuild = null;
    this.menuTimer = 0;
    this.tut = null;
    this.tutOverlay = null;
    this.tutIndex = -1;
    this.tutFollow = false;
    this.pickOverview = false;
    this.walkFollow = false;
    this.hints = null;
    this.hintOverlay = null;
    this.seenUnlock = new Set();
    this.unlockPrimed = false;
    this.newKinds = new Set();
    this.missedRepairT = 0;
    this.missedRepair = false;
  }

  preload(): void {
    preloadSprites(this);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#140f22');
    this.drawStatic();
    this.doorImgs = this.m.rooms.map((r) =>
      firstSprite(this, doorKeys(8)) ? this.add.image(r.door.x * TS + TS / 2, r.door.y * TS + TS / 2, firstSprite(this, doorKeys(8))!).setDepth(2) : null,
    );
    this.low = this.add.graphics().setDepth(2);
    this.high = this.add.graphics().setDepth(30);
    for (const c of this.m.chars) this.charViews.push(this.makeChar(c));
    this.makeGhost();
    this.fitCamera();
    this.setupInput();

    this.hud.setInGame(true);
    this.hud.bind({
      repair: () => this.tutRepair(),
      home: () => {
        // На выборе комнаты «домой» переключает «весь этаж ↔ ко мне».
        if (this.m.phase === 'pick') this.pickOverview = !this.pickOverview;
        this.fitCamera();
      },
      pause: () => this.togglePause(),
      boo: () => this.cmd({ type: 'boo' }),
      spark: () => this.cmd({ type: 'spark' }),
    });
    if (this.m.opts.tutorial) this.startTutorial();
    else {
      this.hud.banner('Выбери комнату! 👆', 3500);
      const h = this.gd.hints;
      const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
      if (h) this.hints = new HintDirector(this.m, h.seen, h.onSeen, touch, h.firstMatches);
    }
    this.sfx.play('start', { volume: 0.7, pitch: 0 });

    const onResize = () => this.fitCamera();
    const onVis = () => {
      this.hiddenPaused = document.hidden;
    };
    this.scale.on('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    const onLeave = () => this.tut?.quit();
    window.addEventListener('pagehide', onLeave);
    this.events.once('shutdown', () => {
      window.removeEventListener('pagehide', onLeave);
      this.tutOverlay?.destroy();
      this.tutOverlay = null;
      this.tut = null;
      this.hintOverlay?.destroy();
      this.hintOverlay = null;
      this.hints = null;
      this.scale.off('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      this.hud.setInGame(false);
    });
  }

  // ---------------- поймали: дух ----------------

  /**
   * Игрока поймали, соседи ещё держатся: игра встаёт, карточка «Играть духом / Выйти в меню».
   * Возрождения нет (решение пользователя 2026-09-25); выход в меню — без монет за матч.
   */
  private onPlayerCaught(): void {
    if (this.m.result || this.ended) return;
    this.selected = null;
    this.hud.hideMenu();
    this.caughtPaused = true;
    this.hud.showCaught(
      () => {
        this.caughtPaused = false;
        this.hud.hideScreen();
        this.fitCamera();
        this.hud.banner('Ты дух! Помогай соседям', 3500);
      },
      () => this.gd.onMenu(),
      this.gd.exitCoins?.() ?? 0,
      this.caughtAdvice(),
    );
  }

  /** Один совет на следующий раз — из того, что было в комнате в момент поимки. */
  private caughtAdvice(): ReturnType<typeof caughtTip> | undefined {
    const m = this.m;
    const r = m.playerRoom;
    if (!r) return undefined;
    const up = m.doorUpgradeCost(r);
    return caughtTip({
      cannons: r.buildings.filter((b) => b.kind === 'cannon').length,
      doorLevel: r.door.level,
      missedRepair: this.missedRepair,
      couldUpgradeDoor: !!up && m.canAfford(r, up),
    });
  }

  /** Дверь мигает (<40 %), ключ готов, а его не жмут дольше 1,5 с — запомним для совета. */
  private trackMissedRepair(dt: number): void {
    const m = this.m;
    const r = m.playerRoom;
    if (!r || m.player.caught || m.phase !== 'night') return;
    const d = r.door;
    const idleKey = !d.broken && d.hp < d.maxHp * 0.4 && d.repairCd <= 0 && m.player.task?.kind !== 'repair';
    this.missedRepairT = idleKey ? this.missedRepairT + dt : 0;
    if (this.missedRepairT > 1.5) this.missedRepair = true;
  }

  /** Дух: тап по пушке соседа — «Искорка» (если готова и дотягивается), иначе лететь в эту клетку. */
  private spiritTap(tx: number, ty: number): void {
    const m = this.m;
    const p = m.player;
    for (const r of m.rooms) {
      if (r.ownerId === null || r.ownerId === m.playerId || r.eliminated) continue;
      const b = r.buildings.find((q) => q.kind === 'cannon' && q.x === tx && q.y === ty);
      if (!b) continue;
      const near = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) <= B.spirit.sparkRange;
      if (p.sparkCd <= 0 && near) return this.cmd({ type: 'spark', x: tx, y: ty, roomId: r.id });
      break;
    }
    this.cmd({ type: 'move', x: tx, y: ty });
  }

  // ---------------- обучение ----------------

  private startTutorial(): void {
    const t = this.gd.tutorial;
    this.tut = new TutorialDirector(this.m, t?.track);
    this.tutIndex = 0;
    this.tutOverlay = new TutorialOverlay(() => {
      this.tut?.skip();
      this.tutOverlay?.destroy();
      this.tutOverlay = null;
      t?.onSkip();
    });
    // Камеру уже поставили в create() — тогда обучения ещё не было, и она смотрела на героя,
    // а подсказанная комната оставалась за краем экрана. Ставим заново: на эту комнату.
    this.fitCamera();
  }

  /** Куда светить и показывать пальцем: клетка, призрак, кнопка интерфейса или пункт открытого меню. */
  private renderTutorial(): void {
    const tut = this.tut;
    const ov = this.tutOverlay;
    if (!tut || !ov) return;
    const v = tut.view();
    if (!v) {
      // Обучение пройдено — дальше обычная игра до победы над призраком.
      ov.destroy();
      this.tutOverlay = null;
      return;
    }
    if (v.index !== this.tutIndex) {
      if (v.index > 0) {
        ov.praise();
        this.sfx.play('popup', { volume: 0.8 });
      }
      this.tutIndex = v.index;
    }
    this.tutCamera(v.target.kind === 'ghost');
    // ⏭ стоит у правого края и перекрывала цену в открытом меню постройки — прячем, пока меню открыто.
    ov.setSkipHidden(this.hud.menuOpen);
    ov.show(v.step.text, v.step.pose, this.targetRect(v.target, v.step.menuOpt), v.nudge, v.target.kind !== 'ghost');
  }

  /**
   * Кот показывает на призрака — камера плавно едет за ним (если вся карта не влезает в экран).
   * Шаг сменился — камера возвращается к своей комнате.
   */
  private tutCamera(followGhost: boolean): void {
    const g = this.m.ghost;
    const visible = g.state !== 'hidden' && g.state !== 'dead';
    if (followGhost && visible && !this.mapFits()) {
      const cam = this.cameras.main;
      const mid = cam.midPoint;
      cam.centerOn(mid.x + (this.ghostView.x - mid.x) * 0.08, mid.y + (this.ghostView.y - mid.y) * 0.08);
      this.clampCamera();
      this.tutFollow = true;
    } else if (this.tutFollow) {
      this.tutFollow = false;
      this.fitCamera();
    }
  }

  /** Вся карта помещается на экран (тогда камеру двигать незачем). */
  private mapFits(): boolean {
    const zAll = Math.min(this.scale.width / (W * TS), (this.scale.height - 70) / (H * TS));
    return zAll * TS >= 34;
  }

  /** Подсказка по ходу игры: облачко с котом, палец на цель, без затемнения. hidden — на экране окно (пауза, итоги). */
  private renderHint(dt: number, hidden = false): void {
    const hint = this.hints?.update(dt) ?? null;
    if (!hint || hidden) {
      this.hintOverlay?.hide();
      return;
    }
    this.hintOverlay ??= new TutorialOverlay(() => {}, true);
    this.hintOverlay.show(hint.text, hint.pose, this.targetRect(hint.target), 0);
  }

  /** Экранный прямоугольник цели: пункт открытого меню, клетка, призрак или элемент интерфейса. */
  private targetRect(t: Target, menuOpt?: string): DOMRect | null {
    const cam = this.cameras.main;
    const box = (wx: number, wy: number, size: number) => {
      const s = size * cam.zoom;
      return new DOMRect((wx - cam.worldView.x) * cam.zoom - s / 2, (wy - cam.worldView.y) * cam.zoom - s / 2, s, s);
    };
    const opt = menuOpt && this.hud.menuOpen ? document.querySelector(`#menu button[data-opt="${menuOpt}"]`) : null;
    if (opt) return opt.getBoundingClientRect();
    if (t.kind === 'cell') return box((t.at.x + 0.5) * TS, (t.at.y + 0.5) * TS, TS);
    if (t.kind === 'ghost') return this.m.ghost.state !== 'hidden' ? box(this.ghostView.x, this.ghostView.y - TS * 0.5, TS * 1.6) : null;
    if (t.kind === 'dom') return document.querySelector(t.sel)?.getBoundingClientRect() ?? null;
    return null;
  }

  /** Только для отладки: перемотать симуляцию на N секунд. */
  debugAdvance(seconds: number): void {
    for (let i = 0; i < seconds / TICK && this.m.phase !== 'end'; i++) {
      this.m.step();
      this.handleEvents(this.m.events);
    }
  }

  /** Только для отладки: тап по клетке мира, как пальцем. */
  debugTapCell(x: number, y: number): void {
    const cam = this.cameras.main;
    const sx = ((x + 0.5) * TS - cam.worldView.x) * cam.zoom;
    const sy = ((y + 0.5) * TS - cam.worldView.y) * cam.zoom;
    this.tap({ x: sx, y: sy } as Phaser.Input.Pointer);
  }

  togglePause(): void {
    // Исход уже решён (призрак побеждён, до итогов ~1,5 с) — пауза с «Выйти в меню» отняла бы победу.
    if (this.ended || this.caughtPaused || (this.m.result && !this.userPaused)) return;
    this.userPaused = !this.userPaused;
    if (this.userPaused) {
      const tut = this.tut && !this.tut.done ? this.gd.tutorial : undefined;
      this.hud.showPause(
        () => this.togglePause(),
        () => this.gd.onMenu(),
        tut &&
          (() => {
            this.tut?.skip();
            tut.onSkip();
          }),
        this.tut ? 0 : (this.gd.exitCoins?.() ?? 0),
      );
    } else this.hud.hideScreen();
  }

  update(time: number, deltaMs: number): void {
    const paused = this.userPaused || this.hiddenPaused || this.caughtPaused;
    if (!paused && !this.ended) {
      this.acc += Math.min(deltaMs / 1000, 0.25);
      while (this.acc >= TICK) {
        this.m.step();
        this.handleEvents(this.m.events);
        this.acc -= TICK;
      }
    }
    const a = paused ? 1 : this.acc / TICK;
    if (!paused) {
      this.handleKeys();
      this.trackMissedRepair(deltaMs / 1000);
    }
    this.renderChars(a, time);
    this.followPlayerToRoom();
    this.renderGhost(a, time, deltaMs);
    this.updateGhostArrow();
    this.syncBuildings();
    this.renderDynamic(time);
    this.hud.update(this.m);
    this.checkUnlocks();
    // Последние 5 секунд до полуночи — тикают часы.
    if (this.m.phase === 'prep' && this.m.phaseLeft <= 5) {
      const sec = Math.ceil(this.m.phaseLeft);
      if (sec !== this.lastTick && sec > 0) {
        this.lastTick = sec;
        this.sfx.play('tick', { volume: 0.6, pitch: 0 });
      }
    }
    if (!paused) this.tut?.update(deltaMs / 1000);
    // Пауза, поимка, итоги: кот и палец не лежат поверх карточки и не показывают на её кнопки.
    const modal = this.userPaused || this.caughtPaused || this.ended;
    if (modal) this.tutOverlay?.hide();
    else this.renderTutorial();
    this.renderHint(paused ? 0 : deltaMs / 1000, modal);
    this.menuTimer -= deltaMs;
    if (this.menuTimer <= 0) {
      this.menuTimer = 150;
      this.refreshMenu();
    }

    if (this.m.phase === 'end' && !this.ended) {
      this.ended = true;
      this.hud.hideMenu();
      this.gd.onEnd();
    }
  }

  // ---------------- статика ----------------

  private drawStatic(): void {
    const g = this.add.graphics().setDepth(0);
    const m = this.m;
    const tile = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? Tile.Wall : m.tiles[y][x]);
    const wall = (x: number, y: number) => tile(x, y) === Tile.Wall;
    const hall = (x: number, y: number) => tile(x, y) === Tile.Corridor || tile(x, y) === Tile.Door;
    // Детерминированный «шум» клетки: разнообразие без мигания между кадрами.
    const hash = (x: number, y: number, k = 0) => {
      const n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
      return n - Math.floor(n);
    };
    const shade = (c: number, f: number) => {
      const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
      return (ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255);
    };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = m.tiles[y][x];
        const px = x * TS;
        const py = y * TS;
        switch (t) {
          case Tile.Floor: {
            // Тёплый дощатый пол: 3 доски на клетку, стыки вразбежку.
            const ph = TS / 3;
            for (let i = 0; i < 3; i++) {
              const base = shade(PAL.plank, 0.94 + hash(x, y, i) * 0.12);
              g.fillStyle(base).fillRect(px, py + i * ph, TS, ph);
              g.fillStyle(shade(base, 1.08)).fillRect(px, py + i * ph, TS, 2);
              g.fillStyle(PAL.plankSeam).fillRect(px, py + (i + 1) * ph - 1, TS, 1.5);
              const joint = px + ((((x + (y * 3 + i) * 7) % 3) + 1) * TS) / 4;
              if ((x + i + y) % 2 === 0) g.fillRect(joint, py + i * ph, 1.5, ph);
            }
            break;
          }
          case Tile.Soil: {
            // Грядка: рыхлая земля бороздками и пара ростков, чтобы не путать с ящиком.
            g.fillStyle(PAL.soilRim).fillRoundedRect(px + 2, py + 2, TS - 4, TS - 4, 10);
            g.fillStyle(PAL.soil).fillRoundedRect(px + 5, py + 5, TS - 10, TS - 10, 8);
            g.fillStyle(PAL.soilDark);
            for (let i = 0; i < 3; i++) g.fillEllipse(px + TS / 2, py + 13 + i * 11, TS - 18, 5);
            g.fillStyle(PAL.sprout);
            for (const [sx, sy] of [[0.3, 0.3], [0.68, 0.62]]) {
              g.fillEllipse(px + sx * TS - 3, py + sy * TS, 7, 4).fillEllipse(px + sx * TS + 3, py + sy * TS - 1, 7, 4);
            }
            break;
          }
          case Tile.Corridor:
          case Tile.Door: {
            // Тёмная плитка 2×2 с фаской.
            const q = TS / 2;
            for (let i = 0; i < 4; i++) {
              const qx = px + (i % 2) * q;
              const qy = py + Math.floor(i / 2) * q;
              const base = shade(PAL.hall, 0.92 + hash(x, y, i) * 0.16);
              g.fillStyle(PAL.hallGrout).fillRect(qx, qy, q, q);
              g.fillStyle(base).fillRoundedRect(qx + 1.5, qy + 1.5, q - 3, q - 3, 3);
              g.fillStyle(shade(base, 1.25)).fillRect(qx + 3, qy + 2, q - 6, 1.5);
            }
            break;
          }
          case Tile.Nest: {
            const base = shade(PAL.nest, 0.9 + hash(x, y) * 0.2);
            g.fillStyle(PAL.hallGrout).fillRect(px, py, TS, TS);
            g.fillStyle(base).fillRoundedRect(px + 2, py + 2, TS - 4, TS - 4, 5);
            break;
          }
          case Tile.Wall: {
            // Верх стены: тёмный, с редкой кладкой.
            g.fillStyle(shade(PAL.wallTop, 0.95 + hash(x, y) * 0.1)).fillRect(px, py, TS, TS);
            g.fillStyle(PAL.wallTopLine);
            if (hash(x, y, 3) < 0.5) g.fillRect(px + 6, py + TS * 0.3, TS * 0.4, 2);
            if (hash(x, y, 4) < 0.5) g.fillRect(px + TS * 0.45, py + TS * 0.65, TS * 0.4, 2);
            break;
          }
        }
      }
    }

    // Объём стен: светлая кромка по краю верхушки и передняя грань (обои + плинтус),
    // тень от стены на полу. Второй проход — чтобы кромки ложились поверх соседей.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const px = x * TS;
        const py = y * TS;
        if (wall(x, y)) {
          const edge = PAL.wallEdge;
          if (!wall(x, y - 1)) g.fillStyle(edge).fillRect(px, py, TS, 3);
          if (!wall(x - 1, y)) g.fillStyle(edge).fillRect(px, py, 3, TS);
          if (!wall(x + 1, y)) g.fillStyle(edge).fillRect(px + TS - 3, py, 3, TS);
          if (!wall(x, y + 1)) {
            // Передняя грань: в коридор — тёмные панели, в комнату — обои в полоску.
            const face = TS * 0.42;
            const fy = py + TS - face;
            const toHall = hall(x, y + 1) || tile(x, y + 1) === Tile.Nest;
            g.fillStyle(toHall ? PAL.hallWall : PAL.paper).fillRect(px, fy, TS, face);
            g.fillStyle(toHall ? shade(PAL.hallWall, 0.85) : PAL.paperStripe);
            for (let sx = 4; sx < TS; sx += 12) g.fillRect(px + sx, fy, 4, face - 5);
            g.fillStyle(toHall ? PAL.hallBoard : PAL.board).fillRect(px, py + TS - 5, TS, 5);
            g.fillStyle(PAL.wallEdge).fillRect(px, fy - 2, TS, 2);
          }
        } else if (tile(x, y) !== Tile.Door) {
          // Мягкая тень от стены сверху и сбоку.
          if (wall(x, y - 1)) g.fillStyle(0x000000, 0.18).fillRect(px, py, TS, 7);
          if (wall(x - 1, y)) g.fillStyle(0x000000, 0.12).fillRect(px, py, 5, TS);
          if (wall(x + 1, y)) g.fillStyle(0x000000, 0.08).fillRect(px + TS - 4, py, 4, TS);
        }
      }
    }
    const nest = this.add.circle(m.nest.x * TS, m.nest.y * TS, TS * 1.1, 0x9b5cff, 0.25).setDepth(1);
    this.tweens.add({ targets: nest, alpha: 0.5, scale: 1.15, duration: 1400, yoyo: true, repeat: -1 });

    for (const r of m.rooms) {
      for (const f of r.furniture) {
        const variant = `furniture${f.variant}`;
        const key = firstSprite(this, [variant, 'furniture1', 'furniture2', 'furniture3']);
        if (key) {
          fitImage(this, f.x * TS + TS / 2, f.y * TS + TS / 2, key, TS - 2, TS - 2, 0.5).setDepth(1);
          continue;
        }
        g.fillStyle(0x5a3d2b).fillRoundedRect(f.x * TS + 3, f.y * TS + 3, TS - 6, TS - 6, 6);
        g.fillStyle(0x7a5539).fillRoundedRect(f.x * TS + 7, f.y * TS + 7, TS - 14, TS - 18, 4);
      }
      for (const it of r.items) {
        const cx = it.x * TS + TS / 2;
        const cy = it.y * TS + TS / 2;
        if (hasSprite(this, it.kind)) {
          fitImage(this, cx, cy, it.kind, TS - 6, TS - 6, 0.5).setDepth(1);
          continue;
        }
        g.fillStyle(0xffffff, 0.55).fillCircle(cx, cy, TS * 0.4);
        this.add.text(cx, cy, ITEM_ICON[it.kind], { fontSize: '28px' }).setOrigin(0.5).setDepth(1);
      }
      const s = r.sofa;
      if (hasSprite(this, 'sofa')) {
        fitImage(this, s.x * TS + TS / 2, s.y * TS + TS / 2, 'sofa', TS, TS, 0.5).setDepth(1);
      } else {
        g.fillStyle(0xb8323f).fillRoundedRect(s.x * TS + 2, s.y * TS + 6, TS - 4, TS - 10, 8);
        g.fillStyle(0xe0505c).fillRoundedRect(s.x * TS + 7, s.y * TS + (r.top ? 16 : 10), TS - 14, TS - 24, 6);
      }
      this.sofaLabels.push(this.label(s.x * TS + TS - 6, s.y * TS + 8, '1', 14).setDepth(3));
      const mid = roomCenter(r);
      this.roomLabels.push(this.label(mid.x * TS, mid.y * TS, '', 22).setDepth(25));
    }
    // Запекаем пол и стены в одну текстуру: Graphics перерисовывает все свои
    // прямоугольники каждый кадр, а их тут десятки тысяч — от этого игра лагала.
    const rt = this.add.renderTexture(0, 0, W * TS, H * TS).setOrigin(0, 0).setDepth(0);
    rt.draw(g);
    g.destroy();
  }

  private label(x: number, y: number, text: string, size: number): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color: '#ffffff', stroke: '#1a1030', strokeThickness: 4, resolution: 2 })
      .setOrigin(0.5);
  }

  // ---------------- персонажи ----------------

  private makeChar(c: Character): CharView {
    const shadow = this.add.ellipse(0, 14, 30, 10, 0x000000, 0.25);
    const ring = this.add.ellipse(0, 14, 40, 16).setStrokeStyle(3, 0xffe066, c.isPlayer ? 1 : 0);
    const frames = hasSprite(this, `char${c.look}_idle`) || ['down', 'up', 'side'].some((d) => hasSprite(this, `char${c.look}_${d}_idle`));
    const key = hasSprite(this, `char${c.look}_idle`) ? `char${c.look}_idle` : `char${c.look}`;
    const sprite = hasSprite(this, key);
    // Всё внутри body рисуется относительно ног (y = 0 — пол), чтобы наклон и сжатие шли от земли.
    let g: Phaser.GameObjects.GameObject;
    let img: Phaser.GameObjects.Image | null = null;
    if (sprite) g = img = fitImage(this, 0, 0, key, 44, 56, anchorY(key));
    else {
      const gr = this.add.graphics();
      gr.fillStyle(Phaser.Display.Color.ValueToColor(c.color).darken(25).color).fillCircle(0, -16, 16);
      gr.fillStyle(c.color).fillCircle(0, -18, 14);
      gr.fillStyle(0xffffff).fillCircle(4, -21, 5).fillCircle(-5, -21, 5);
      gr.fillStyle(0x1a1030).fillCircle(5, -21, 2.5).fillCircle(-4, -21, 2.5);
      g = gr;
    }
    const handY = sprite ? -20 : -12;
    const hg = this.add.graphics();
    hg.fillStyle(0x8b5a2b).fillRoundedRect(-2, -20, 4, 22, 2);
    hg.fillStyle(0x8a8f99).fillRoundedRect(-9, -27, 18, 9, 3);
    hg.fillStyle(0xb9bec8).fillRect(-8, -26, 16, 2);
    const hammer = this.add.container(13, handY, [hg]).setVisible(false);
    const sg = this.add.graphics();
    sg.fillStyle(0x8b5a2b).fillRoundedRect(-1.5, -22, 3, 20, 1.5);
    sg.fillStyle(0x9aa3ad).fillRoundedRect(-6, -2, 12, 10, 4);
    const shovel = this.add.container(12, handY + 6, [sg]).setVisible(false).setData('baseY', handY + 6);
    const body = this.add.container(0, 16, [g, hammer, shovel]);
    const name = this.label(0, sprite ? -46 : -30, c.name, 13);
    const emote = this.add.text(0, sprite ? -62 : -46, '', { fontSize: '22px' }).setOrigin(0.5);
    const root = this.add.container(c.x * TS, c.y * TS, [shadow, ring, body, name, emote]).setDepth(10);
    return { c, root, body, hammer, shovel, emote, img, frames, dir: 'down', flip: false, baseScale: img?.scaleX ?? 1, lastHit: -1, off: c.id * 0.37 };
  }

  private renderChars(a: number, time: number): void {
    for (const v of this.charViews) {
      const c = v.c;
      const x = lerp(c.prevX, c.x, a) * TS;
      const y = lerp(c.prevY, c.y, a) * TS;
      v.root.setPosition(x, y).setDepth(10 + y / 10000);
      v.hammer.setVisible(false);
      v.shovel.setVisible(false);
      if (c.spirit) {
        // Дух: полупрозрачный, голубоватый, покачивается в воздухе — без испуга.
        v.root.setAlpha(0.55);
        v.img?.setTint(0xa8d8ff);
        v.emote.setText('');
        if (c.flyTo) this.face(v, c.flyTo.x - c.x, c.flyTo.y - c.y);
        this.setPose(v, 'idle');
        v.body.setRotation(Math.sin(time / 500) * 0.06).setScale(this.flipX(v), 1);
        v.body.y = 16 + Math.sin(time / 300) * 4 - 6;
        continue;
      }
      if (c.caught) {
        // Пойман: испуганный кадр лицом к камере, дрожит и бледнеет.
        v.root.setAlpha(0.35);
        v.emote.setText(v.frames ? '' : '😱');
        v.dir = 'down';
        this.setPose(v, 'scared');
        v.body.setRotation(Math.sin(time / 40) * 0.15).setScale(this.flipX(v), 1);
        v.body.y = 16;
        continue;
      }
      // Вернулся из духов (воскрешение) — снова обычный вид.
      if (v.root.alpha !== 1) {
        v.root.setAlpha(1);
        v.img?.clearTint();
        v.emote.setText('');
      }

      const t = c.task;
      const working = !!t && t.stage === 'work' && !c.path.length;
      const moving = c.path.length > 0;
      let sx = 1;
      let sy = 1;
      let rot = 0;
      let lift = 0;

      if (moving) {
        const next = c.path[0];
        this.face(v, next.x + 0.5 - c.x, next.y + 0.5 - c.y);
        if (this.hasDirFrames(v)) {
          // 4 нарисованных кадра шага; на «проходящих» кадрах тело чуть выше.
          const i = Math.floor(time / ANIM.walkFrameMs + v.off * 4) % 4;
          this.setPose(v, `walk${i + 1}`);
          lift = i % 2 ? 2 : 0;
        } else {
          // Процедурный шаг: подпрыгивание + переваливание + сжатие при приземлении.
          const f = time / ANIM.stepMs + v.off;
          const p = f % 1;
          const hop = Math.sin(p * Math.PI);
          const side = Math.floor(f) % 2 ? 1 : -1;
          lift = hop * (v.frames ? ANIM.hop * 0.6 : ANIM.hop);
          rot = side * ANIM.waddle * hop * (v.frames ? 0.4 : 1);
          this.setPose(v, side > 0 ? 'walk1' : 'walk2');
          sy = 1 - (1 - hop) * 0.1 + hop * 0.04;
          sx = 1 + (1 - hop) * 0.08 - hop * 0.03;
        }
      } else if (working && t.kind) {
        if (t.target) this.face(v, t.target.x + 0.5 - c.x, t.target.y + 0.5 - c.y);
        const period = ANIM.swingMs[t.kind] ?? 380;
        const f = time / period + v.off;
        const p = f % 1;
        const hit = Math.floor(f);
        // Замах 0–0.65, удар 0.65–0.8, отдача дальше.
        const wind = p < 0.65 ? p / 0.65 : 0;
        const strike = p >= 0.65 && p < 0.8 ? (p - 0.65) / 0.15 : p >= 0.8 ? 1 : 0;
        const impact = p >= 0.8 ? 1 - (p - 0.8) / 0.2 : 0;
        if (v.frames) {
          // Нарисованные кадры: замах → удар, лёгкая отдача в момент удара.
          // Дверь чинят гаечным ключом (крутит туда-обратно), остальное — молотком.
          const tool = t.kind === 'repair' && hasSprite(this, `char${c.look}_${v.dir}_wrench1`) ? 'wrench' : 'hammer';
          this.setPose(v, `${tool}${wind ? 1 : 2}`);
          sy = 1 - impact * 0.04;
          sx = 1 + impact * 0.03;
        } else if (t.kind === 'plant') {
          // Копает: присел, лопата ходит вверх-вниз.
          v.shovel.setVisible(true);
          v.shovel.rotation = 0.3 - wind * 0.9 + strike * 0.9;
          v.shovel.y = (v.shovel.getData('baseY') as number) + strike * 4;
          sy = 0.9 - impact * 0.05;
          sx = 1.06;
          rot = 0.1;
        } else {
          // Молоток: замах за голову, удар, тело клонится вперёд и сплющивается.
          v.hammer.setVisible(true);
          v.hammer.rotation = -1.7 * wind + (-1.7 + 2.6 * strike) * (wind ? 0 : 1);
          rot = 0.05 - wind * 0.06 + strike * 0.14;
          sy = 1 + wind * 0.05 - impact * 0.12;
          sx = 1 - wind * 0.03 + impact * 0.1;
        }
        if (hit !== v.lastHit && p >= 0.8) {
          v.lastHit = hit;
          this.roomSound(t.kind === 'repair' ? 'repair' : 'hammer', c.roomId, { volume: 0.6 });
          if (t.target) {
            const tx = (t.target.x + 0.5) * TS;
            const ty = (t.target.y + 0.5) * TS;
            if (t.kind === 'repair') this.puff(tx, ty, 0xffe066, 5, 22, 3);
            else if (t.kind === 'plant') this.puff(tx, ty + 8, 0x7b4a2a, 5, 18, 4);
            else this.puff(tx, ty, 0xc9b79a, 4, 22, 4);
          }
        }
      } else {
        // Стоит: дышит, смотрит туда же, куда смотрел.
        this.setPose(v, 'idle');
        const b = Math.sin(time / ANIM.breatheMs + v.off * 6);
        sy = 1 + b * 0.02;
        sx = 1 - b * 0.012;
      }

      v.body.y = 16 - lift;
      const fx = this.flipX(v);
      v.body.setScale(fx * sx, sy);
      v.body.rotation = rot * fx;
    }
  }

  /** Поворачивает персонажа к точке (dx, dy) в клетках. */
  private face(v: CharView, dx: number, dy: number): void {
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      v.dir = 'side';
      v.flip = dx < 0;
    } else v.dir = dy < 0 ? 'up' : 'down';
  }

  private hasDirFrames(v: CharView): boolean {
    return hasSprite(this, `char${v.c.look}_${v.dir}_idle`);
  }

  /** Зеркалим только вид сбоку (нарисован вправо) и старые кадры без направлений. */
  private flipX(v: CharView): number {
    if (this.hasDirFrames(v)) return v.dir === 'side' && v.flip ? -1 : 1;
    return v.c.facing;
  }

  /**
   * Ставит кадр позы с учётом направления: сначала charN_<dir>_<поза>,
   * если такого листа нет — старый кадр без направления (charN_<поза>).
   */
  private setPose(v: CharView, pose: string): void {
    if (!v.frames || !v.img) return;
    const id = v.c.look;
    const dirKey = `char${id}_${v.dir}_${pose}`;
    let key: string | null = null;
    let dirScale = false;
    if (hasSprite(this, dirKey)) {
      key = dirKey;
      dirScale = true;
    } else {
      const legacy = pose.startsWith('walk') ? (Number(pose.slice(4)) % 2 ? 'walk1' : 'walk2') : pose;
      const k = `char${id}_${legacy}`;
      if (hasSprite(this, k)) key = k;
    }
    if (!key || v.img.texture.key === key) return;
    v.img.setTexture(key);
    v.img.setOrigin(0.5, anchorY(key));
    v.img.setScale(dirScale ? DIR_FRAMES.heightPx / DIR_FRAMES.idlePx : v.baseScale);
  }


  // ---------------- призрак ----------------

  private makeGhost(): void {
    if (hasSprite(this, 'ghost_down_idle')) {
      this.ghostImg = this.add.image(0, 26, 'ghost_down_idle');
      this.setGhostFrame('down_idle');
      this.ghostBody = this.add.container(0, 0, [this.ghostImg]);
      this.ghostLabel = this.label(0, -66, 'ур. 1', 15);
      this.ghostView = this.add.container(0, 0, [this.add.ellipse(0, 26, 44, 12, 0x000000, 0.25), this.ghostBody, this.ghostLabel]).setDepth(20).setVisible(false);
      return;
    }
    if (hasSprite(this, 'ghost')) {
      this.ghostBody = this.add.container(0, 0, [fitImage(this, 0, 26, 'ghost', 64, 76)]);
      this.ghostLabel = this.label(0, -60, 'ур. 1', 15);
      this.ghostView = this.add.container(0, 0, [this.add.ellipse(0, 26, 40, 11, 0x000000, 0.25), this.ghostBody, this.ghostLabel]).setDepth(20).setVisible(false);
      return;
    }
    const g = this.add.graphics();
    g.fillStyle(0xd9ccff).fillCircle(0, -6, 23).fillRect(-23, -6, 46, 22);
    for (const bx of [-15, 0, 15]) g.fillCircle(bx, 16, 8);
    g.fillStyle(0xf4f0ff).fillCircle(0, -8, 20).fillRect(-20, -8, 40, 22);
    for (const bx of [-13, 0, 13]) g.fillCircle(bx, 14, 7);
    g.fillStyle(0x1a1030).fillEllipse(-8, -10, 9, 13).fillEllipse(8, -10, 9, 13).fillEllipse(0, 5, 8, 9);
    g.fillStyle(0xff8fb1, 0.7).fillCircle(-14, 0, 4).fillCircle(14, 0, 4);
    this.ghostBody = this.add.container(0, 0, [g]);
    this.ghostLabel = this.label(0, -44, 'ур. 1', 15);
    this.ghostView = this.add.container(0, 0, [this.add.ellipse(0, 26, 36, 10, 0x000000, 0.25), this.ghostBody, this.ghostLabel]).setDepth(20).setVisible(false);
  }

  /** Стрелка у края экрана к призраку, пока он идёт к моей двери или ломает её, а камера смотрит в другое место. */
  private updateGhostArrow(): void {
    const m = this.m;
    const g = m.ghost;
    const r = m.playerRoom;
    const night = m.phase === 'night' && !m.result && !this.tut;
    const coming = !!r && !m.player.caught && g.targetRoom === r.id && (g.state === 'moving' || g.state === 'attacking' || g.state === 'entering');
    // Духу стрелка нужна всегда: его дело — долететь до призрака, а тот уходит за экран.
    const hunting = m.player.spirit && g.state !== 'hidden' && g.state !== 'dead';
    if (!night || !(coming || hunting)) return this.hud.setGhostArrow(null);
    const cam = this.cameras.main;
    const sx = (this.ghostView.x - cam.worldView.x) * cam.zoom;
    const sy = (this.ghostView.y - TS * 0.6 - cam.worldView.y) * cam.zoom;
    const w = this.scale.width;
    const h = this.scale.height;
    if (sx > 0 && sx < w && sy > 0 && sy < h) return this.hud.setGhostArrow(null);
    // Не под фантиками сверху и не на круглых кнопках снизу.
    const x = Phaser.Math.Clamp(sx, 40, w - 40);
    const top = Math.min(110, h / 3);
    const y = Phaser.Math.Clamp(sy, top, Math.max(top, h - 120));
    this.hud.setGhostArrow({ x, y, angle: Math.atan2(sy - y, sx - x) });
  }

  private renderGhost(a: number, time: number, deltaMs: number): void {
    const g = this.m.ghost;
    const v = this.ghostView;
    if (g.state === 'hidden') {
      v.setVisible(false);
      return;
    }
    if (g.state === 'dead') return;
    v.setVisible(true);
    v.setPosition(lerp(g.prevX, g.x, a) * TS, lerp(g.prevY, g.y, a) * TS);
    // Капкан держит — не покачивается (прилип).
    this.ghostBody.y = g.held > 0 ? 0 : Math.sin(time / 260) * 4;
    this.ghostLabel.setText(`ур. ${g.level}`);
    this.ghostFlash = Math.max(0, this.ghostFlash - deltaMs);
    if (this.ghostImg) {
      this.ghostBody.setAlpha(1);
      this.animateGhostFrames(time);
      return;
    }
    // Старая одиночная картинка: разворот, мигание, рывок при ударе.
    const dx = g.x - g.prevX;
    if (Math.abs(dx) > 0.001) this.ghostBody.scaleX = dx > 0 ? 1 : -1;
    const base = g.state === 'healing' ? 0.55 : 1;
    this.ghostBody.setAlpha(this.ghostFlash > 0 ? 0.5 : base);
    if (g.state === 'attacking') {
      const r = this.m.rooms[g.targetRoom];
      const dir = r.top ? -1 : 1;
      const phase = (g.hitTimer % 1) * Math.PI;
      this.ghostBody.y += dir * Math.max(0, Math.cos(phase)) * 6;
    }
  }

  /**
   * Кадры призрака по состоянию: полёт (сбоку/спиной/лицом), удар по двери
   * в такт настоящим ударам, «ой» от попадания, сон в гнезде, «БУ!», смех на новом уровне.
   */
  private animateGhostFrames(time: number): void {
    const g = this.m.ghost;
    const now = this.time.now;
    const dx = g.x - g.prevX;
    const dy = g.y - g.prevY;
    const moving = Math.abs(dx) + Math.abs(dy) > 0.0005;
    let flip = this.ghostBody.scaleX < 0;
    let frame: string;

    if (g.state === 'healing') {
      frame = 'down_heal';
      flip = false;
    } else if (g.state === 'entering') {
      frame = 'down_boo';
      flip = false;
    } else if (now < this.ghostLaughUntil) {
      frame = 'down_laugh';
      flip = false;
    } else if (g.state === 'attacking') {
      // Верхние двери он бьёт снизу — спиной к нам; нижние — лицом.
      const r = this.m.rooms[g.targetRoom];
      const view = r.top ? 'up' : 'down';
      // Тот же интервал, что в симуляции (холодильник растягивает паузу) — иначе кадр удара залипает.
      const interval = ghostHitIntervalAt(this.m, r);
      const sinceHit = interval - g.hitTimer;
      const p = 1 - g.hitTimer / interval;
      frame = sinceHit < 0.18 ? `${view}_attack2` : p > 0.55 ? `${view}_attack1` : `${view}_idle`;
      flip = false;
      this.ghostBody.y = 0;
    } else if (moving) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        this.ghostDir = 'side';
        flip = dx < 0;
        frame = now < this.ghostHurtUntil ? 'side_hurt' : `side_fly${(Math.floor(time / 110) % 4) + 1}`;
      } else if (dy < 0) {
        this.ghostDir = 'up';
        flip = false;
        frame = `up_fly${(Math.floor(time / 160) % 2) + 1}`;
      } else {
        this.ghostDir = 'down';
        flip = false;
        frame = 'down_idle';
      }
    } else {
      frame = this.ghostDir === 'up' ? 'up_idle' : 'down_idle';
      flip = false;
    }
    this.setGhostFrame(frame);
    this.ghostBody.scaleX = flip ? -1 : 1;
    // Попадание пушки — короткая вспышка поверх любого кадра.
    this.ghostImg!.setTint(this.ghostFlash > 0 ? 0xffd0e0 : 0xffffff);
  }

  /**
   * Звук события в комнате: своя комната — в полную силу, у соседей — тихим фоном,
   * чтобы общий шум стройки не заглушал то, что важно игроку.
   * `at` (клетка) — «слышно, что видно»: событие на экране звучит в полную силу, где бы ни было.
   */
  private roomSound(key: string, roomId: number | null, opts: PlayOpts = {}, others = 0, at?: { x: number; y: number }): void {
    const mine = roomId === null || roomId === this.m.player.roomId || (at !== undefined && this.onScreen(at.x, at.y));
    this.sfx.play(key, { ...opts, volume: (opts.volume ?? 1) * (mine ? 1 : others) });
  }

  /** Клетка видна в камере. */
  private onScreen(x: number, y: number): boolean {
    return this.cameras.main.worldView.contains((x + 0.5) * TS, (y + 0.5) * TS);
  }

  private setGhostFrame(name: string): void {
    const img = this.ghostImg;
    if (!img) return;
    const key = `ghost_${name}`;
    if (img.texture.key === key || !hasSprite(this, key)) return;
    img.setTexture(key).setOrigin(0.5, anchorY(key)).setScale(GHOST_FRAMES.heightPx / GHOST_FRAMES.idlePx);
  }

  // ---------------- постройки ----------------

  /**
   * Картинка пушки для уровня: cannon_<part>_l<N>, а если такой нет — ближайшая младшая (ур. 1 = cannon_<part>).
   * Скин: сначала cannon_<part>_<скин>_l<N> (у скина есть и l1).
   */
  private cannonKey(part: 'base' | 'barrel', level: number, skin = 'classic'): string {
    if (skin !== 'classic') for (let l = level; l >= 1; l--) if (hasSprite(this, `cannon_${part}_${skin}_l${l}`)) return `cannon_${part}_${skin}_l${l}`;
    for (let l = level; l >= 2; l--) if (hasSprite(this, `cannon_${part}_l${l}`)) return `cannon_${part}_l${l}`;
    return `cannon_${part}`;
  }

  /** Картинка поздней постройки для уровня: <kind>_l<N>, нет — ближайшая младшая, ур. 1 = <kind>; нет вовсе — null (рисуем заглушку). */
  private levelKey(kind: LateKind, level: number): string | null {
    for (let l = level; l >= 2; l--) if (hasSprite(this, `${kind}_l${l}`)) return `${kind}_l${l}`;
    return hasSprite(this, kind) ? kind : null;
  }

  /**
   * Заглушки поздних построек (пока нет спрайтов): мультяшно, толстый тёмный контур, читается в клетке.
   * Капкан — тарелка с розовым липким желе и леденцом, верстак — лавка с молотком, холодильник — с магнитом-конфетой.
   * С уровнем добавляется золотая звёздочка-заклёпка (ур. 2 — одна, ур. 3 — две).
   */
  private drawLatePlaceholder(g: Phaser.GameObjects.Graphics, kind: LateKind, level: number): void {
    const ink = 0x1a1030;
    if (kind === 'trap') {
      g.fillStyle(0x000000, 0.2).fillEllipse(0, 13, 38, 10);
      g.fillStyle(0x9aa1b1).fillEllipse(0, 6, 36, 22);
      g.lineStyle(3, ink).strokeEllipse(0, 6, 36, 22);
      g.fillStyle(0xd5d9e2).fillEllipse(0, 4, 28, 14);
      g.fillStyle(0xff7eb6).fillEllipse(-1, 5, 22, 11);
      g.lineStyle(2, ink).strokeEllipse(-1, 5, 22, 11);
      g.fillStyle(0xffc6de).fillEllipse(-5, 3, 8, 3);
      g.fillStyle(0xff7eb6).fillCircle(-11, 11, 2.5).fillCircle(9, 12, 2);
      // Леденец на палочке — приманка.
      g.lineStyle(5, ink).lineBetween(7, 4, 11, -12);
      g.lineStyle(2.5, 0xffffff).lineBetween(7, 4, 11, -12);
      g.fillStyle(0xff4d6d).fillCircle(12, -15, 7);
      g.lineStyle(2.5, ink).strokeCircle(12, -15, 7);
      g.lineStyle(2, 0xffffff).beginPath().arc(12, -15, 3.5, -0.4, Math.PI * 1.2).strokePath();
    } else if (kind === 'workbench') {
      g.fillStyle(0x000000, 0.2).fillEllipse(0, 16, 40, 9);
      g.fillStyle(ink).fillRoundedRect(-17, -1, 8, 18, 2).fillRoundedRect(9, -1, 8, 18, 2);
      g.fillStyle(0x9c6b35).fillRect(-15, 0, 4, 15).fillRect(11, 0, 4, 15);
      g.fillStyle(0xc98a4b).fillRoundedRect(-20, -8, 40, 11, 3);
      g.lineStyle(3, ink).strokeRoundedRect(-20, -8, 40, 11, 3);
      g.lineStyle(1.5, 0x9c6b35).lineBetween(-7, -6, -7, 1).lineBetween(6, -6, 6, 1);
      // Молоток лежит на лавке.
      g.lineStyle(5, ink).lineBetween(-12, -11, 4, -15);
      g.lineStyle(2.5, 0xf3d7a4).lineBetween(-12, -11, 4, -15);
      g.fillStyle(0xaeb4c2).fillRoundedRect(2, -21, 9, 11, 2);
      g.lineStyle(2.5, ink).strokeRoundedRect(2, -21, 9, 11, 2);
    } else {
      g.fillStyle(0x000000, 0.2).fillEllipse(0, 17, 32, 8);
      g.fillStyle(0xeaf6ff).fillRoundedRect(-13, -21, 26, 38, 7);
      g.lineStyle(3, ink).strokeRoundedRect(-13, -21, 26, 38, 7);
      g.lineStyle(2, ink).lineBetween(-13, -6, 13, -6);
      g.fillStyle(0xc9e6fb).fillRoundedRect(-10, -18, 4, 9, 2);
      g.fillStyle(ink).fillRoundedRect(6, -16, 3.5, 7, 1.5).fillRoundedRect(6, -2, 3.5, 10, 1.5);
      // Магнит-конфетка в фантике.
      g.fillStyle(0xff4d6d).fillTriangle(-9, 5, -13, 1, -13, 9).fillTriangle(3, 5, 7, 1, 7, 9);
      g.fillStyle(0xff4d6d).fillCircle(-3, 5, 5);
      g.lineStyle(2, ink).strokeCircle(-3, 5, 5);
      g.fillStyle(0xffffff).fillCircle(-4.5, 3.5, 1.5);
    }
    // Уровень — золотые заклёпки в углу (цифра уровня и так рядом).
    g.fillStyle(0xffd166);
    g.lineStyle(1.5, ink);
    for (let i = 0; i < level - 1; i++) {
      g.fillCircle(-15 + i * 7, -17, 3);
      g.strokeCircle(-15 + i * 7, -17, 3);
    }
  }

  /** Скин комнаты: свой только у игрока, у соседей — обычный. */
  private roomSkin(r: Room, slot: 'door' | 'cannon'): string {
    return r.ownerId === 0 ? (this.m.opts.skin?.[slot] ?? 'classic') : 'classic';
  }

  private makeBuilding(b: Building, skin = 'classic'): Phaser.GameObjects.Container {
    const cx = (b.x + 0.5) * TS;
    const cy = (b.y + 0.5) * TS;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const g = this.add.graphics();
    let barrel: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image | null = null;
    if (b.kind === 'cannon' && hasSprite(this, 'cannon_base')) {
      // Своя модель на каждый уровень, и с уровнем пушка чуть крупнее.
      const size = 38 + 2 * b.level;
      g.fillStyle(0x000000, 0.2).fillEllipse(0, 14, size - 2, 12);
      parts.push(g, fitImage(this, 0, 0, this.cannonKey('base', b.level, skin), size, size, 0.5));
      const barrelKey = this.cannonKey('barrel', b.level, skin);
      if (hasSprite(this, barrelKey)) {
        // Ствол вращается вокруг шарнира на левом конце.
        const img = this.add.image(0, -1, barrelKey).setOrigin(CANNON_PIVOT[barrelKey] ?? 0.17, 0.5);
        barrel = img.setScale((32 + 2 * b.level) / img.width);
        parts.push(barrel);
      }
    } else if (b.kind === 'pumpkin' && hasSprite(this, 'pumpkin')) {
      g.fillStyle(0x000000, 0.2).fillEllipse(0, 14, 36, 10);
      parts.push(g, fitImage(this, 0, 0, 'pumpkin', 40, 40, 0.5));
    } else if (b.kind === 'cannon') {
      g.fillStyle(0x000000, 0.2).fillEllipse(0, 12, 38, 12);
      g.fillStyle(0x4b4f5c).fillCircle(0, 2, 17);
      g.fillStyle(0x6c7280).fillCircle(0, 0, 13);
      barrel = this.add.graphics();
      barrel.fillStyle(0x2d2f36).fillRoundedRect(0, -5, 24, 10, 3);
      barrel.fillStyle(0xff6b6b).fillRect(18, -5, 6, 10);
      parts.push(g, barrel);
    } else if (isLateKind(b.kind)) {
      const k = this.levelKey(b.kind, b.level);
      if (!k) {
        this.drawLatePlaceholder(g, b.kind, b.level);
        parts.push(g);
      } else if (b.kind === 'fridge') {
        // Холодильник стоит, как мебель: основание у низа клетки, макушка чуть выше неё.
        g.fillStyle(0x000000, 0.2).fillEllipse(0, TS / 2 - 5, 32, 8);
        parts.push(g, fitImage(this, 0, TS / 2 - 3, k, TS - 10, TS + 2, 1));
      } else {
        // Капкан — низкая тарелка, верстак — столик: оба примерно в клетку шириной.
        const low = b.kind === 'trap';
        g.fillStyle(0x000000, 0.2).fillEllipse(0, low ? 12 : 15, low ? 38 : 40, low ? 10 : 9);
        parts.push(g, fitImage(this, 0, low ? 2 : 0, k, TS - (low ? 6 : 4), TS - (low ? 12 : 6), 0.5));
      }
    } else {
      // Тыква без спрайта.
      g.fillStyle(0x000000, 0.2).fillEllipse(0, 14, 36, 10);
      g.fillStyle(0xe8740f).fillEllipse(0, 4, 36, 28);
      g.fillStyle(0xff9a2e).fillEllipse(0, 3, 24, 26);
      g.fillStyle(0x3f9b3a).fillRect(-2, -16, 5, 9);
      g.fillStyle(0x2a1600).fillTriangle(-9, 0, -4, -5, -3, 2).fillTriangle(9, 0, 4, -5, 3, 2);
      parts.push(g);
    }
    const lvl = this.label(14, 14, String(b.level), 13);
    parts.push(lvl);
    const box = this.add.container(cx, cy, parts).setDepth(5);
    box.setData('lvl', lvl).setData('barrel', barrel).setData('level', b.level);
    return box;
  }

  private syncBuildings(): void {
    const alive = new Set<string>();
    const g = this.m.ghost;
    const ghostOut = g.state !== 'hidden' && g.state !== 'dead' && g.state !== 'healing';
    for (const r of this.m.rooms) {
      for (const b of r.buildings) {
        const k = key(b.x, b.y);
        alive.add(k);
        let v = this.buildingViews.get(k);
        if (!v) {
          v = this.makeBuilding(b, this.roomSkin(r, 'cannon'));
          this.buildingViews.set(k, v);
          if (this.popKeys.has(k)) {
            v.setScale(0);
            this.tweens.add({ targets: v, scale: 1, duration: 380, ease: 'Back.easeOut' });
          }
        }
        if (v.getData('level') !== b.level) {
          if (b.kind !== 'pumpkin') {
            // Новая модель (пушка, капкан, верстак, холодильник): пересобираем вид, ствол пушки смотрит туда же, где был.
            const rot = (v.getData('barrel') as { rotation: number } | null)?.rotation ?? 0;
            v.destroy();
            v = this.makeBuilding(b, this.roomSkin(r, 'cannon'));
            const nb = v.getData('barrel') as { rotation: number } | null;
            if (nb) nb.rotation = rot;
            this.buildingViews.set(k, v);
            v.setScale(0.7);
            this.tweens.add({ targets: v, scale: 1, duration: 320, ease: 'Back.easeOut' });
          } else {
            v.setData('level', b.level);
            (v.getData('lvl') as Phaser.GameObjects.Text).setText(String(b.level));
          }
        }
        // Капкан на перезарядке — бледный: видно, что сейчас не схватит.
        if (b.kind === 'trap') v.setAlpha(b.cooldown > 0 ? 0.45 : 1);
        const barrel = v.getData('barrel') as { rotation: number } | null;
        if (barrel) {
          if (ghostOut && Math.hypot(g.x - b.x - 0.5, g.y - b.y - 0.5) < 9) {
            barrel.rotation = Math.atan2(g.y - b.y - 0.5, g.x - b.x - 0.5);
          } else barrel.rotation += 0.004;
        }
      }
    }
    for (const [k, v] of this.buildingViews) {
      if (alive.has(k)) continue;
      this.buildingViews.delete(k);
      this.tweens.add({ targets: v, scale: 0, duration: 200, onComplete: () => v.destroy() });
    }
    this.popKeys.clear();
  }

  // ---------------- динамика: двери, полоски, подсветка ----------------

  private renderDynamic(time: number): void {
    const lo = this.low;
    const hi = this.high;
    lo.clear();
    hi.clear();
    const m = this.m;
    const mine = m.playerRoom;
    const now = this.time.now;

    // Крестик на свободных строящихся клетках — видно, куда можно ставить, как в референсе.
    if (m.phase === 'prep' || m.phase === 'night') {
      lo.lineStyle(2.5, 0x9a7048, 0.55);
      for (const r of m.rooms) {
        // Только своя комната: крестики у всех соседей рябили и выглядели как сетка редактора.
        if (r.ownerId !== m.playerId || r.eliminated) continue;
        for (const { x, y } of roomCells(r)) {
          {
            if (x === r.door.inside.x && y === r.door.inside.y) continue;
            if (!walkable(r, x, y)) continue;
            const cx = x * TS + TS / 2;
            const cy = y * TS + TS / 2;
            const s = 5;
            lo.lineBetween(cx - s, cy, cx + s, cy).lineBetween(cx, cy - s, cx, cy + s);
          }
        }
      }
    }

    for (const r of m.rooms) {
      const d = r.door;
      const shake = (this.doorShake.get(r.id) ?? 0) > now ? (Math.random() - 0.5) * 6 : 0;
      const px = d.x * TS + shake;
      const py = d.y * TS;
      const img = this.doorImgs[r.id];
      if (img) {
        const key = d.broken ? firstSprite(this, ['door_broken']) : firstSprite(this, doorKeys(d.level, this.roomSkin(r, 'door')));
        img.setVisible(!!key).setPosition(px + TS / 2, py + TS / 2);
        if (key && img.getData('key') !== key) {
          img.setTexture(key).setData('key', key);
          img.setScale(Math.min(TS / img.width, TS / img.height));
        }
      }
      if (d.broken) {
        if (img?.visible) continue;
        lo.fillStyle(0x5a3d2b).fillRect(px + 2, py + 4, 8, TS - 8).fillRect(px + TS - 10, py + 4, 8, TS - 8);
      } else {
        if (!img?.visible) {
          const col = DOOR_COLORS[Math.min(d.level, DOOR_COLORS.length) - 1];
          lo.fillStyle(col).fillRect(px + 2, py + 2, TS - 4, TS - 4);
          lo.lineStyle(2, 0x000000, 0.25).strokeRect(px + 6, py + 6, TS - 12, TS - 12);
          lo.fillStyle(0xffe066).fillCircle(px + TS - 12, py + TS / 2, 3);
        }
        const frac = d.hp / d.maxHp;
        const by = r.top ? py + TS - 9 : py + 3;
        hi.fillStyle(0x000000, 0.6).fillRect(px + 3, by, TS - 6, 7);
        hi.fillStyle(frac > 0.5 ? 0x5ee06a : frac > 0.25 ? 0xffc94a : 0xff4d4d).fillRect(px + 4, by + 1, (TS - 8) * frac, 5);
      }
      // Пункт меню упёрся в эту дверь — коротко подсвечиваем её жёлтым пульсом.
      const pulseUntil = this.doorPulse.get(r.id) ?? 0;
      if (pulseUntil > now) {
        const a = 0.5 + 0.5 * Math.sin(now / 120);
        hi.lineStyle(3, 0xffe066, a).strokeRoundedRect(px + 1, py + 1, TS - 2, TS - 2, 6);
      }
    }

    for (let i = 0; i < m.rooms.length; i++) {
      const r = m.rooms[i];
      this.sofaLabels[i].setText(String(r.sofa.level));
      const label = this.roomLabels[i];
      if (m.phase === 'pick') {
        const owner = r.ownerId === null ? null : m.chars[r.ownerId];
        label.setVisible(true).setText(owner ? owner.name : 'Свободно');
        if (owner) this.fillRoom(lo, r, owner.color, 0.25);
        else this.outlineRoom(lo, r, 4, 0x7dff7a, 0.45 + 0.35 * Math.sin(time / 200));
      } else {
        label.setVisible(false);
      }
      if (r.eliminated) this.fillRoom(lo, r, 0x000000, 0.35);
    }

    if (mine && m.phase !== 'pick') {
      this.outlineRoom(lo, mine, 3, 0xffe066, 0.55);
    }

    // Прогресс работы и «призрак» будущей постройки.
    for (const c of m.chars) {
      const t = c.task;
      if (!t || t.stage !== 'work' || !t.target) continue;
      const tx = t.target.x * TS;
      const ty = t.target.y * TS;
      if (t.kind === 'build' || t.kind === 'plant') lo.fillStyle(0xffffff, 0.3).fillRoundedRect(tx + 6, ty + 6, TS - 12, TS - 12, 8);
      const p = 1 - t.workLeft / t.workTotal;
      hi.fillStyle(0x000000, 0.6).fillRoundedRect(tx + 4, ty - 8, TS - 8, 8, 3);
      hi.fillStyle(0x7dd3ff).fillRoundedRect(tx + 5, ty - 7, (TS - 10) * p, 6, 3);
    }

    if (this.selected) {
      const s = this.selected;
      lo.lineStyle(3, 0xffe066, 0.9).strokeRoundedRect(s.x * TS + 2, s.y * TS + 2, TS - 4, TS - 4, 6);
      // Радиус своей пушки или капкана (или будущей пушки, пока выбираешь, что строить): куда достаёт.
      const room = m.playerRoom;
      const b = room?.buildings.find((q) => q.x === s.x && q.y === s.y);
      const empty = !b && !!room && occupantAt(room, s.x, s.y) === null && !isSoil(room, s.x, s.y);
      const radius = b?.kind === 'cannon' ? m.cannonRange(b) : b?.kind === 'trap' ? B.trap.radius : empty ? m.cannonRange({ level: 1 }) : 0;
      if (radius) {
        const r = radius * TS;
        const cx = (s.x + 0.5) * TS;
        const cy = (s.y + 0.5) * TS;
        hi.fillStyle(0xffe066, 0.1).fillCircle(cx, cy, r);
        hi.lineStyle(3, 0xffe066, 0.75).strokeCircle(cx, cy, r);
      }
    }

    // «Искорка»: пушка соседа светится, пока горит усиление.
    for (const r of m.rooms) {
      if (r.eliminated) continue;
      for (const b of r.buildings) {
        if (b.kind !== 'cannon' || !b.boost) continue;
        const a = 0.55 + 0.35 * Math.sin(time / 110);
        hi.lineStyle(4, 0xffe066, a).strokeCircle((b.x + 0.5) * TS, (b.y + 0.5) * TS, TS * 0.55);
      }
    }
    // Дух: «Бу!» готово — тонкий круг, докуда достаёт крик.
    const sp = m.player;
    if (sp.spirit && m.phase === 'night' && sp.booCd <= 0) {
      const v = this.charViews[sp.id];
      if (v) hi.lineStyle(2, 0xa8d8ff, 0.35).strokeCircle(v.root.x, v.root.y, B.spirit.booRange * TS);
    }

    const g = m.ghost;
    if (g.state !== 'hidden' && g.state !== 'dead') {
      const gx = this.ghostView.x;
      const gy = this.ghostView.y - (this.ghostImg ? 54 : 36);
      const frac = g.hp / g.maxHp;
      hi.fillStyle(0x000000, 0.6).fillRoundedRect(gx - 28, gy, 56, 8, 3);
      hi.fillStyle(g.state === 'healing' ? 0x7dd3ff : 0xc58aff).fillRoundedRect(gx - 27, gy + 1, 54 * frac, 6, 3);
      // Полоска злости под HP: удары копятся до нового уровня. Почти полна — пульсирует красным.
      // В обучении уровень не растёт — там она была бы застывшим шумом.
      if (!m.script) {
        const anger = Math.min(1, g.xp / ghostXpNeed(m, g.level));
        hi.fillStyle(0x000000, 0.6).fillRoundedRect(gx - 28, gy + 10, 56, 5, 2);
        if (anger >= 0.8) hi.fillStyle(0xff4d4d, 0.6 + 0.4 * Math.sin(time / 90));
        else hi.fillStyle(0xffa53d);
        if (anger > 0) hi.fillRect(gx - 27, gy + 11, 54 * anger, 3);
      }
      // Держит капкан — над головой кружатся три жёлтые звёздочки.
      if (g.held > 0) {
        for (let i = 0; i < 3; i++) {
          const ang = time / 260 + (i * Math.PI * 2) / 3;
          this.star(hi, gx + Math.cos(ang) * 20, gy - 10 + Math.sin(ang) * 6, 6);
        }
      }
    }
  }

  /** Пятиконечная звёздочка с тёмным контуром (радиус r). */
  private star(gr: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
    }
    gr.fillStyle(0xffe066).fillPoints(pts, true);
    gr.lineStyle(1.5, 0x1a1030).strokePoints(pts, true);
  }

  // ---------------- события симуляции → эффекты ----------------

  private handleEvents(events: readonly SimEvent[]): void {
    this.tut?.onEvents(events);
    this.hints?.onEvents(events);
    const m = this.m;
    const mineId = m.player.roomId;
    for (const e of events) {
      switch (e.type) {
        case 'phase':
          if (e.phase === 'prep') {
            // В обучении говорит кот — баннер бы с ним спорил.
            if (!this.tut) this.hud.banner('Готовься! Скоро полночь 🕛');
            this.fitCamera();
          } else if (e.phase === 'night') {
            this.gd.onNightStart?.();
            this.sfx.play('midnight', { pitch: 0 });
            this.hud.banner('Полночь! Призрак вышел! 👻');
            this.cameras.main.shake(400, 0.006);
          }
          break;
        case 'built':
          if (e.roomId === mineId && isLateKind(e.kind)) this.newKinds.delete(e.kind);
          this.roomSound('build', e.roomId, { volume: 0.8 });
          this.popKeys.add(key(e.x, e.y));
          this.puff((e.x + 0.5) * TS, (e.y + 0.5) * TS, 0xfff1c9, 10, 30, 5);
          break;
        case 'upgraded':
          this.roomSound('upgrade', e.roomId, { volume: 0.8 });
          this.floatText((e.x + 0.5) * TS, e.y * TS, '⬆', '#7dff7a');
          this.bounce(this.buildingViews.get(key(e.x, e.y)));
          break;
        case 'sold':
          this.roomSound('sold', e.roomId);
          if (e.roomId === mineId) this.floatText((e.x + 0.5) * TS, e.y * TS, `+${e.refund}🍬`, '#ffe066');
          break;
        case 'doorUpgraded':
        case 'repaired': {
          if (e.type === 'repaired' && e.roomId === mineId) this.missedRepair = false;
          const d = m.rooms[e.roomId].door;
          this.roomSound('upgrade', e.roomId, { volume: 0.8 });
          if (e.type === 'doorUpgraded') this.floatText((d.x + 0.5) * TS, d.y * TS, '⬆', '#7dff7a');
          this.puff((d.x + 0.5) * TS, (d.y + 0.5) * TS, 0xffe066, 8, 26, 4);
          break;
        }
        case 'sofaUpgraded': {
          this.roomSound('upgrade', e.roomId, { volume: 0.8 });
          const s = m.rooms[e.roomId].sofa;
          this.floatText((s.x + 0.5) * TS, s.y * TS, '⬆🍬', '#7dff7a');
          break;
        }
        case 'doorHit': {
          const d = m.rooms[e.roomId].door;
          this.roomSound('door_hit', e.roomId, { volume: 0.5, pitch: 0.12 }, 0.3, d);
          this.doorShake.set(e.roomId, this.time.now + 180);
          this.puff((d.x + 0.5) * TS, (d.y + 0.5) * TS, 0xb07d42, 4, 18, 4);
          if (e.roomId === mineId) {
            this.floatText((d.x + 0.5) * TS, (d.y + (m.rooms[e.roomId].top ? 1.2 : -0.2)) * TS, `-${e.dmg}`, '#ff6b6b');
          }
          break;
        }
        case 'doorBroken': {
          const d = m.rooms[e.roomId].door;
          this.roomSound('door_break', e.roomId, { pitch: 0.02 }, 0.4);
          this.puff((d.x + 0.5) * TS, (d.y + 0.5) * TS, 0x8b5a2b, 16, 50, 6);
          if (e.roomId === mineId) {
            this.hud.banner('Дверь сломана! 😱');
            this.cameras.main.shake(300, 0.01);
          }
          break;
        }
        case 'caught': {
          const c = m.chars[e.charId];
          this.roomSound('ghost_boo', e.roomId, { pitch: 0 }, 0.4);
          this.puff(c.x * TS, c.y * TS, 0xf4f0ff, 14, 40, 6);
          if (!c.isPlayer) this.hud.toast(`Призрак поймал: ${c.name}`);
          break;
        }
        case 'spirit':
          if (e.charId === m.playerId) this.onPlayerCaught();
          break;
        case 'boo':
          this.sfx.play('ghost_boo', { volume: 0.8, pitch: 0.05 });
          this.floatText(this.ghostView.x, this.ghostView.y - 60, 'Бу!', '#a8d8ff');
          this.puff(this.ghostView.x, this.ghostView.y - 20, 0xa8d8ff, 10, 36, 5);
          // Призрак вздрагивает (поворот контейнера; сам ghostBody разворачивается каждый кадр).
          this.tweens.add({
            targets: this.ghostView,
            angle: { from: -10, to: 10 },
            duration: 70,
            yoyo: true,
            repeat: 3,
            onComplete: () => this.ghostView.setAngle(0),
          });
          break;
        case 'spark':
          this.puff((e.x + 0.5) * TS, (e.y + 0.5) * TS, 0xffe066, 12, 34, 5);
          this.floatText((e.x + 0.5) * TS, e.y * TS, 'Искорка!', '#ffe066');
          this.bounce(this.buildingViews.get(key(e.x, e.y)));
          this.sfx.play('upgrade', { volume: 0.7 });
          break;
        case 'revived': {
          const c = m.chars[e.charId];
          this.puff(c.x * TS, c.y * TS, 0xffe066, 16, 44, 6);
          this.sfx.play('popup', { volume: 0.8 });
          this.hud.banner('Снова в комнате!', 3000);
          this.fitCamera();
          break;
        }
        case 'shot':
          this.shoot(e.fromX * TS, e.fromY * TS, e.toX * TS, e.toY * TS);
          this.ghostHurtUntil = this.time.now + 260;
          this.roomSound('shot', e.roomId, { volume: 0.22, pitch: 0.12, throttle: 250 }, 0.3, { x: e.fromX - 0.5, y: e.fromY - 0.5 });
          break;
        case 'ghostLevel':
          this.ghostLaughUntil = this.time.now + 1100;
          this.sfx.play('ghost_laugh', { volume: 0.7, pitch: 0 });
          // Злость набралась: «+1», короткая вспышка и рывок (масштаб — у контейнера, ghostBody разворачивается каждый кадр).
          this.floatText(this.ghostView.x, this.ghostView.y - 72, '+1', '#ff4d4d');
          this.floatText(this.ghostView.x, this.ghostView.y - 50, `Уровень ${e.level}!`, '#c58aff');
          this.ghostFlash = 250;
          this.tweens.add({ targets: this.ghostView, scale: { from: 1.25, to: 1 }, duration: 200, ease: 'Quad.easeOut' });
          break;
        case 'trapped':
          this.floatText(this.ghostView.x, this.ghostView.y - 60, 'Попался!', '#ff7eb6');
          this.puff((e.x + 0.5) * TS, (e.y + 0.5) * TS, 0xff7eb6, 10, 34, 5);
          this.puff(this.ghostView.x, this.ghostView.y, 0xff7eb6, 8, 26, 4);
          this.roomSound('door_hit', e.roomId, { volume: 0.35, pitch: 0.12 }, 0.3, e);
          this.bounce(this.buildingViews.get(key(e.x, e.y)));
          break;
        case 'benchFix':
          if (e.roomId === mineId && e.amount > 0) {
            const d = m.rooms[e.roomId].door;
            this.floatText((d.x + 0.5) * TS, (d.y + (m.rooms[e.roomId].top ? 1.2 : -0.2)) * TS, `+${e.amount}`, '#7dff7a');
          }
          break;
        case 'taskCancelled': {
          // Своё начатое дело бросили новым тапом: «✕» на месте и вернувшиеся конфеты — иначе стройка пропадала молча.
          if (e.charId !== m.playerId || !m.playerRoom) break;
          const r = m.playerRoom;
          const c = e.cmd;
          const at = 'x' in c && c.x !== undefined ? { x: c.x, y: c.y! } : c.type === 'upgradeSofa' ? r.sofa : r.door;
          this.floatText((at.x + 0.5) * TS, at.y * TS, '✕', '#c9c2dc');
          if (e.refund > 0) this.floatText((at.x + 0.5) * TS, (at.y - 0.5) * TS, `+${Math.round(e.refund)}🍬`, '#ffe066');
          break;
        }
        case 'ghostTarget':
          // «Призрак идёт к тебе!» — один раз на выбор двери; в обучении говорит кот.
          if (e.roomId === mineId && !m.player.caught && m.phase === 'night' && !this.tut) {
            this.hud.banner('Призрак идёт к тебе!', 2600);
            this.sfx.chime();
          }
          break;
        case 'ghostRetreat':
          this.sfx.play('ghost_retreat', { volume: 0.6 });
          this.floatText(this.ghostView.x, this.ghostView.y - 50, 'Убегает лечиться!', '#7dd3ff');
          break;
        case 'ghostDead':
          this.sfx.play('ghost_dead');
          if (this.ghostImg) {
            // Тает в лужу, конфеты высыпаются.
            this.setGhostFrame('down_dead');
            this.ghostBody.setScale(1, 1).setY(0);
            this.ghostImg.setTint(0xffffff);
            this.puff(this.ghostView.x, this.ghostView.y + 10, 0xff5fc8, 18, 60, 7);
            this.tweens.add({ targets: this.ghostView, alpha: 0, delay: 900, duration: 900 });
          } else {
            this.puff(this.ghostView.x, this.ghostView.y, 0xf4f0ff, 24, 70, 8);
            this.tweens.add({ targets: this.ghostView, alpha: 0, scale: 1.6, duration: 700 });
          }
          break;
        case 'fail':
          if (e.charId === m.playerId) {
            this.hud.toast(e.msg);
            this.sfx.play('deny', { volume: 0.7 });
          }
          break;
      }
    }
  }

  private shoot(fx: number, fy: number, tx: number, ty: number): void {
    const s: Phaser.GameObjects.Image | Phaser.GameObjects.Arc = hasSprite(this, 'candy_shot')
      ? fitImage(this, fx, fy, 'candy_shot', 18, 18, 0.5).setDepth(25)
      : this.add.circle(fx, fy, 6, 0xff6b6b).setStrokeStyle(2, 0x2d2f36).setDepth(25);
    this.tweens.add({
      targets: s,
      x: tx,
      y: ty,
      angle: 360,
      duration: 160,
      onComplete: () => {
        s.destroy();
        this.ghostFlash = 90;
        this.puff(tx, ty, 0xffc94a, 4, 16, 3);
      },
    });
  }

  private puff(x: number, y: number, color: number, n: number, spread: number, size: number): void {
    for (let i = 0; i < n; i++) {
      const p = this.add.circle(x, y, size * (0.6 + Math.random() * 0.8), color).setDepth(26);
      const ang = Math.random() * Math.PI * 2;
      const dist = spread * (0.4 + Math.random() * 0.6);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        alpha: 0,
        scale: 0.3,
        duration: 380 + Math.random() * 200,
        onComplete: () => p.destroy(),
      });
    }
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const t = this.label(x, y, text, 18).setColor(color).setDepth(40);
    this.tweens.add({ targets: t, y: y - 36, alpha: 0, duration: 1000, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private bounce(v: Phaser.GameObjects.Container | undefined): void {
    if (v) this.tweens.add({ targets: v, scale: { from: 1.35, to: 1 }, duration: 300, ease: 'Back.easeOut' });
  }

  // ---------------- камера и ввод ----------------

  private fitCamera(): void {
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    const zAll = Math.min(w / (W * TS), (h - 70) / (H * TS));
    const room = this.m.playerRoom;
    if (this.m.phase === 'pick' && !this.pickOverview) {
      // Выбор комнаты — крупно у героя: видно 3–4 ближайшие комнаты, остальные — пролистать.
      // Весь этаж целиком слишком мелкий (ребёнку не попасть и не разглядеть).
      const cell = Phaser.Math.Clamp(Math.min(w / 14, h / 11), 40, 76);
      cam.setZoom(Math.max(zAll, cell / TS));
      // В обучении показываем подсказанную комнату, иначе — самого героя.
      const focus = this.tut?.suggestedCenter() ?? { x: this.m.player.x, y: this.m.player.y };
      cam.centerOn(focus.x * TS, focus.y * TS);
      this.clampCamera();
      return;
    }
    if (this.m.player.spirit && zAll * TS < 34) {
      // Дух на маленьком экране: крупно вокруг духа (своя комната уже не его забота).
      cam.setZoom(Math.min(w / (9 * TS), h / (10.5 * TS)));
      cam.centerOn(this.m.player.x * TS, this.m.player.y * TS);
      this.clampCamera();
      return;
    }
    if (this.m.phase === 'pick' || !room || zAll * TS >= 34) {
      cam.setZoom(zAll);
      cam.centerOn((W * TS) / 2, (H * TS) / 2 - 20 / zAll);
      return;
    }
    // Маленький экран: своя комната + коридор перед дверью.
    const zoom = Math.min(w / (9 * TS), h / (10.5 * TS));
    cam.setZoom(zoom);
    // Середина между центром комнаты и дверью: видно и комнату, и коридор перед ней.
    const mid = roomCenter(room);
    cam.centerOn(((mid.x + room.door.front.x) / 2) * TS, ((mid.y + room.door.front.y) / 2) * TS);
  }

  /** Заливка неровной комнаты по клеткам. */
  private fillRoom(gfx: Phaser.GameObjects.Graphics, r: Room, color: number, alpha: number): void {
    gfx.fillStyle(color, alpha);
    for (const c of roomCells(r)) gfx.fillRect(c.x * TS, c.y * TS, TS, TS);
  }

  /** Контур неровной комнаты: рисуем только те края клеток, за которыми уже не комната. */
  private outlineRoom(gfx: Phaser.GameObjects.Graphics, r: Room, width: number, color: number, alpha: number): void {
    gfx.lineStyle(width, color, alpha);
    const o = width / 2;
    for (const c of roomCells(r)) {
      const x = c.x * TS;
      const y = c.y * TS;
      if (!inRoom(r, c.x, c.y - 1)) gfx.lineBetween(x, y + o, x + TS, y + o);
      if (!inRoom(r, c.x, c.y + 1)) gfx.lineBetween(x, y + TS - o, x + TS, y + TS - o);
      if (!inRoom(r, c.x - 1, c.y)) gfx.lineBetween(x + o, y, x + o, y + TS);
      if (!inRoom(r, c.x + 1, c.y)) gfx.lineBetween(x + TS - o, y, x + TS - o, y + TS);
    }
  }

  /**
   * Комната выбрана, герой идёт к ней: камера плавно ведёт героя, иначе он уходил за край
   * экрана и «терялся» (особенно когда комната далеко). Дошёл — обычный вид своей комнаты.
   * Пока игрок сам листает карту — не мешаем.
   */
  private followPlayerToRoom(): void {
    const room = this.m.playerRoom;
    const p = this.m.player;
    // Дух летит, а весь этаж не влез в экран — камера плавно ведёт духа.
    if (p.spirit) {
      if (!p.flyTo || this.mapFits() || this.drag.dragging || this.pinch.active) return;
      const v = this.charViews[p.id];
      const cam = this.cameras.main;
      const mid = cam.midPoint;
      if (v) cam.centerOn(mid.x + (v.root.x - mid.x) * 0.1, mid.y + (v.root.y - mid.y) * 0.1);
      this.clampCamera();
      return;
    }
    const phase = this.m.phase;
    const active = !!room && (phase === 'pick' ? !this.pickOverview : phase === 'prep' && !this.mapFits());
    const walking = active && !inRoom(room!, Math.floor(p.x), Math.floor(p.y));
    if (!walking) {
      if (this.walkFollow) {
        this.walkFollow = false;
        if (active) this.fitCamera();
      }
      return;
    }
    if (this.drag.dragging || this.pinch.active || this.tutFollow) return;
    const v = this.charViews[p.id];
    if (!v) return;
    this.walkFollow = true;
    const cam = this.cameras.main;
    const mid = cam.midPoint;
    cam.centerOn(mid.x + (v.root.x - mid.x) * 0.1, mid.y + (v.root.y - mid.y) * 0.1);
    this.clampCamera();
  }

  /**
   * Не пускать камеру за край карты: экран целиком над картой (запас полклетки на стены),
   * а если карта по оси меньше экрана — она по центру. Центр считаем из scroll, а не из
   * getWorldPoint/midPoint: те обновляются только при отрисовке и сразу после centerOn устаревшие —
   * из-за этого поле «уплывало» и сверху-слева оставалась пустота.
   */
  private clampCamera(): void {
    const cam = this.cameras.main;
    const halfW = cam.width / 2 / cam.zoom;
    const halfH = cam.height / 2 / cam.zoom;
    const pad = TS / 2;
    // Сверху запас больше — под плашками конфет/времени (~70 px экрана), иначе верхние комнаты под ними.
    const padTop = pad + 70 / cam.zoom;
    const axis = (mid: number, half: number, size: number, lo = pad) =>
      size + lo + pad <= 2 * half ? size / 2 : Phaser.Math.Clamp(mid, half - lo, size - half + pad);
    const mx = cam.scrollX + cam.width / 2;
    const my = cam.scrollY + cam.height / 2;
    const cx = axis(mx, halfW, W * TS);
    const cy = axis(my, halfH, H * TS, padTop);
    if (Math.abs(cx - mx) > 0.01 || Math.abs(cy - my) > 0.01) cam.centerOn(cx, cy);
  }

  /**
   * Касания, начатые на самом поле. Палец на кнопке интерфейса (или «зависшее» касание кнопки,
   * которую убрали из-под пальца) — не второй палец щипка: иначе тапы по полю молча глотаются.
   */
  private fingersOnField(): Phaser.Input.Pointer[] {
    const canvas = this.game.canvas;
    return this.input.manager.pointers.filter((q) => q.isDown && q.downElement === canvas);
  }

  private setupInput(): void {
    this.input.addPointer(1);
    const cam = this.cameras.main;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const touching = this.fingersOnField();
      if (touching.length >= 2) {
        const [a, b] = touching;
        this.pinch = { active: true, dist: Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y), zoom: cam.zoom };
        this.drag.dragging = true;
        return;
      }
      this.drag = { down: true, sx: p.x, sy: p.y, scrollX: cam.scrollX, scrollY: cam.scrollY, dragging: false };
      this.downAt = performance.now();
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.pinch.active) {
        const touching = this.fingersOnField();
        if (touching.length >= 2) {
          const [a, b] = touching;
          const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
          cam.setZoom(Phaser.Math.Clamp((this.pinch.zoom * d) / Math.max(1, this.pinch.dist), 0.3, 3));
        }
        return;
      }
      if (!this.drag.down || !p.isDown) return;
      // В обучении камера стоит: иначе палец укажет за край экрана.
      if (this.tut && !this.tut.done) return;
      const dx = p.x - this.drag.sx;
      const dy = p.y - this.drag.sy;
      if (!this.drag.dragging && isDrag(Math.hypot(dx, dy), p.wasTouch)) {
        this.drag.dragging = true;
        this.hud.hideMenu();
      }
      if (this.drag.dragging) {
        cam.scrollX = this.drag.scrollX - dx / cam.zoom;
        cam.scrollY = this.drag.scrollY - dy / cam.zoom;
        this.clampCamera();
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.pinch.active) {
        if (!this.fingersOnField().length) this.pinch.active = false;
        this.drag.down = false;
        return;
      }
      // Второй тап двойного тапа по «Ещё раз» / «Играть духом» не выбирает комнату и не уводит духа (B5).
      const echo = this.downAt < this.hud.inputReadyAt || this.hud.isEchoOfPress(this.downAt, p.x, p.y);
      if (this.drag.down && !this.drag.dragging && !echo) this.tap(p);
      this.drag.down = false;
    });
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.tut && !this.tut.done) return;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), 0.3, 3));
      this.clampCamera();
    });

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,R,H,ESC,SPACE') as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on('keydown-R', () => this.tutRepair());
    kb.on('keydown-H', () => this.fitCamera());
    kb.on('keydown-ESC', () => this.togglePause());
  }

  /** WASD/стрелки — шаг на соседнюю клетку, пока клавиша зажата. */
  /** Ключ: в обучении — только на шаге «Чини дверь». */
  private tutRepair(): void {
    if (this.m.player.spirit || this.userPaused || this.caughtPaused || this.ended) return;
    if (this.tut && !this.tut.allowAction('repair')) return;
    // Целую дверь чинить не нужно — это не ошибка ребёнка: спокойная плашка, без «deny» и красного.
    const d = this.m.playerRoom?.door;
    if (d && !d.broken && d.hp >= d.maxHp) {
      this.hud.toastInfo('Дверь целая');
      this.sfx.play('click', { volume: 0.6 });
      return;
    }
    this.cmd({ type: 'repair' });
  }

  private handleKeys(): void {
    // В обучении ходим только туда, куда показывает кот.
    if (this.tut && !this.tut.done) return;
    const k = this.keys;
    const dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (!dx && !dy) return;
    const c = this.m.player;
    const room = this.m.playerRoom;
    // Дух летит на соседнюю клетку в любую сторону, сквозь стены.
    if (c.spirit) {
      if (!c.flyTo) this.m.command(c.id, { type: 'move', x: Math.floor(c.x) + dx, y: Math.floor(c.y) + dy });
      return;
    }
    if (!room || c.path.length || c.caught || this.m.phase === 'pick') return;
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    // Без диагоналей: сначала пробуем по горизонтали, потом по вертикали.
    const options = [dx ? { x: cx + dx, y: cy } : null, dy ? { x: cx, y: cy + dy } : null];
    const target = options.find((v) => v && walkable(room, v.x, v.y));
    if (target) this.m.command(c.id, { type: 'move', ...target });
  }

  private cmd(c: Cmd): void {
    const err = this.m.command(this.m.playerId, c);
    if (err === 'Не хватает пламени') this.hints?.noteFlameShort();
    if (!err && (c.type === 'boo' || c.type === 'spark')) this.hud.flashAbility(c.type);
    if (err) {
      this.hud.toast(err);
      this.sfx.play('deny', { volume: 0.7 });
    }
  }

  private tap(p: Phaser.Input.Pointer): void {
    const m = this.m;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    let tx = Math.floor(w.x / TS);
    let ty = Math.floor(w.y / TS);
    this.hud.hideMenu();
    this.selected = null;
    // Обучение: пропускаем только тап по тому, чему сейчас учим (промах на соседнюю клетку засчитываем).
    if (this.tut && !this.tut.done) {
      const snap = this.tut.gateTap(tx, ty);
      if (!snap) return;
      tx = snap.x;
      ty = snap.y;
    }

    if (m.phase === 'pick') {
      const r = roomAtCell(m.rooms, tx, ty) ?? roomByDoor(m.rooms, tx, ty);
      if (!r) return;
      const err = m.command(m.playerId, { type: 'pickRoom', roomId: r.id });
      if (err) this.hud.toast(err);
      else this.hud.banner('Это твоя комната! 🏠');
      return;
    }
    if (m.phase === 'end') return;
    if (m.player.spirit) return this.spiritTap(tx, ty);
    const room = m.playerRoom;
    if (!room || m.player.caught) return;

    if (tx === room.door.x && ty === room.door.y) return this.openDoorMenu(room, p);
    if (!inRoom(room, tx, ty)) return;

    const occ = occupantAt(room, tx, ty);
    if (occ === 'sofa') return this.openSofaMenu(room, p);
    if (occ === 'furniture') return;
    if (occ === 'item') {
      const it = room.items.find((i) => i.x === tx && i.y === ty)!;
      this.hud.toast(ITEM_INFO[it.kind]);
      return;
    }
    if (occ) return this.openBuildingMenu(room, occ, p);

    // Пустая клетка: идём туда и предлагаем построить.
    this.cmd({ type: 'move', x: tx, y: ty });
    if (tx === room.door.inside.x && ty === room.door.inside.y) return;
    this.selected = { x: tx, y: ty };
    this.openMenu(p, () => {
      if (!isSoil(room, tx, ty)) {
        // Пол: пушка и поздние постройки (капкан, верстак, холодильник). В обучении поздних нет вовсе — иначе вечный замок.
        // Запертые (дверь ещё низкая) не показываем вовсе: яркий пункт с замком ребёнок жмёт и не понимает,
        // почему «не работает». Откроется — баннер «Новое!» и метка в меню.
        const kinds: BuildKind[] = m.script ? ['cannon'] : ['cannon', ...LATE_KINDS.filter((k) => !m.buildLocked(room, k))];
        return { title: 'Пол', options: kinds.map((kind) => this.buildOption(room, kind, tx, ty)) };
      }
      const cost = m.buildCost('pumpkin');
      const locked = !m.opts.flameUnlocked;
      const opt: MenuOption = {
        id: 'build:pumpkin',
        icon: '🎃',
        label: 'Тыква',
        cost,
        note: locked ? 'во 2-м матче' : undefined,
        disabled: locked,
        ...this.affordance(room, cost),
        onPick: () => this.cmd({ type: 'build', kind: 'pumpkin', x: tx, y: ty }),
      };
      const err = m.canPlace(room, tx, ty, 'pumpkin');
      if (err && !locked) {
        opt.disabled = true;
        opt.note = err;
      }
      return { title: 'Грядка', options: [opt] };
    });
  }

  /**
   * Открывает меню у точки нажатия. `build` вызывается снова, пока меню открыто
   * (см. update): накопились конфеты — кнопка сама становится доступной.
   * Вернул null — объекта больше нет, меню закрывается.
   */
  private openMenu(p: { x: number; y: number }, build: () => { title: string; options: MenuOption[] } | null): void {
    // В обучении в меню только тот пункт, которому учим.
    const tut = this.tut;
    if (tut) {
      const raw = build;
      build = () => {
        const b = raw();
        return b && { ...b, options: tut.filterMenu(b.options) };
      };
    }
    const first = build();
    if (!first || !first.options.length) return;
    this.menuBuild = build;
    this.hud.showMenu(p.x, p.y, first.title, first.options);
  }

  private refreshMenu(): void {
    if (!this.menuBuild) return;
    if (!this.hud.menuOpen) {
      this.menuBuild = null;
      return;
    }
    const next = this.menuBuild();
    if (!next) {
      this.hud.hideMenu();
      this.menuBuild = null;
      this.selected = null;
      return;
    }
    this.hud.refreshMenu(next.title, next.options);
  }

  private openDoorMenu(room: Room, p: Phaser.Input.Pointer): void {
    const m = this.m;
    this.openMenu(p, () => {
      const d = room.door;
      const up = m.doorUpgradeCost(room);
      const options: MenuOption[] = [
        {
          id: 'upgradeDoor',
          icon: '⬆',
          label: 'Улучшить',
          cost: up,
          note: up ? undefined : 'макс.',
          disabled: !up || d.broken,
          ...this.affordance(room, up),
          onPick: () => this.cmd({ type: 'upgradeDoor' }),
        },
        {
          id: 'repair',
          icon: '🔧',
          label: 'Чинить',
          // Целая дверь — пункт просто серый, без красной плашки «+30%» (она читалась как ошибка).
          note: d.hp >= d.maxHp ? undefined : d.repairCd > 0 ? `через ${Math.ceil(d.repairCd)} с` : `+${Math.round(B.repair.amount * 100)}%`,
          disabled: d.broken || d.hp >= d.maxHp || d.repairCd > 0,
          onPick: () => this.cmd({ type: 'repair' }),
        },
      ];
      return { title: `Дверь · ур. ${d.level} · ${Math.ceil(d.hp)}/${d.maxHp}`, options };
    });
  }

  private openSofaMenu(room: Room, p: Phaser.Input.Pointer): void {
    const m = this.m;
    this.openMenu(p, () => {
      const up = m.sofaUpgradeCost(room);
      const need = m.sofaBlockedBy(room);
      const opt: MenuOption = need
        ? { id: 'upgradeSofa', icon: '⬆', label: 'Больше конфет', lockDoor: need, onPick: () => this.pulseDoor(room, need) }
        : {
            id: 'upgradeSofa',
            icon: '⬆',
            label: 'Больше конфет',
            cost: up,
            note: up ? undefined : 'макс.',
            disabled: !up,
            ...this.affordance(room, up),
            onPick: () => this.cmd({ type: 'upgradeSofa' }),
          };
      return {
        title: `Диван · ур. ${room.sofa.level} · 🍬 ${m.incomeOf(room).toFixed(1)}/с`,
        options: [opt],
      };
    });
  }

  /**
   * «Новое!»: поздняя постройка открылась дверью — баннер один раз за матч на каждую.
   * Открытое уже к получению комнаты (усилитель двери) — молча. В обучении их нет вовсе.
   */
  private checkUnlocks(): void {
    const m = this.m;
    const r = m.playerRoom;
    if (m.script || !r || r.eliminated) return;
    for (const kind of LATE_KINDS) {
      if (this.seenUnlock.has(kind) || m.buildLocked(r, kind)) continue;
      this.seenUnlock.add(kind);
      if (!this.unlockPrimed) continue;
      this.newKinds.add(kind);
      this.hud.banner(`Новое! ${BUILD_INFO[kind].label} в меню постройки`, 3500);
      this.sfx.play('popup', { volume: 0.8 });
    }
    this.unlockPrimed = true;
  }

  /**
   * Хватает ли на покупку: poor + «сколько есть» для банки у кнопки; нажали, а не хватает пламени —
   * повод для подсказки про тыкву (CHILD_UX, части 2–3).
   */
  private affordance(room: Room, cost: Cost | null | undefined): Pick<MenuOption, 'poor' | 'have' | 'onPoor'> {
    if (!cost) return { poor: false };
    const poor = !this.m.canAfford(room, cost);
    return {
      poor,
      have: { candy: room.candy, flame: room.flame },
      onPoor: () => {
        if (room.candy + 1e-6 >= cost.candy) this.hints?.noteFlameShort();
      },
    };
  }

  /** Пункт «построить kind» на полу: заперт дверью — замок и пульс двери, упёрся в правило — серый с причиной. */
  private buildOption(room: Room, kind: BuildKind, x: number, y: number): MenuOption {
    const m = this.m;
    const { label, desc } = BUILD_INFO[kind];
    const id = `build:${kind}`;
    const icon = kind === 'cannon' ? '💥' : '';
    const need = m.buildLocked(room, kind);
    if (need) return { id, icon, label, desc, lockDoor: need, onPick: () => this.pulseDoor(room, need) };
    const cost = m.buildCost(kind);
    const isNew = isLateKind(kind) && this.newKinds.has(kind);
    const opt: MenuOption = { id, icon, label, desc, cost, isNew, ...this.affordance(room, cost), onPick: () => this.cmd({ type: 'build', kind, x, y }) };
    const err = m.canPlace(room, x, y, kind);
    if (err) {
      opt.disabled = true;
      opt.note = err;
    }
    return opt;
  }

  /**
   * Пункт меню упёрся в дверь: красная плашка с причиной (одной подсветки двери игроки не понимали)
   * и короткий пульс своей двери — где она.
   */
  private pulseDoor(room: Room, need: number): void {
    this.hud.toast(`Сначала дверь до ур. ${need}`);
    this.doorPulse.set(room.id, this.time.now + 1500);
    this.sfx.play('click', { volume: 0.7 });
  }

  private openBuildingMenu(room: Room, b: Building, p: Phaser.Input.Pointer): void {
    const m = this.m;
    this.selected = { x: b.x, y: b.y };
    this.openMenu(p, () => {
      // Постройку могли продать — тогда меню закрываем.
      if (!room.buildings.includes(b)) return null;
      const up = m.upgradeCost(b);
      const pct = (v: number) => +(v * 100).toFixed(1);
      const title =
        b.kind === 'cannon'
          ? `Пушка · ур. ${b.level} · урон ${Math.round(m.cannonDamage(b))} · радиус ${m.cannonRange(b).toFixed(1)}`
          : b.kind === 'trap'
            ? `Капкан · ур. ${b.level} · держит ${trapHold(b.level)} с`
            : b.kind === 'workbench'
              ? `Верстак · ур. ${b.level} · +${pct(benchHeal(b.level))}% / ${B.workbench.interval} с`
              : b.kind === 'fridge'
                ? `Холодильник · ур. ${b.level} · реже на ${pct(fridgeSlow(b.level))}%`
                : `Тыква · ур. ${b.level}`;
      return {
        title,
        options: [
          {
            id: 'upgrade',
            icon: '⬆',
            label: 'Улучшить',
            cost: up,
            note: up ? undefined : 'макс.',
            disabled: !up,
            ...this.affordance(room, up),
            onPick: () => this.cmd({ type: 'upgrade', x: b.x, y: b.y }),
          },
          {
            // Уничтожает постройку: приглушённый второстепенный пункт с корзиной и подтверждением.
            id: 'sell',
            icon: '',
            label: 'Убрать',
            note: `🍬${m.sellValue(b)}`,
            secondary: true,
            confirm: 'Точно убрать?',
            onPick: () => this.cmd({ type: 'sell', x: b.x, y: b.y }),
          },
        ],
      };
    });
  }
}
