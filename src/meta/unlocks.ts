import type { BuildKind } from '../sim/types';

/**
 * Постепенное открытие построек между матчами (BUILDING_PROGRESSION.md).
 * Единственный источник: сохранение, меню, экран «Новое!» и симуляция берут открытое отсюда.
 * Чистые функции над данными сохранения — без интерфейса, чтобы проверять тестами.
 *
 * Два разных замка — не путать:
 * - глобальный (здесь): постройку ещё ни разу не открывали — в меню её нет вовсе;
 * - матчевый (Match.buildLocked): открыта, но в этом матче нужна дверь N-го уровня — в меню с замком «🚪N».
 */

/** Постройки, которые открываются по ходу игры (пушка есть всегда). */
export type UnlockKind = Extract<BuildKind, 'pumpkin' | 'trap' | 'workbench' | 'fridge'>;

/** Порядок открытия: после скольких завершённых матчей (обучение не считается). */
export const BUILDING_UNLOCKS: readonly { kind: UnlockKind; afterMatches: number }[] = [
  { kind: 'pumpkin', afterMatches: 1 },
  { kind: 'trap', afterMatches: 2 },
  { kind: 'workbench', afterMatches: 3 },
  { kind: 'fridge', afterMatches: 4 },
];

export const UNLOCK_KINDS: readonly UnlockKind[] = BUILDING_UNLOCKS.map((u) => u.kind);

/**
 * Состояние одной постройки:
 * - locked — ещё не открыта (в меню её нет);
 * - justUnlocked — только что открылась, экран «Новое!» ещё не показан;
 * - seen — экран показан, в меню ждёт метка «Новое!»;
 * - available — открыта, метку в меню уже видели.
 */
export type UnlockState = 'locked' | 'justUnlocked' | 'seen' | 'available';

export type Unlocks = Record<UnlockKind, UnlockState>;

const STATES: readonly UnlockState[] = ['locked', 'justUnlocked', 'seen', 'available'];

export const isUnlockKind = (k: string): k is UnlockKind => (UNLOCK_KINDS as readonly string[]).includes(k);

/**
 * Состояние из сохранения. Поля нет — сохранение сделано до этой системы: всё, что игрок уже
 * заработал сыгранными матчами, открыто сразу и молча (без экранов «Новое!» и меток) — никакого каскада.
 * Битые значения чинятся по той же логике, а заработанное, но не открытое — открывается как новое (grantUnlocks).
 */
export function loadUnlocks(raw: unknown, matches: number): Unlocks {
  const legacy = !raw || typeof raw !== 'object';
  const src = (legacy ? {} : raw) as Record<string, unknown>;
  const u = {} as Unlocks;
  for (const { kind, afterMatches } of BUILDING_UNLOCKS) {
    const v = src[kind];
    if (typeof v === 'string' && (STATES as readonly string[]).includes(v)) u[kind] = v as UnlockState;
    else u[kind] = matches >= afterMatches ? 'available' : 'locked';
  }
  grantUnlocks(u, matches);
  return u;
}

/** Открыть всё, что заработано этим числом завершённых матчей. Вернёт только что открытые. */
export function grantUnlocks(u: Unlocks, matches: number): UnlockKind[] {
  const fresh: UnlockKind[] = [];
  for (const { kind, afterMatches } of BUILDING_UNLOCKS) {
    if (u[kind] === 'locked' && matches >= afterMatches) {
      u[kind] = 'justUnlocked';
      fresh.push(kind);
    }
  }
  return fresh;
}

export const isOpen = (u: Unlocks, kind: UnlockKind): boolean => u[kind] !== 'locked';

/** Постройки, которых у игрока ещё нет (для симуляции и меню). */
export const lockedKinds = (u: Unlocks): UnlockKind[] => UNLOCK_KINDS.filter((k) => !isOpen(u, k));

/** Постройки, у которых в меню должна гореть метка «Новое!». */
export const badgeKinds = (u: Unlocks): UnlockKind[] => UNLOCK_KINDS.filter((k) => u[k] === 'seen');

/** Какой экран «Новое!» показать следующим (по порядку открытия), или null. */
export const nextPreview = (u: Unlocks): UnlockKind | null => UNLOCK_KINDS.find((k) => u[k] === 'justUnlocked') ?? null;

/** Экран «Новое!» пройден — больше не показываем, в меню ждёт метка. */
export function markPreviewSeen(u: Unlocks, kind: UnlockKind): void {
  if (u[kind] === 'justUnlocked') u[kind] = 'seen';
}

/**
 * Кнопки экрана «Новое!». Экран считается пройденным только после нажатия («Попробовать!» или «В меню»),
 * а не в момент показа: закрыли вкладку или перезагрузили прямо на экране — при следующем входе он покажется снова.
 * Каждая кнопка сначала отмечает экран и сохраняет, потом ведёт дальше.
 */
export function previewButtons(
  u: Unlocks,
  kind: UnlockKind,
  save: () => void,
  onTry: () => void,
  onMenu?: () => void,
): { onTry: () => void; onMenu?: () => void } {
  const done = (next: () => void) => () => {
    markPreviewSeen(u, kind);
    save();
    next();
  };
  return { onTry: done(onTry), onMenu: onMenu && done(onMenu) };
}

/** Пункт увидели в меню — метка «Новое!» больше не нужна. Только из seen: экран «Новое!» не пропускается. */
export function markBadgeSeen(u: Unlocks, kind: UnlockKind): void {
  if (u[kind] === 'seen') u[kind] = 'available';
}

/**
 * Что из открытий нужно матчу: какие постройки игроку закрыты. Пламя в матче есть всегда (соседи играют как раньше);
 * без тыквы у игрока его цены в пламени переводятся в конфеты (Match.flameOpen).
 */
export function matchUnlocks(u: Unlocks): { lockedKinds: UnlockKind[] } {
  return { lockedKinds: lockedKinds(u) };
}

/**
 * Как закончился матч. Завершённым (двигает открытия) считается только тот, что дошёл до итогов,
 * и выход после поимки: игрок уже проиграл, это конец его матча (и награда за поражение, см. exitReward).
 * Выход живым через паузу — не завершение: так нельзя «нафармить» открытия входом и выходом.
 */
export type MatchOutcome = 'win' | 'teamWin' | 'lose' | 'caughtExit' | 'quit';

export const isCompleted = (o: MatchOutcome): boolean => o !== 'quit';

/**
 * Записать конец матча в прогресс: счётчик матчей и открытия. Вернёт только что открытые постройки.
 * Все пути конца матча идут через эту функцию, отдельно счётчик не трогаем.
 */
export function recordMatchOutcome(p: { matches: number; unlocks: Unlocks }, o: MatchOutcome): UnlockKind[] {
  if (!isCompleted(o)) return [];
  p.matches++;
  return grantUnlocks(p.unlocks, p.matches);
}
