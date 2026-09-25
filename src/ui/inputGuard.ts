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
