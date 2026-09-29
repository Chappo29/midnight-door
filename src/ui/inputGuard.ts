/**
 * Защита от сквозных и повторных нажатий (GAME_AUDIT.md, B5; GAME_AUDIT_RESEARCH.md, N15).
 * Без DOM и Phaser — чтобы проверять тестами.
 */

/** Сколько мс после смены экрана или открытия меню нажатия глотаются: второй тап двойного тапа. */
export const INPUT_GUARD_MS = 350;

/**
 * Повторный тап ребёнка: у детей 3–6 лет двойной тап растянут до ~0,85 с, поэтому одного окна
 * в 350 мс мало. Нажатие по пункту меню в течение этого времени и рядом с точкой, где меню
 * открыли, считаем тем же самым тапом, а не выбором.
 */
export const HOLDOVER_MS = 1000;
export const HOLDOVER_PX = 60;

/**
 * Сколько px может «уехать» палец, чтобы это всё ещё был тап, а не перетаскивание карты.
 * Детский тап смазанный: при 12 px тап со сдвигом 14–20 px молча терялся (регрессия R2).
 * 24 CSS px ≈ 3–4 мм на телефоне — перетаскивание начинается чуть позже, щипок не затронут.
 */
export const TAP_SLOP_TOUCH_PX = 24;
export const TAP_SLOP_MOUSE_PX = 12;

/** Сдвиг dist px — уже перетаскивание карты (touch — палец, иначе мышь). */
export function isDrag(dist: number, touch: boolean): boolean {
  return dist > (touch ? TAP_SLOP_TOUCH_PX : TAP_SLOP_MOUSE_PX);
}

interface Pt {
  x: number;
  y: number;
}

/** Нажатие в point в момент now — повтор тапа, открывшего меню в openedAt у точки anchor. */
export function isHoldover(now: number, openedAt: number, anchor: Pt, point: Pt): boolean {
  return now - openedAt < HOLDOVER_MS && Math.hypot(point.x - anchor.x, point.y - anchor.y) < HOLDOVER_PX;
}

/**
 * Нажатие — повтор прошлого тапа по кнопке, которой при том тапе ещё не было: между ними сменилось
 * окно (screenChangedAt позже прошлого нажатия), а палец почти там же и почти сразу. Так второй тап
 * по «Выйти в меню» не нажимает «Кошмар» в открывшемся меню, а двойной тап в магазине не покупает дважды.
 */
export function isEchoAfterScreenChange(now: number, last: Pt & { t: number }, screenChangedAt: number, point: Pt): boolean {
  return screenChangedAt > last.t && isHoldover(now, last.t, last, point);
}

/** Состояние защиты окна от сквозных и повторных нажатий (Hud). */
export interface PressGuardState {
  /** Последнее **принятое** нажатие. */
  last: Pt & { t: number };
  /** До этого момента нажатия глотаются (окно или меню только что сменились). */
  readyAt: number;
  /** Когда последний раз сменилось окно. */
  screenChangedAt: number;
}

/**
 * Пропустить ли нажатие по интерфейсу. trusted — настоящее нажатие пальцем/мышью (MouseEvent.detail > 0),
 * а не click() из кода или клавиатуры. Запоминается только принятое нажатие: проглоченный второй тап не должен
 * становиться «прошлым» для третьего — иначе тройной тап ребёнка (0 / 80 / 680 мс) проходил сквозь смену окна
 * и нажимал кнопку нового экрана (FINAL_QA_REPORT.md, QA-04). Цепочка повторов считается от первого тапа.
 */
export function acceptPress(s: PressGuardState, now: number, point: Pt, trusted: boolean): boolean {
  const echo = trusted && isEchoAfterScreenChange(now, s.last, s.screenChangedAt, point);
  if (now < s.readyAt || echo) return false;
  if (trusted) s.last = { t: now, ...point };
  return true;
}

/**
 * Куда поставить меню по вертикали на узком экране: не на палец (иначе второй тап попадает в пункт),
 * а над ним или под ним — где больше места.
 */
export function menuTopAwayFromFinger(y: number, menuH: number, viewH: number, edge: number, gap = 48): number {
  const above = y - gap - menuH;
  const below = y + gap;
  const top = y > viewH / 2 ? above : below;
  return Math.max(edge, Math.min(viewH - menuH - edge, top));
}

/**
 * «Зависшие» касательные указатели: Phaser считает их прижатыми (active), а пальца с таким identifier на экране
 * уже нет — браузер потерял «палец отпущен» (Chrome на Android: жест скриншота, шторка, долгое нажатие).
 * Мышь (id 0) не трогаем. live — identifier всех пальцев на экране прямо сейчас (TouchEvent.touches).
 */
export function staleTouchPointers<P extends { id: number; active: boolean; identifier: number }>(pointers: readonly P[], live: Iterable<number>): P[] {
  const now = new Set(live);
  return pointers.filter((q) => q.id !== 0 && q.active && !now.has(q.identifier));
}

/**
 * Сдвинуть меню так, чтобы оно не закрывало avoid (своя дверь с призраком во время атаки): сначала вбок —
 * справа или слева от двери, где влезает; не влезает — над или под ней; нигде не влезает — оставить как было.
 * Всё в одних координатах; edge — поля у краёв экрана.
 */
export function avoidRect(
  menu: { left: number; top: number; w: number; h: number },
  avoid: { left: number; top: number; right: number; bottom: number } | null,
  viewW: number,
  viewH: number,
  edge: number,
): { left: number; top: number } {
  const { left, top, w, h } = menu;
  const hits = (l: number, t: number) => !!avoid && l < avoid.right && l + w > avoid.left && t < avoid.bottom && t + h > avoid.top;
  if (!avoid || !hits(left, top)) return { left, top };
  const fitX = (l: number) => l >= edge && l + w <= viewW - edge;
  const fitY = (t: number) => t >= edge && t + h <= viewH - edge;
  const gap = 8;
  const spots = [
    { left: avoid.right + gap, top },
    { left: avoid.left - gap - w, top },
    { left, top: avoid.bottom + gap },
    { left, top: avoid.top - gap - h },
  ];
  return spots.find((s) => fitX(s.left) && fitY(s.top) && !hits(s.left, s.top)) ?? { left, top };
}
