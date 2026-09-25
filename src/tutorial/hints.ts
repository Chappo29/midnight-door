import { B } from '../sim/balance';
import type { Match } from '../sim/match';
import type { BuildKind, SimEvent } from '../sim/types';
import { pickCannonCell, type Pose, type Target } from './steps';

/**
 * Подсказки после обучения: то, чему «Ночь 0» не учит, объясняем в момент,
 * когда это впервые важно. Каждая — один раз, не мешают играть, не чаще раза в GAP секунд.
 */
export interface Hint {
  id: string;
  text: string;
  pose: Pose;
  target: Target;
}

/** Сколько подсказка висит на экране, с. */
export const HINT_SHOW = 6;
/** Минимум между подсказками, с. */
const GAP = 20;
/** Минимум после прошлой подсказки, если ребёнок только что упёрся в «не хватает пламени», с. */
const FLAME_GAP = 4;
/** Первые секунды ночи — баннер «Полночь!», не перебиваем. */
const NIGHT_QUIET = 5;

interface Rule {
  id: string;
  text: string;
  pose: Pose;
  /**
   * Сколько раз показывать: 'profile' (по умолчанию) — один раз за всю жизнь профиля;
   * 'match' — не чаще раза за матч; 'repeat' — каждый раз, когда сработал повод.
   */
  once?: 'profile' | 'match' | 'repeat';
  /** Только в первых матчах после обучения («мостик»: делай, как учили). */
  firstMatchesOnly?: boolean;
  /** Для духа (игрока поймали): остальные правила пойманному не показываем. */
  spirit?: boolean;
  /** Держать на экране, пока повод не пропал (ребёнок сделал, что просили), но не дольше sticky секунд. */
  sticky?: number;
  /** Подходит ли момент (события этого кадра уже учтены в state). */
  when: (m: Match, s: HintState) => Target | null;
}

/** То, что подсказкам нужно помнить между кадрами. */
interface HintState {
  /** Сколько секунд призрак ломится в мою дверь, а мои пушки молчат. */
  silentSiege: number;
  retreated: boolean;
  leveled: boolean;
  leftMe: boolean;
  touch: boolean;
  prepTime: number;
  nightTime: number;
  /** Игрок только что упёрся в «не хватает пламени». */
  flameShort: boolean;
}

const mine = (m: Match) => m.playerRoom;

/**
 * Спокойный момент для подсказки «на будущее» (тыквы, новые постройки): подготовка или ночь,
 * когда призрак не у моей двери и она цела хотя бы наполовину — иначе перебьём подсказку про ремонт.
 */
const calm = (m: Match, s: HintState) => {
  const r = mine(m);
  if (!r) return false;
  if (m.phase === 'prep') return s.prepTime > 3;
  return m.phase === 'night' && m.ghost.targetRoom !== r.id && r.door.hp >= r.door.maxHp * 0.5;
};

/**
 * Открылась поздняя постройка (дверь дошла до нужного уровня), а у игрока её ещё нет —
 * показать пальцем, куда её можно поставить. Клетки без rng (placeableCells): правила зовутся из вида.
 */
const lateBuild = (kind: 'trap' | 'workbench' | 'fridge') => (m: Match, s: HintState) => {
  const r = mine(m);
  if (!r || r.door.level < B.unlock[kind] || r.buildings.some((b) => b.kind === (kind as BuildKind))) return null;
  if (!calm(m, s)) return null;
  const at = m.placeableCells(r, kind)[0];
  return at ? { kind: 'cell' as const, at } : null;
};

/**
 * Порядок = важность: сначала то, от чего можно потерять дверь прямо сейчас.
 * Пойманному (дух) подсказки не показываем: строить он не может, всё объясняет карточка поимки.
 */
const RULES: Rule[] = [
  {
    // После первой поимки: призрак далеко — сначала «лети к нему» (палец на призрака, у края — стрелка).
    id: 'spirit',
    text: '👻 Ты дух! Лети к призраку',
    pose: 'point',
    spirit: true,
    sticky: 10,
    when: (m) => (m.player.spirit && m.phase === 'night' && !m.result && !m.booInRange(m.player) ? { kind: 'ghost' } : null),
  },
  {
    // Долетел, «Бу!» готово — теперь жать (раньше палец звал жать серую кнопку, которая молчала).
    id: 'spirit-boo',
    text: '👻 Жми «Бу!»',
    pose: 'point',
    spirit: true,
    // Раз за матч, а не раз в жизни: духом играют редко, и к моменту «долетел» подсказка должна быть.
    once: 'match',
    sticky: 8,
    when: (m) => (m.player.spirit && m.phase === 'night' && !m.result && m.player.booCd <= 0 && m.booInRange(m.player) ? { kind: 'dom', sel: '#boo' } : null),
  },
  {
    id: 'repair',
    text: '🔧 Дверь слабеет — жми ключ!',
    pose: 'oh',
    when: (m) => {
      const d = mine(m)?.door;
      const busy = m.player.task?.kind === 'repair';
      return m.phase === 'night' && d && !d.broken && d.repairCd <= 0 && !busy && d.hp < d.maxHp * 0.4 ? { kind: 'dom', sel: '#repair' } : null;
    },
  },
  {
    // Первые матчи: нет пушки, а на неё хватает — «поставь, как учили» (важнее тыкв и остального).
    id: 'basic-cannon',
    text: '💥 Поставь пушку у двери',
    pose: 'point',
    // Держим, пока пушки нет (не 6 с), и напоминаем снова, если ребёнок так и не поставил.
    once: 'repeat',
    sticky: 25,
    firstMatchesOnly: true,
    when: (m, s) => {
      const r = mine(m);
      if (!r || r.buildings.some((b) => b.kind === 'cannon') || !m.canAfford(r, m.buildCost('cannon'))) return null;
      if (m.phase === 'prep' ? s.prepTime < 4 : m.phase !== 'night') return null;
      const at = pickCannonCell(m, r);
      return at ? { kind: 'cell', at } : null;
    },
  },
  {
    // Первые матчи: пушка есть, а дверь всё ещё 1-го уровня и на улучшение хватает.
    id: 'basic-door',
    text: '🚪 Сделай дверь крепче',
    pose: 'point',
    once: 'match',
    sticky: 20,
    firstMatchesOnly: true,
    when: (m, s) => {
      const r = mine(m);
      if (!r || m.phase !== 'night' || s.nightTime < 15 || r.door.broken || r.door.level > 1) return null;
      if (!r.buildings.some((b) => b.kind === 'cannon')) return null;
      const cost = m.doorUpgradeCost(r);
      return cost && m.canAfford(r, cost) ? { kind: 'cell', at: r.door } : null;
    },
  },
  {
    id: 'level',
    text: '👻⬆ Призрак вырос! Укрепи дверь',
    pose: 'oh',
    // Пока нет ни одной пушки, «укрепи дверь» — не в том порядке: сначала «Поставь пушку».
    when: (m, s) => (s.leveled && mine(m)?.buildings.some((b) => b.kind === 'cannon') ? { kind: 'cell', at: mine(m)!.door } : null),
  },
  {
    id: 'range',
    text: '🎯 Пушки не достают — ставь ближе к двери',
    pose: 'point',
    when: (m, s) => {
      const b = mine(m)?.buildings.find((q) => q.kind === 'cannon');
      return s.silentSiege > 5 && b ? { kind: 'cell', at: b } : null;
    },
  },
  {
    id: 'retreat',
    text: '👻 Убегает лечиться. Он вернётся!',
    pose: 'point',
    when: (_m, s) => (s.retreated ? { kind: 'ghost' } : null),
  },
  {
    id: 'left',
    text: '👋 Призрак ушёл к соседу. Готовься!',
    pose: 'wave',
    when: (_m, s) => (s.leftMe ? { kind: 'none' } : null),
  },
  {
    id: 'sell',
    text: '🗑 Нет места? Убери старое',
    pose: 'point',
    when: (m) => {
      const r = mine(m);
      // hasBuildCell не трогает rng симуляции (buildCells тасует клетки) — подсказка спрашивает каждый кадр.
      if (!r || m.phase === 'pick' || m.hasBuildCell(r, 'cannon')) return null;
      const weakest = [...r.buildings].sort((a, b) => a.level - b.level)[0];
      return weakest && m.canAfford(r, m.buildCost('cannon')) ? { kind: 'cell', at: weakest } : null;
    },
  },
  {
    id: 'flame',
    text: '🎃 Посади тыкву — она даёт 🔥',
    pose: 'point',
    // Только когда ребёнок сам упёрся в «не хватает пламени» — и пока не посадил первую тыкву.
    once: 'repeat',
    when: (m, s) => {
      const r = mine(m);
      if (!s.flameShort || !r || !m.opts.flameUnlocked || r.buildings.some((b) => b.kind === 'pumpkin')) return null;
      if (!m.canAfford(r, m.buildCost('pumpkin'))) return null;
      const soil = r.soil.find((c) => !r.buildings.some((b) => b.x === c.x && b.y === c.y));
      return soil ? { kind: 'cell', at: soil } : null;
    },
  },
  {
    id: 'trap',
    text: 'Ловушка-липучка задержит призрака',
    pose: 'point',
    when: lateBuild('trap'),
  },
  {
    id: 'workbench',
    text: 'Верстак сам чинит дверь',
    pose: 'point',
    when: lateBuild('workbench'),
  },
  {
    id: 'fridge',
    text: 'Холодильник: призрак стучит реже',
    pose: 'point',
    when: lateBuild('fridge'),
  },
  {
    id: 'pan',
    text: '✋ Двигай карту пальцем',
    pose: 'wave',
    // Второстепенное: только когда пушка уже стоит, — иначе перебивает «Поставь пушку у двери».
    when: (m, s) => (s.touch && m.phase === 'prep' && s.prepTime > 10 && mine(m)?.buildings.some((b) => b.kind === 'cannon') ? { kind: 'none' } : null),
  },
];

export class HintDirector {
  private state: HintState;
  private sinceLast = GAP;
  private current: { hint: Hint; left: number; spirit?: boolean; rule?: Rule; sticky?: number } | null = null;
  private nightTime = 0;
  /** Правила проверяем не каждый кадр: «нет места» перебирает клетки комнаты. */
  private checkIn = 0;
  /** Подсказки once: 'match', уже показанные в этом матче. */
  private shownThisMatch = new Set<string>();

  /**
   * firstMatches — один из первых матчей после обучения: включает «мостик» (пушка, дверь),
   * который повторяет уроки «Ночи 0» тогда, когда ребёнок их упускает.
   */
  constructor(
    private readonly m: Match,
    private readonly seen: Set<string>,
    private readonly onSeen: (id: string) => void,
    touch = false,
    private readonly firstMatches = false,
  ) {
    this.state = { silentSiege: 0, retreated: false, leveled: false, leftMe: false, touch, prepTime: 0, nightTime: 0, flameShort: false };
  }

  /** Ребёнок упёрся в «не хватает пламени» — повод рассказать про тыкву. */
  noteFlameShort(): void {
    this.state.flameShort = true;
  }

  /** События тика: запоминаем то, о чём стоит сказать. */
  onEvents(events: readonly SimEvent[]): void {
    const me = this.m.player.roomId;
    for (const e of events) {
      if (e.type === 'ghostRetreat') this.state.retreated = true;
      else if (e.type === 'ghostLevel') this.state.leveled = true;
      else if (e.type === 'ghostLeft' && e.roomId === me) this.state.leftMe = true;
      else if (e.type === 'shot' && e.roomId === me) this.state.silentSiege = 0;
    }
  }

  /** Каждый кадр. Возвращает подсказку, которую надо показывать сейчас (или null). */
  update(dt: number): Hint | null {
    const m = this.m;
    const g = m.ghost;
    if (m.phase === 'prep') this.state.prepTime += dt;
    if (m.phase === 'night') this.nightTime += dt;
    this.state.nightTime = this.nightTime;
    const sieged = g.state === 'attacking' && g.targetRoom === m.player.roomId;
    this.state.silentSiege = sieged ? this.state.silentSiege + dt : 0;

    // Поймали или матч кончился — недосказанная подсказка больше не нужна (иначе висит поверх итогов).
    // Подсказка для духа — наоборот, только пойманному.
    if (this.current && (m.phase === 'end' || m.player.caught !== !!this.current.spirit)) this.current = null;
    if (this.current) {
      this.current.left -= dt;
      const c = this.current;
      if (c.rule?.sticky) {
        // Держим, пока повод есть (ребёнок ещё не сделал), но не дольше sticky; сделал — сразу убираем.
        c.sticky = (c.sticky ?? 0) + dt;
        const still = c.rule.when(m, this.state);
        if (!still || c.sticky > c.rule.sticky) this.current = null;
        else if (c.left < 1) c.left = 1;
      } else if (c.left <= 0) this.current = null;
      this.state.retreated = this.state.leveled = this.state.leftMe = false;
      return this.current?.hint ?? null;
    }
    this.sinceLast += dt;
    this.checkIn -= dt;
    const oneShot = this.state.retreated || this.state.leveled || this.state.leftMe;
    const quiet = m.phase === 'night' && this.nightTime < NIGHT_QUIET;
    const caught = m.player.caught;
    // Духу объяснение нужно сразу, без паузы между подсказками.
    // «Не хватает пламени» — ребёнок застрял прямо сейчас: ждём не GAP, а пару секунд.
    const gap = this.state.flameShort ? FLAME_GAP : GAP;
    const ready = caught ? m.player.spirit : this.sinceLast >= gap && !quiet;
    if ((this.checkIn <= 0 || oneShot || this.state.flameShort) && ready && m.phase !== 'end') {
      this.checkIn = 0.5;
      for (const r of RULES) {
        if (!!r.spirit !== caught || (r.firstMatchesOnly && !this.firstMatches)) continue;
        const once = r.once ?? 'profile';
        if ((once === 'profile' && this.seen.has(r.id)) || (once === 'match' && this.shownThisMatch.has(r.id))) continue;
        const target = r.when(m, this.state);
        if (!target) continue;
        if (once === 'profile') {
          this.seen.add(r.id);
          this.onSeen(r.id);
        } else this.shownThisMatch.add(r.id);
        this.sinceLast = 0;
        this.current = { hint: { id: r.id, text: r.text, pose: r.pose, target }, left: HINT_SHOW, spirit: r.spirit, rule: r, sticky: 0 };
        break;
      }
    }
    // «Не хватает пламени» — повод на пару секунд: не сказали сразу (идёт другая подсказка) — не копим.
    this.state.flameShort = false;
    // Разовые поводы живут один кадр: не сказали сразу — неактуально.
    this.state.retreated = this.state.leveled = this.state.leftMe = false;
    return this.current?.hint ?? null;
  }
}
