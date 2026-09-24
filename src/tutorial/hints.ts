import type { Match } from '../sim/match';
import type { SimEvent } from '../sim/types';
import type { Pose, Target } from './steps';

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
/** Первые секунды ночи — баннер «Полночь!», не перебиваем. */
const NIGHT_QUIET = 5;

interface Rule {
  id: string;
  text: string;
  pose: Pose;
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
}

const mine = (m: Match) => m.playerRoom;

/** Порядок = важность: сначала то, от чего можно проиграть прямо сейчас. */
const RULES: Rule[] = [
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
    id: 'level',
    text: '👻⬆ Призрак вырос! Укрепи дверь',
    pose: 'oh',
    when: (m, s) => (s.leveled && mine(m) ? { kind: 'cell', at: mine(m)!.door } : null),
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
    text: '💰 Нет места? Продай старое',
    pose: 'point',
    when: (m) => {
      const r = mine(m);
      if (!r || m.phase === 'pick' || m.buildCells(r, 'cannon').length) return null;
      const weakest = [...r.buildings].sort((a, b) => a.level - b.level)[0];
      return weakest && m.canAfford(r, m.buildCost('cannon')) ? { kind: 'cell', at: weakest } : null;
    },
  },
  {
    id: 'flame',
    text: '🎃 Тыква на грядке даёт 🔥',
    pose: 'point',
    when: (m, s) => {
      const r = mine(m);
      const soil = r?.soil.find((c) => !r.buildings.some((b) => b.x === c.x && b.y === c.y));
      return m.opts.flameUnlocked && m.phase === 'prep' && s.prepTime > 3 && soil ? { kind: 'cell', at: soil } : null;
    },
  },
  {
    id: 'pan',
    text: '✋ Двигай карту пальцем',
    pose: 'wave',
    when: (m, s) => (s.touch && m.phase === 'prep' && s.prepTime > 10 ? { kind: 'none' } : null),
  },
];

export class HintDirector {
  private state: HintState;
  private sinceLast = GAP;
  private current: { hint: Hint; left: number } | null = null;
  private nightTime = 0;
  /** Правила проверяем не каждый кадр: «нет места» перебирает клетки комнаты. */
  private checkIn = 0;

  constructor(
    private readonly m: Match,
    private readonly seen: Set<string>,
    private readonly onSeen: (id: string) => void,
    touch = false,
  ) {
    this.state = { silentSiege: 0, retreated: false, leveled: false, leftMe: false, touch, prepTime: 0 };
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
    const sieged = g.state === 'attacking' && g.targetRoom === m.player.roomId;
    this.state.silentSiege = sieged ? this.state.silentSiege + dt : 0;

    if (this.current) {
      this.current.left -= dt;
      if (this.current.left <= 0) this.current = null;
      this.state.retreated = this.state.leveled = this.state.leftMe = false;
      return this.current?.hint ?? null;
    }
    this.sinceLast += dt;
    this.checkIn -= dt;
    const oneShot = this.state.retreated || this.state.leveled || this.state.leftMe;
    const quiet = m.phase === 'night' && this.nightTime < NIGHT_QUIET;
    if ((this.checkIn <= 0 || oneShot) && this.sinceLast >= GAP && !quiet && !m.player.caught && m.phase !== 'end') {
      this.checkIn = 0.5;
      for (const r of RULES) {
        if (this.seen.has(r.id)) continue;
        const target = r.when(m, this.state);
        if (!target) continue;
        this.seen.add(r.id);
        this.onSeen(r.id);
        this.sinceLast = 0;
        this.current = { hint: { id: r.id, text: r.text, pose: r.pose, target }, left: HINT_SHOW };
        break;
      }
    }
    // Разовые поводы живут один кадр: не сказали сразу — неактуально.
    this.state.retreated = this.state.leveled = this.state.leftMe = false;
    return this.current?.hint ?? null;
  }
}
