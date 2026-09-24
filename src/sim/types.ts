export type Vec = { x: number; y: number };
export type BuildKind = 'cannon' | 'pumpkin';
export type ItemKind = 'lavender' | 'safe' | 'toolbox';
export type Difficulty = 'easy' | 'hard' | 'nightmare';
export type Phase = 'pick' | 'prep' | 'night' | 'end';

export interface Cost {
  candy: number;
  flame: number;
}

export interface Building {
  kind: BuildKind;
  x: number;
  y: number;
  level: number;
  cooldown: number;
}

export interface Item {
  kind: ItemKind;
  x: number;
  y: number;
}

export interface Door {
  /** Клетка стены, в которой стоит дверь. */
  x: number;
  y: number;
  /** Клетка комнаты прямо за дверью: здесь стоят, чтобы чинить. */
  inside: Vec;
  /** Точка в коридоре, где стоит призрак, когда ломает дверь. */
  front: Vec;
  level: number;
  hp: number;
  maxHp: number;
  broken: boolean;
  /** Секунд до следующей починки ключом. */
  repairCd: number;
}

export interface Sofa {
  x: number;
  y: number;
  level: number;
}

/** Мебель для красоты: variant — какая картинка (furniture1..3), в комнате не повторяется. */
export interface Furniture {
  x: number;
  y: number;
  variant: number;
}

export interface Room {
  id: number;
  /** Описывающий прямоугольник; сама комната — клетки, отмеченные в mask. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Клетки комнаты внутри прямоугольника, построчно: комнаты неровные. */
  mask: boolean[];
  /** Дверь в нижней стене (комната над коридором). */
  top: boolean;
  door: Door;
  sofa: Sofa;
  furniture: Furniture[];
  soil: Vec[];
  items: Item[];
  buildings: Building[];
  ownerId: number | null;
  eliminated: boolean;
  candy: number;
  flame: number;
}

export type Cmd =
  | { type: 'pickRoom'; roomId: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'build'; x: number; y: number; kind: BuildKind }
  | { type: 'upgrade'; x: number; y: number }
  | { type: 'sell'; x: number; y: number }
  | { type: 'upgradeDoor' }
  | { type: 'repair' }
  | { type: 'upgradeSofa' };

export type WorkKind = 'build' | 'plant' | 'upgrade' | 'sell' | 'door' | 'sofa' | 'repair';

export interface Task {
  cmd: Cmd;
  stage: 'walk' | 'work';
  kind: WorkKind | null;
  target: Vec | null;
  workLeft: number;
  workTotal: number;
  /** Сколько уже списано за эту работу — вернём, если работу прервут. */
  paid: Cost | null;
}

/** Характер соседа: что любит покупать и как быстро шевелится. */
export interface NpcProfile {
  name: string;
  door: number;
  eco: number;
  gun: number;
  /** Множитель паузы между решениями: 1 — обычный темп, больше — медленнее. */
  pace: number;
  /** Больше этого числа пушек не ставит. */
  maxCannons: number;
}

export interface Character {
  id: number;
  isPlayer: boolean;
  /** Какой из 6 героев (картинки charN, цвет, имя). Игрок выбирает своего в магазине. */
  look: number;
  name: string;
  color: number;
  roomId: number | null;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  path: Vec[];
  task: Task | null;
  facing: 1 | -1;
  caught: boolean;
  profile: NpcProfile;
  think: number;
}

export type GhostState = 'hidden' | 'moving' | 'attacking' | 'entering' | 'retreating' | 'healing' | 'dead';

/**
 * Сценарий обучения: режиссёр (src/tutorial) крутит эти ручки по ходу шагов.
 * В обычном матче script = null и ничего из этого не действует.
 */
export interface TutorialScript {
  /** Таймеры фаз стоят — ждём, пока ребёнок сделает шаг. */
  holdPhase: boolean;
  /** Соседи спят и не строят. */
  npcIdle: boolean;
  /** Множитель дохода (быстрее набрать на следующий шаг). */
  incomeMul: number;
  /** Призрак стоит у двери и не бьёт (ждём нажатия на ключ). */
  ghostHitHold: boolean;
  /** Дверь не опускается ниже этой доли HP — проиграть нельзя. */
  doorFloor: number;
  /** HP призрака не опускается ниже этой доли (до финала). */
  hpFloor: number;
  /** Призрак ходит только к этой комнате. */
  ghostTarget: number | null;
  ghostHp: number;
  ghostDmg: number;
  ghostSpeedMul: number;
}

export interface Ghost {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  level: number;
  hp: number;
  maxHp: number;
  state: GhostState;
  targetRoom: number;
  waypoints: Vec[];
  hitTimer: number;
  /** Терпение у этой двери: когда кончится — уйдёт к другой (случайное). */
  switchTimer: number;
  /** HP призрака и двери в начале осады — чтобы понять, что пора сдаваться. */
  siegeHp: number;
  siegeDoorHp: number;
  siegeTime: number;
  healTimer: number;
  levelTimer: number;
}

export type SimEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'built'; roomId: number; x: number; y: number; kind: BuildKind }
  | { type: 'upgraded'; roomId: number; x: number; y: number; level: number }
  | { type: 'sold'; roomId: number; x: number; y: number; refund: number }
  | { type: 'doorUpgraded'; roomId: number; level: number }
  | { type: 'sofaUpgraded'; roomId: number; level: number }
  | { type: 'repaired'; roomId: number }
  | { type: 'doorHit'; roomId: number; dmg: number }
  | { type: 'doorBroken'; roomId: number }
  | { type: 'caught'; roomId: number; charId: number }
  | { type: 'shot'; roomId: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'ghostLevel'; level: number }
  | { type: 'ghostRetreat' }
  /** Призрак бросил эту дверь и пошёл к другой. */
  | { type: 'ghostLeft'; roomId: number }
  | { type: 'ghostDead' }
  | { type: 'fail'; charId: number; msg: string };
