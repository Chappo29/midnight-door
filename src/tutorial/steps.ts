import { B } from '../sim/balance';
import type { Match } from '../sim/match';
import { inRoom, roomCenter } from '../sim/roomgrid';
import type { Room, SimEvent, Vec } from '../sim/types';

/** Поза кота-помощника: машет, показывает, радуется, удивляется. */
export type Pose = 'wave' | 'point' | 'cheer' | 'oh';

/** На что показывает палец: клетка мира, элемент интерфейса, призрак или ничего. */
export type Target = { kind: 'cell'; at: Vec } | { kind: 'dom'; sel: string } | { kind: 'ghost' } | { kind: 'none' };

/** Общие данные шага, которые режиссёр вычисляет один раз (комната, клетка под пушку). */
export interface TutorialCtx {
  /** Комната, на которую показываем при выборе. */
  suggested: Room;
  /** Клетка под первую пушку: рядом с дверью, чтобы пушка точно достала до призрака. */
  cannonCell: Vec | null;
  /** Секунд с начала шага. */
  t: number;
}

export interface Step {
  id: string;
  /** Эмодзи + до 6 слов: дети читают картинку, взрослые — текст. */
  text: string;
  pose: Pose;
  target: (m: Match, c: TutorialCtx) => Target;
  /** Какие пункты меню видны (id опций); остальные спрятаны. */
  menu?: string[];
  /** Куда палец, пока меню открыто (id опции). */
  menuOpt?: string;
  /** Можно ли тапнуть по этой клетке мира. По умолчанию — только по цели шага. */
  allowCell?: (m: Match, c: TutorialCtx, x: number, y: number) => boolean;
  /** Тап в любом месте завершает шаг (вступление). */
  tapToContinue?: boolean;
  enter?: (m: Match, c: TutorialCtx) => void;
  done: (m: Match, c: TutorialCtx, events: readonly SimEvent[]) => boolean;
}

const room = (m: Match) => m.playerRoom!;
const has = (events: readonly SimEvent[], type: SimEvent['type']) => events.some((e) => e.type === type);
const cellAt = (v: Vec): Target => ({ kind: 'cell', at: v });
const same = (a: Vec, x: number, y: number) => a.x === x && a.y === y;

/**
 * Сценарий «Ночи 0». Порядок как в Plants vs Zombies: сначала одно действие,
 * цель («защити дверь») — после первого успеха. Каждое действие — ровно одна кнопка.
 */
export const STEPS: Step[] = [
  {
    id: 'intro',
    text: '👻 Ночью придёт призрак!',
    pose: 'oh',
    target: () => ({ kind: 'none' }),
    allowCell: () => false,
    tapToContinue: true,
    done: (_m, c) => c.t > 4,
  },
  {
    id: 'pick',
    text: '👆 Выбери комнату',
    pose: 'point',
    target: (_m, c) => cellAt(floorVec(roomCenter(c.suggested))),
    // Только показанная комната (или её дверь): тапы мимо ничего не делают.
    allowCell: (_m, c, x, y) => inRoom(c.suggested, x, y) || same(c.suggested.door, x, y),
    done: (m) => m.player.roomId !== null,
  },
  {
    id: 'walk',
    text: '🏃 Бежим домой!',
    pose: 'wave',
    target: () => ({ kind: 'none' }),
    allowCell: () => false,
    done: (m) => {
      const p = m.player;
      return m.phase === 'prep' && !p.path.length && inRoom(room(m), Math.floor(p.x), Math.floor(p.y));
    },
  },
  {
    id: 'sofa',
    text: '🛋️ Нажми на диван',
    pose: 'point',
    target: (m) => cellAt(room(m).sofa),
    menu: ['upgradeSofa'],
    menuOpt: 'upgradeSofa',
    enter: (m) => m.grant(room(m), m.sofaUpgradeCost(room(m))?.candy ?? 0),
    done: (_m, _c, ev) => has(ev, 'sofaUpgraded'),
  },
  {
    id: 'candy',
    text: '🍬 Диван даёт конфеты!',
    pose: 'cheer',
    target: () => ({ kind: 'dom', sel: '#candy' }),
    allowCell: () => false,
    enter: (m) => {
      m.script!.incomeMul = 6;
    },
    done: (m, c) => {
      const need = m.buildCost('cannon').candy;
      if (c.t > 5) m.grant(room(m), need);
      if (m.canAfford(room(m), m.buildCost('cannon'))) {
        m.script!.incomeMul = 1;
        return true;
      }
      return false;
    },
  },
  {
    id: 'cannon',
    text: '💥 Поставь пушку тут',
    pose: 'point',
    target: (m, c) => cellAt(c.cannonCell ?? room(m).door.inside),
    allowCell: (_m, c, x, y) => !!c.cannonCell && same(c.cannonCell, x, y),
    menu: ['build:cannon'],
    menuOpt: 'build:cannon',
    enter: (m) => m.grant(room(m), m.buildCost('cannon').candy),
    done: (_m, _c, ev) => ev.some((e) => e.type === 'built' && e.kind === 'cannon'),
  },
  {
    id: 'door',
    text: '🚪 Сделай дверь крепче',
    pose: 'point',
    target: (m) => cellAt(room(m).door),
    allowCell: (m, _c, x, y) => same(room(m).door, x, y),
    menu: ['upgradeDoor'],
    menuOpt: 'upgradeDoor',
    enter: (m) => m.grant(room(m), m.doorUpgradeCost(room(m))?.candy ?? 0),
    done: (_m, _c, ev) => has(ev, 'doorUpgraded'),
  },
  {
    id: 'midnight',
    text: '🕛 Полночь! Призрак идёт!',
    pose: 'oh',
    target: () => ({ kind: 'ghost' }),
    allowCell: () => false,
    enter: (m) => {
      const s = m.script!;
      s.ghostTarget = m.player.roomId;
      s.holdPhase = false;
      m.phaseLeft = Math.min(m.phaseLeft, 3);
    },
    done: (m) => m.ghost.state === 'attacking' && m.ghost.targetRoom === m.player.roomId,
  },
  {
    id: 'repair',
    text: '🔧 Чини дверь!',
    pose: 'point',
    // Кнопка ключа; меню двери тоже годится (там есть «Чинить»).
    target: () => ({ kind: 'dom', sel: '#repair' }),
    allowCell: (m, _c, x, y) => same(room(m).door, x, y),
    menu: ['repair'],
    menuOpt: 'repair',
    enter: (m) => {
      room(m).door.repairCd = 0;
    },
    done: (m, _c, ev) => {
      const d = room(m).door;
      // Пусть сначала побьёт: показываем ключ, когда дверь просела; дальше ждём нажатия.
      if (d.hp < d.maxHp * 0.6) m.script!.ghostHitHold = true;
      if (has(ev, 'repaired')) {
        m.script!.ghostHitHold = false;
        return true;
      }
      return false;
    },
  },
  {
    id: 'upcannon',
    text: '⬆ Улучши пушку!',
    pose: 'point',
    target: (m) => cellAt(room(m).buildings.find((b) => b.kind === 'cannon') ?? room(m).sofa),
    allowCell: (m, _c, x, y) => room(m).buildings.some((b) => b.kind === 'cannon' && same(b, x, y)),
    menu: ['upgrade'],
    menuOpt: 'upgrade',
    enter: (m) => {
      const b = room(m).buildings.find((q) => q.kind === 'cannon');
      const up = b && m.upgradeCost(b);
      if (up) m.grant(room(m), up.candy);
    },
    done: (m, _c, ev) => {
      if (!ev.some((e) => e.type === 'upgraded')) return false;
      // Дальше призрака можно победить.
      m.script!.hpFloor = 0;
      return true;
    },
  },
  {
    id: 'finale',
    text: '💥 Пушки бьют призрака!',
    pose: 'cheer',
    target: () => ({ kind: 'ghost' }),
    allowCell: () => true,
    done: (_m, _c, ev) => has(ev, 'ghostDead'),
  },
];

const floorVec = (v: Vec): Vec => ({ x: Math.floor(v.x), y: Math.floor(v.y) });

/** Клетка под первую пушку: ближайшая к месту, где призрак ломает дверь, с запасом по радиусу. */
export function pickCannonCell(m: Match, r: Room): Vec | null {
  const f = r.door.front;
  const reach = B.cannon.range - 0.6;
  const cells = m
    .placeableCells(r, 'cannon')
    .map((c) => ({ c, d: Math.hypot(c.x + 0.5 - f.x, c.y + 0.5 - f.y) }))
    .sort((a, b) => a.d - b.d);
  // Ребёнок мог выбрать не ту комнату — тогда просто ближайшая к двери клетка.
  return (cells.find((q) => q.d <= reach) ?? cells[0])?.c ?? null;
}
