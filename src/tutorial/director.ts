import type { Match } from '../sim/match';
import { guardSlots } from '../sim/map';
import { roomCenter } from '../sim/roomgrid';
import type { Cmd, SimEvent, Vec } from '../sim/types';
import { STEPS, pickCannonCell, type Step, type Target, type TutorialCtx } from './steps';

/** Что режиссёр отдаёт наружу для рисования (без Phaser и DOM — так его можно тестировать). */
export interface TutorialView {
  step: Step;
  index: number;
  total: number;
  target: Target;
  /** Сколько раз уже подсказывали бездействующему (растёт каждые NUDGE секунд). */
  nudge: number;
}

/**
 * Действия, которым учат шаги. Пока игрок идёт их делать или делает, палец убран, а тапы по полю
 * не проходят: повторный тап по пальцу превращался в «иди сюда» и отменял стройку — петля (GAME_AUDIT.md, B6).
 */
const BUSY: ReadonlySet<Cmd['type']> = new Set(['build', 'upgrade', 'sell', 'upgradeDoor', 'repair', 'upgradeSofa']);

/** Через сколько секунд бездействия подсказывать сильнее (Sesame Workshop: 6–8 с). */
const NUDGE = 7;

/** Событие для воронки аналитики: на каком шаге дети бросают. */
export type TutorialTrack = (name: string, data: Record<string, unknown>) => void;

/**
 * Ведёт «Ночь 0» по шагам: включает ручки симуляции, решает, куда показывать,
 * какие тапы и пункты меню пропускать. Без Phaser: GameScene только спрашивает.
 */
export class TutorialDirector {
  private i = 0;
  private ctx: TutorialCtx;
  private idle = 0;
  private finished = false;

  constructor(
    private readonly m: Match,
    private readonly track: TutorialTrack = () => {},
  ) {
    // Показываем на комнату, где под пушку есть хорошее место у двери.
    const rooms = [...m.rooms].sort((a, b) => guardSlots(b) - guardSlots(a));
    const suggested = rooms.find((r) => pickCannonCell(m, r)) ?? rooms[0];
    this.ctx = { suggested, cannonCell: null, t: 0 };
    this.track('tut_start', {});
    this.enterStep();
  }

  get done(): boolean {
    return this.finished;
  }

  get step(): Step {
    return STEPS[this.i];
  }

  view(): TutorialView | null {
    if (this.finished) return null;
    const target: Target = this.busy ? { kind: 'none' } : this.step.target(this.m, this.ctx);
    return { step: this.step, index: this.i, total: STEPS.length, target, nudge: Math.floor(this.idle / NUDGE) };
  }

  /** Каждый тик симуляции: события этого тика. */
  onEvents(events: readonly SimEvent[]): void {
    if (this.finished) return;
    if (this.step.done(this.m, this.ctx, events)) this.next();
  }

  /** Каждый кадр: время шага и бездействие. */
  update(dt: number): void {
    if (this.finished) return;
    this.ctx.t += dt;
    this.idle += dt;
    // Условия, не связанные с событиями (дошёл до комнаты, набрал конфет).
    if (this.step.done(this.m, this.ctx, [])) this.next();
  }

  /** Можно ли тапнуть по клетке. Любой тап сбрасывает бездействие. */
  allowTap(x: number, y: number): boolean {
    return this.gateTap(x, y) !== null;
  }

  /**
   * Куда засчитать тап: сама клетка, цель шага (если промахнулись на клетку рядом —
   * пальцы у детей неточные) или null — тап игнорируем.
   */
  gateTap(x: number, y: number): Vec | null {
    if (this.finished) return { x, y };
    this.idle = 0;
    const s = this.step;
    if (s.tapToContinue) {
      this.next();
      return null;
    }
    if (this.busy) return null;
    const t = s.target(this.m, this.ctx);
    const ok = (cx: number, cy: number) =>
      s.allowCell ? s.allowCell(this.m, this.ctx, cx, cy) : t.kind === 'cell' && t.at.x === cx && t.at.y === cy;
    if (ok(x, y)) return { x, y };
    if (t.kind === 'cell' && Math.abs(t.at.x - x) <= 1 && Math.abs(t.at.y - y) <= 1 && ok(t.at.x, t.at.y)) return { x: t.at.x, y: t.at.y };
    return null;
  }

  /** Игрок уже выполняет действие шага (идёт к месту или работает руками). */
  private get busy(): boolean {
    const t = this.m.player.task;
    return !!t && BUSY.has(t.cmd.type);
  }

  /** Центр подсказанной комнаты (пока идёт выбор) — туда смотрит камера. */
  suggestedCenter(): Vec | null {
    if (this.finished || this.m.player.roomId !== null) return null;
    return roomCenter(this.ctx.suggested);
  }

  /** Можно ли сейчас нажать кнопку/клавишу действия (ключ R, кнопка 🔧). */
  allowAction(kind: 'repair'): boolean {
    if (this.finished) return true;
    // С шага «Чини дверь!» и дальше ключ работает: его только что научили, и он горит красным,
    // когда обучение держит дверь просевшей (раньше на «Улучши пушку» нажатия молча глотались).
    return this.i >= STEPS.findIndex((s) => s.id === kind);
  }

  /** Оставить в меню только то, чему сейчас учим. */
  filterMenu<T extends { id?: string }>(options: T[]): T[] {
    if (this.finished || !this.step.menu) return options;
    const allowed = this.step.menu;
    return options.filter((o) => o.id && allowed.includes(o.id));
  }

  /** Взрослый нажал «пропустить». */
  skip(): void {
    if (this.finished) return;
    this.track('tut_skip', { step: this.step.id, index: this.i });
    this.finish();
  }

  /** Ушёл со страницы посреди обучения — тоже шаг воронки. */
  quit(): void {
    if (!this.finished) this.track('tut_quit', { step: this.step.id, index: this.i });
  }

  private next(): void {
    this.track('tut_step_done', { step: this.step.id, index: this.i, sec: Math.round(this.ctx.t) });
    this.i++;
    if (this.i >= STEPS.length) {
      this.track('tut_complete', {});
      this.finish();
      return;
    }
    this.enterStep();
  }

  private enterStep(): void {
    this.ctx.t = 0;
    this.idle = 0;
    const r = this.m.playerRoom;
    if (r && !this.ctx.cannonCell) this.ctx.cannonCell = pickCannonCell(this.m, r);
    this.step.enter?.(this.m, this.ctx);
    this.track('tut_step', { step: this.step.id, index: this.i });
  }

  private finish(): void {
    this.finished = true;
    // Дальше — обычные правила, но призрак из обучения остаётся слабым.
    const s = this.m.script;
    if (s) {
      s.holdPhase = false;
      s.ghostHitHold = false;
      s.hpFloor = 0;
      s.incomeMul = 1;
    }
  }
}
