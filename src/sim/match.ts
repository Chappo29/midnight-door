import {
  B,
  DIFF,
  TICK,
  adjustCost,
  benchHeal,
  buildBaseCost,
  cannonDmg,
  cannonRange,
  cannonUpCost,
  doorMaxHp,
  doorUpCost,
  extraUpCost,
  isLateKind,
  pumpkinRate,
  pumpkinUpCost,
  sofaIncome,
  sofaNeedDoor,
  sofaUpCost,
  trapHold,
  trapRecharge,
  unlockDoor,
  type DiffParams,
} from './balance';
import { createGhost, ghostLeaveRoom, ghostTargetable, spawnGhost, updateGhost } from './ghost';
import { Tile, generateMap, type TileT } from './map';
import { BALANCED, PROFILES, npcThink } from './npc';
import { bfs } from './path';
import { Rng } from './rng';
import { DIRS, allConnected, buildingAt, inRoom, isSoil, occupantAt, roomCells, walkable } from './roomgrid';
import type { BuildKind, Building, Character, Cmd, Cost, Difficulty, Ghost, Phase, Room, SimEvent, Task, TutorialScript, Vec, WorkKind } from './types';

export interface MatchOptions {
  seed: number;
  difficulty: Difficulty;
  flameUnlocked: boolean;
  /** Какого героя выбрал игрок (0–5); соседи — остальные пятеро. */
  hero?: number;
  /** Скины двери и пушек комнаты игрока (только внешний вид, симуляция их не читает). */
  skin?: { door: string; cannon: string };
  /** Усилители игрока на этот матч (куплены в магазине). */
  boosters?: { candy: number; doorLevel: number; repairMul: number };
  /** Обучение («Ночь 0»): сценарий вместо обычных правил, проиграть нельзя. */
  tutorial?: boolean;
  /** Игроком управляет ИИ — для тестов и прогона баланса. */
  autoPlayer?: boolean;
  autoPlayerSkill?: number;
}

/** Имена героев по внешности (charN). Игрока всегда подписываем «Ты». */
export const HERO_NAMES = ['Сёма', 'Мия', 'Тимоха', 'Зоя', 'Лёва', 'Бублик'];
export const CHAR_COLORS = [0x4aa3ff, 0xff7a7a, 0x7ad97a, 0xffc94a, 0xc58aff, 0x5ee0d0];

/** Та же команда: тот же тип и та же клетка (и то же, что строить). */
function sameCmd(a: Cmd, b: Cmd): boolean {
  if (a.type !== b.type) return false;
  if ('x' in a && 'x' in b && (a.x !== b.x || a.y !== b.y)) return false;
  if (a.type === 'build' && b.type === 'build') return a.kind === b.kind;
  return true;
}

/**
 * Весь матч: карта, персонажи, экономика, призрак. Без Phaser — то же самое
 * позже заработает на сервере для мультиплеера. Шаг фиксированный (TICK).
 */
export class Match {
  readonly rng: Rng;
  readonly diff: DiffParams;
  readonly tiles: TileT[][];
  readonly rooms: Room[];
  readonly chars: Character[] = [];
  /** Центр гнезда призрака. */
  readonly nest: Vec;
  readonly ghost: Ghost;
  readonly playerId = 0;

  phase: Phase = 'pick';
  phaseLeft: number = B.phase.pick;
  /** Сколько подготовка уже ждала игрока, идущего к своей комнате (см. waitingForPlayer). */
  prepWait = 0;
  time = 0;
  nightTime = 0;
  result: 'win' | 'lose' | null = null;
  /** ghost — призрак побеждён; allCaught — поймали всех (единственное поражение). */
  resultReason: 'ghost' | 'allCaught' | '' = '';
  /** Призрака добили, пока игрок был духом, — «Командная победа!». */
  teamWin = false;
  /** Воскрешение (реклама за награду) уже было — второй раз нельзя. */
  reviveUsed = false;
  events: SimEvent[] = [];
  /** Сколько событий в `events` принадлежит прошедшему тику; всё, что дописано после, — от команд между тиками. */
  private settledEvents = 0;
  firstElimAt = -1;
  /** Ручки сценария обучения; null — обычный матч. */
  script: TutorialScript | null = null;
  private endTimer = -1;

  constructor(readonly opts: MatchOptions) {
    this.rng = new Rng(opts.seed);
    this.diff = DIFF[opts.difficulty];
    const map = generateMap(this.rng);
    this.tiles = map.tiles;
    this.rooms = map.rooms;
    this.nest = map.nest;
    this.ghost = createGhost(this.nest);
    if (opts.tutorial) {
      this.script = {
        holdPhase: true,
        npcIdle: true,
        incomeMul: 1,
        ghostHitHold: false,
        doorFloor: 0.3,
        hpFloor: 0.6,
        ghostTarget: null,
        ghostHp: 200,
        ghostDmg: 80,
        ghostSpeedMul: 0.65,
      };
    }
    const profiles = this.rng.shuffle([...PROFILES, ...PROFILES]);
    // Все начинают в коридорах, вразброс.
    const spawn = this.rng.shuffle(this.corridorCells());
    const hero = opts.hero ?? 0;
    const looks = [hero, ...[0, 1, 2, 3, 4, 5].filter((l) => l !== hero)];
    for (let i = 0; i < 6; i++) {
      const x = spawn[i].x + 0.5;
      const y = spawn[i].y + 0.5;
      this.chars.push({
        id: i,
        isPlayer: i === 0,
        look: looks[i],
        name: i === 0 ? 'Ты' : HERO_NAMES[looks[i]],
        color: CHAR_COLORS[looks[i]],
        roomId: null,
        x,
        y,
        prevX: x,
        prevY: y,
        path: [],
        task: null,
        facing: 1,
        caught: false,
        spirit: false,
        booCd: 0,
        sparkCd: 0,
        flyTo: null,
        profile: i === 0 ? BALANCED : profiles[i - 1],
        think: 0,
      });
    }
  }

  get player(): Character {
    return this.chars[this.playerId];
  }

  get playerRoom(): Room | null {
    const id = this.player.roomId;
    return id === null ? null : this.rooms[id];
  }

  /** Сколько длится ночь, мм:сс. Рассвета нет — это просто секундомер. */
  get clock(): string {
    const sec = Math.floor(this.nightTime);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }

  get survivors(): number {
    return this.rooms.filter((r) => r.ownerId !== null && !r.eliminated).length;
  }

  // ---------- экономика ----------

  incomeOf(r: Room): number {
    return sofaIncome(r.sofa.level) + (r.items.some((i) => i.kind === 'safe') ? B.items.safe : 0);
  }

  flameIncomeOf(r: Room): number {
    if (!this.opts.flameUnlocked) return 0;
    return r.buildings.reduce((s, b) => s + (b.kind === 'pumpkin' ? pumpkinRate(b.level) : 0), 0);
  }

  buildCost(kind: BuildKind): Cost {
    return adjustCost(buildBaseCost(kind), this.opts.flameUnlocked);
  }

  upgradeCost(b: Pick<Building, 'kind' | 'level'>): Cost | null {
    const k = b.kind;
    const c = k === 'cannon' ? cannonUpCost(b.level) : k === 'pumpkin' ? pumpkinUpCost(b.level) : extraUpCost(k, b.level);
    return c && adjustCost(c, this.opts.flameUnlocked);
  }

  doorUpgradeCost(r: Room): Cost | null {
    const c = doorUpCost(r.door.level);
    return c && adjustCost(c, this.opts.flameUnlocked);
  }

  sofaUpgradeCost(r: Room): Cost | null {
    const c = sofaUpCost(r.sofa.level);
    return c && adjustCost(c, this.opts.flameUnlocked);
  }

  /** Диван апается только вслед за дверью: если дверь ещё слабая — вернёт нужный её уровень, иначе null. */
  sofaBlockedBy(r: Room): number | null {
    const need = sofaNeedDoor(r.sofa.level + 1);
    return need > 0 && r.door.level < need ? need : null;
  }

  /**
   * Постройка заперта дверью: вернёт нужный уровень двери, иначе null.
   * В обучении поздние постройки заперты всегда — там учим только пушке и тыкве.
   */
  buildLocked(r: Room, kind: BuildKind): number | null {
    const need = unlockDoor(kind);
    if (!need) return null;
    if (this.script) return need;
    return r.door.level < need ? need : null;
  }

  sellValue(b: Building): number {
    return Math.round(B.sellRefund * buildBaseCost(b.kind).candy * b.level);
  }

  cannonDamage(b: Building): number {
    return cannonDmg(b.level);
  }

  cannonRange(b: Pick<Building, 'level'>): number {
    return cannonRange(b.level);
  }

  canAfford(r: Room, c: Cost): boolean {
    return r.candy + 1e-6 >= c.candy && r.flame + 1e-6 >= c.flame;
  }

  private pay(r: Room, c: Cost): void {
    r.candy -= c.candy;
    r.flame -= c.flame;
  }

  // ---------- правила постройки ----------

  canPlace(r: Room, x: number, y: number, kind: BuildKind): string | null {
    if (!inRoom(r, x, y)) return 'Это не твоя комната';
    if (occupantAt(r, x, y) !== null) return 'Место занято';
    if (x === r.door.inside.x && y === r.door.inside.y) return 'Здесь проход к двери';
    const need = this.buildLocked(r, kind);
    if (need) return `Сначала дверь до ур. ${need}`;
    const soil = isSoil(r, x, y);
    if (kind === 'pumpkin' && !this.opts.flameUnlocked) return 'Тыквы откроются во втором матче';
    if (kind === 'pumpkin' && !soil) return 'Тыкву сажают на грядку';
    if (kind !== 'pumpkin' && soil) return 'Грядка — для тыкв';
    if (this.atCap(r, kind)) return 'Больше нельзя';
    if (!allConnected(r, { x, y })) return 'Загородит проход';
    return null;
  }

  /** Поздних построек в комнате не больше B[kind].maxPerRoom (пушки и тыквы ограничены только местом). */
  atCap(r: Room, kind: BuildKind): boolean {
    return isLateKind(kind) && r.buildings.filter((b) => b.kind === kind).length >= B[kind].maxPerRoom;
  }

  /**
   * Есть ли сейчас хоть одно место под постройку. Без rng (buildCells тасует клетки генератором
   * симуляции) — для интерфейса и подсказок, которые спрашивают каждый кадр.
   */
  hasBuildCell(r: Room, kind: BuildKind): boolean {
    const cells = kind === 'pumpkin' ? r.soil : this.roomCells(r);
    return cells.some((v) => this.canPlace(r, v.x, v.y, kind) === null);
  }

  /**
   * Клетки, где сейчас можно поставить постройку, — без случайного порядка и без rng.
   * Для вида и обучения: они зовутся каждый кадр, и rng симуляции там трогать нельзя
   * (иначе матч с тем же seed пошёл бы по-другому в зависимости от частоты кадров).
   */
  placeableCells(r: Room, kind: BuildKind): Vec[] {
    const cells = kind === 'pumpkin' ? r.soil : this.roomCells(r);
    return cells.filter((v) => this.canPlace(r, v.x, v.y, kind) === null);
  }

  findBuildCell(r: Room, kind: BuildKind): Vec | null {
    return this.buildCells(r, kind)[0] ?? null;
  }

  /** Все клетки, где сейчас можно поставить постройку, в случайном порядке. */
  buildCells(r: Room, kind: BuildKind): Vec[] {
    const cells = kind === 'pumpkin' ? [...r.soil] : this.roomCells(r);
    return this.rng.shuffle(cells).filter((v) => this.canPlace(r, v.x, v.y, kind) === null);
  }

  randomWalkableCell(r: Room): Vec | null {
    const cells = this.roomCells(r).filter((v) => walkable(r, v.x, v.y));
    return cells.length ? this.rng.pick(cells) : null;
  }

  private roomCells(r: Room): Vec[] {
    return roomCells(r);
  }

  private corridorCells(): Vec[] {
    const cells: Vec[] = [];
    this.tiles.forEach((row, y) => row.forEach((t, x) => t === Tile.Corridor && cells.push({ x, y })));
    return cells;
  }

  // ---------- команды (от игрока и от ИИ одинаковые) ----------

  /** Возвращает текст ошибки для подсказки или null, если команда принята. */
  command(charId: number, cmd: Cmd): string | null {
    const c = this.chars[charId];
    if (this.phase === 'end' || this.result) return 'Игра окончена';
    if (c.spirit) return this.spiritCommand(c, cmd);
    if (c.caught) return 'Тебя поймали';
    if (cmd.type === 'boo' || cmd.type === 'spark') return 'Только для духа';

    if (cmd.type === 'pickRoom') {
      if (this.phase !== 'pick' || c.roomId !== null) return 'Комната уже выбрана';
      const r = this.rooms[cmd.roomId];
      if (!r || r.ownerId !== null) return 'Комната занята';
      this.assignRoom(c, r);
      return null;
    }
    if (c.roomId === null) return 'Сначала выбери комнату';
    const room = this.rooms[c.roomId];
    const cur = { x: Math.floor(c.x), y: Math.floor(c.y) };
    if (!inRoom(room, cur.x, cur.y)) return 'Ещё идёт в комнату';

    let stands: Vec[];
    switch (cmd.type) {
      case 'move':
        if (!walkable(room, cmd.x, cmd.y)) return 'Туда не пройти';
        stands = [{ x: cmd.x, y: cmd.y }];
        break;
      case 'build': {
        const err = this.canPlace(room, cmd.x, cmd.y, cmd.kind);
        if (err) return err;
        const cost = this.buildCost(cmd.kind);
        if (!this.canAfford(room, cost)) return this.missing(room, cost);
        stands = this.standCells(room, cmd);
        break;
      }
      case 'upgrade': {
        const b = buildingAt(room, cmd.x, cmd.y);
        if (!b) return 'Тут ничего нет';
        const cost = this.upgradeCost(b);
        if (!cost) return 'Максимальный уровень';
        if (!this.canAfford(room, cost)) return this.missing(room, cost);
        stands = this.standCells(room, cmd);
        break;
      }
      case 'sell':
        if (!buildingAt(room, cmd.x, cmd.y)) return 'Тут ничего нет';
        stands = this.standCells(room, cmd);
        break;
      case 'upgradeDoor': {
        if (room.door.broken) return 'Дверь сломана';
        const cost = this.doorUpgradeCost(room);
        if (!cost) return 'Максимальный уровень';
        if (!this.canAfford(room, cost)) return this.missing(room, cost);
        stands = [room.door.inside];
        break;
      }
      case 'repair':
        if (room.door.broken) return 'Дверь сломана';
        if (room.door.hp >= room.door.maxHp) return 'Дверь целая';
        if (room.door.repairCd > 0) return `Ключ будет готов через ${Math.ceil(room.door.repairCd)} с`;
        stands = [room.door.inside];
        break;
      case 'upgradeSofa': {
        const need = this.sofaBlockedBy(room);
        if (need) return `Сначала дверь до ур. ${need}`;
        const cost = this.sofaUpgradeCost(room);
        if (!cost) return 'Максимальный уровень';
        if (!this.canAfford(room, cost)) return this.missing(room, cost);
        stands = this.standCells(room, cmd);
        break;
      }
    }

    // Та же команда уже выполняется (ребёнок жмёт ключ снова и снова) — не начинать её заново:
    // перезапуск отменял работу, и частые нажатия чинили дольше редких.
    if (c.task && sameCmd(c.task.cmd, cmd)) return null;
    if (!stands.length) return 'Не подойти';
    const path = bfs(cur, stands, (x, y) => walkable(room, x, y));
    if (!path) return 'Не подойти';
    c.path = path;
    this.cancelTask(c);
    c.task = { cmd, stage: 'walk', kind: null, target: null, workLeft: 0, workTotal: 0, paid: null };
    return null;
  }

  /**
   * Команды духа: полёт в клетку (сквозь стены), «Бу!» и «Искорка». Строить и чинить дух не может.
   */
  private spiritCommand(c: Character, cmd: Cmd): string | null {
    const S = B.spirit;
    switch (cmd.type) {
      case 'move': {
        const w = this.tiles[0].length;
        const h = this.tiles.length;
        const x = Math.min(w - 1, Math.max(0, Math.floor(cmd.x)));
        const y = Math.min(h - 1, Math.max(0, Math.floor(cmd.y)));
        c.flyTo = { x: x + 0.5, y: y + 0.5 };
        return null;
      }
      case 'boo': {
        if (c.booCd > 0) return `Бу! будет готово через ${Math.ceil(c.booCd)} с`;
        if (!this.booInRange(c)) return 'Подлети ближе к призраку';
        // «Бу!» не зависит от капканов: не проверяет и не даёт иммунитет.
        const g = this.ghost;
        g.held = Math.max(g.held, S.booHold);
        c.booCd = S.booCd;
        this.events.push({ type: 'boo', charId: c.id });
        return null;
      }
      case 'spark': {
        if (c.sparkCd > 0) return `Искорка будет готова через ${Math.ceil(c.sparkCd)} с`;
        const target = this.sparkTarget(c, cmd);
        if (!target) return 'Рядом нет пушки соседа';
        target.b.boost = S.sparkTime;
        c.sparkCd = S.sparkCd;
        this.events.push({ type: 'spark', roomId: target.r.id, x: target.b.x, y: target.b.y });
        return null;
      }
      default:
        return 'Ты дух — строить нельзя';
    }
  }

  /** Призрак ночью на виду и в радиусе «Бу!» от духа c (для кнопки HUD — тоже). */
  booInRange(c: Character): boolean {
    const g = this.ghost;
    return this.phase === 'night' && ghostTargetable(g) && Math.hypot(g.x - c.x, g.y - c.y) <= B.spirit.booRange;
  }

  /** Пушки соседей (живые комнаты, не игрока) в радиусе «Искорки» от духа c. */
  sparkCannons(c: Character): { r: Room; b: Building }[] {
    const out: { r: Room; b: Building }[] = [];
    for (const r of this.rooms) {
      if (r.ownerId === null || r.ownerId === this.playerId || r.eliminated) continue;
      for (const b of r.buildings) {
        if (b.kind === 'cannon' && Math.hypot(b.x + 0.5 - c.x, b.y + 0.5 - c.y) <= B.spirit.sparkRange) out.push({ r, b });
      }
    }
    return out;
  }

  /** Цель «Искорки»: пушка в указанной клетке (если она в радиусе) или ближайшая пушка соседа. */
  private sparkTarget(c: Character, cmd: { x?: number; y?: number; roomId?: number }): { r: Room; b: Building } | null {
    const list = this.sparkCannons(c);
    if (cmd.x !== undefined && cmd.y !== undefined) {
      return list.find((t) => t.b.x === cmd.x && t.b.y === cmd.y && (cmd.roomId === undefined || t.r.id === cmd.roomId)) ?? null;
    }
    const d = (t: { b: Building }) => Math.hypot(t.b.x + 0.5 - c.x, t.b.y + 0.5 - c.y);
    return list.reduce<{ r: Room; b: Building } | null>((best, t) => (!best || d(t) < d(best) ? t : best), null);
  }

  /**
   * Можно ли сейчас вернуть игрока в комнату (реклама за награду): раз за матч, игрок — дух, ночь идёт,
   * и призрак не входит прямо сейчас в его комнату. null — можно, иначе причина.
   * Где призрак стоит, не важно: в тик поимки он ещё в комнате, но уже идёт к другой двери.
   */
  canRevive(): string | null {
    const p = this.player;
    if (this.reviveUsed) return 'Возвращаться можно один раз';
    if (!p.spirit || p.roomId === null) return 'Ты и так в комнате';
    if (this.result || this.phase !== 'night') return 'Игра окончена';
    const g = this.ghost;
    if (g.state === 'entering' && g.targetRoom === p.roomId) return 'Призрак в комнате';
    return null;
  }

  /**
   * Вернуть игрока в свою комнату: дверь того же уровня с B.revive.doorHp HP, ключ готов, конфеты и постройки
   * на месте, B.revive.protect с призрак сюда не идёт. Уровень призрака не откатывается.
   */
  revive(): string | null {
    const err = this.canRevive();
    if (err) return err;
    const p = this.player;
    const r = this.rooms[p.roomId!];
    const d = r.door;
    r.eliminated = false;
    d.broken = false;
    d.hp = d.maxHp * B.revive.doorHp;
    d.repairCd = 0;
    p.caught = false;
    p.spirit = false;
    p.flyTo = null;
    p.task = null;
    p.path = [];
    p.x = p.prevX = d.inside.x + 0.5;
    p.y = p.prevY = d.inside.y + 0.5;
    this.ghost.avoidRoom = r.id;
    this.ghost.avoidTimer = B.revive.protect;
    ghostLeaveRoom(this, r);
    this.reviveUsed = true;
    this.events.push({ type: 'revived', charId: p.id, roomId: r.id });
    return null;
  }

  /** Выдать конфеты (обучение: чтобы хватило ровно на показываемый шаг). */
  grant(r: Room, candy: number): void {
    r.candy = Math.max(r.candy, candy);
  }

  /**
   * Прервать текущее дело. Если за работу уже заплачено, а она не доделана —
   * деньги возвращаются (раньше тап по полу во время стройки съедал конфеты).
   */
  cancelTask(c: Character): void {
    const t = c.task;
    let refund = 0;
    if (t?.stage === 'work' && t.paid && c.roomId !== null) {
      const r = this.rooms[c.roomId];
      r.candy += t.paid.candy;
      r.flame += t.paid.flame;
      refund = t.paid.candy;
    }
    // Сцена покажет «✕» на месте брошенного дела: раньше стройка пропадала молча (CHILD_UX, проверка C1/C2/C4).
    if (t && t.cmd.type !== 'move') this.events.push({ type: 'taskCancelled', charId: c.id, cmd: t.cmd, refund });
    c.task = null;
  }

  private missing(r: Room, c: Cost): string {
    return r.candy + 1e-6 < c.candy ? 'Не хватает конфет' : 'Не хватает пламени';
  }

  /** Клетки, стоя на которых персонаж может выполнить команду. */
  private standCells(r: Room, cmd: Cmd): Vec[] {
    let target: Vec;
    if (cmd.type === 'upgradeSofa') target = r.sofa;
    else if (cmd.type === 'build' || cmd.type === 'upgrade' || cmd.type === 'sell') target = cmd;
    else return [];
    const blocked = cmd.type === 'build' ? target : undefined;
    return DIRS.map((d) => ({ x: target.x + d.x, y: target.y + d.y })).filter((v) => walkable(r, v.x, v.y, blocked));
  }

  private assignRoom(c: Character, r: Room): void {
    r.ownerId = c.id;
    r.candy = B.startCandy;
    const boost = c.isPlayer ? this.opts.boosters : undefined;
    if (boost) {
      // Усилители из магазина: конфеты на старте и дверь сразу крепче.
      r.candy += boost.candy;
      if (boost.doorLevel > r.door.level) {
        r.door.level = boost.doorLevel;
        r.door.maxHp = r.door.hp = doorMaxHp(boost.doorLevel);
      }
    }
    c.roomId = r.id;
    // Путь по коридорам к своей двери и внутрь; через чужие комнаты не ходим.
    const d = r.door;
    const from = { x: Math.floor(c.x), y: Math.floor(c.y) };
    const hall = (x: number, y: number) => {
      const t = this.tiles[y]?.[x];
      return t === Tile.Corridor || t === Tile.Nest || (x === d.x && y === d.y) || inRoom(r, x, y);
    };
    c.path = bfs(from, [d.inside], hall) ?? [{ ...d.inside }];
    c.task = null;
  }

  // ---------- шаг симуляции ----------

  /**
   * Один тик симуляции. `events` после вызова — события этого тика плюс те, что команды
   * игрока («Бу!», «Искорка», воскрешение) добавили между тиками: иначе они стирались,
   * не дойдя до сцены, и действие проходило без звука и эффекта.
   */
  step(): void {
    this.events = this.events.slice(this.settledEvents);
    this.stepTick();
    this.settledEvents = this.events.length;
  }

  private stepTick(): void {
    if (this.phase === 'end') return;
    const dt = TICK;
    this.time += dt;
    if (!this.script?.holdPhase && !this.waitingForPlayer(dt)) this.phaseLeft -= dt;

    if (this.phase === 'pick') this.stepPick(dt);
    else if (this.phase === 'prep' && this.phaseLeft <= 0) this.startNight();
    // Рассвета нет (как в Haunted Dorm): ночь идёт, пока призрак не побеждён или не поймал всех (пойманный игрок — дух).
    else if (this.phase === 'night' && !this.result) this.nightTime += dt;

    const running = this.phase === 'prep' || this.phase === 'night';
    if (running) this.stepEconomy(dt);
    for (const c of this.chars) this.stepChar(c, dt);
    if (running && !this.result) {
      if (!this.script?.npcIdle) for (const c of this.chars) if (this.isAi(c)) npcThink(this, c, dt, this.aiSkill(c));
    }
    if (this.phase === 'night') {
      updateGhost(this, dt);
      if (!this.result) {
        this.stepTraps(dt);
        this.stepCannons(dt);
      }
    }

    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        this.endTimer = -1;
        this.setPhase('end');
      }
    }
  }

  /**
   * Подготовка не тикает, пока игрок идёт к своей комнате (иначе к приходу он терял половину таймера,
   * если выбрал дальнюю комнату). Ждём не дольше B.phase.walkMax.
   */
  private waitingForPlayer(dt: number): boolean {
    if (this.phase !== 'prep') return false;
    const r = this.playerRoom;
    const p = this.player;
    if (!r || inRoom(r, Math.floor(p.x), Math.floor(p.y)) || this.prepWait >= B.phase.walkMax) return false;
    this.prepWait += dt;
    return true;
  }

  private isAi(c: Character): boolean {
    return !c.isPlayer || !!this.opts.autoPlayer;
  }

  private aiSkill(c: Character): number {
    return c.isPlayer ? (this.opts.autoPlayerSkill ?? 0.5) : this.diff.npcSkill;
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.events.push({ type: 'phase', phase: p });
  }

  /**
   * Выбор комнаты: сначала игрок (B.phase.pick секунд, соседи ждут в коридоре).
   * Не успел — комната выбирается сама. Потом соседи по очереди разбирают остальные.
   */
  private stepPick(dt: number): void {
    const p = this.player;
    if (p.roomId === null) {
      if (this.opts.autoPlayer && this.phaseLeft < B.phase.pick - 1) this.assignRoom(p, this.rng.pick(this.freeRooms()));
      else if (this.phaseLeft <= 0) this.assignRoom(p, this.rng.pick(this.freeRooms()));
      if (p.roomId === null) return;
      for (const c of this.chars) if (!c.isPlayer) c.think = this.rng.range(0.4, 2.5);
    }
    for (const c of this.chars) {
      if (c.roomId !== null) continue;
      c.think -= dt;
      if (c.think <= 0) this.assignRoom(c, this.rng.pick(this.freeRooms()));
    }
    if (this.chars.every((c) => c.roomId !== null)) {
      for (const c of this.chars) c.think = this.rng.range(0.3, 1.5);
      this.setPhase('prep');
      this.phaseLeft = B.phase.prep;
      this.prepWait = 0;
    }
  }

  private freeRooms(): Room[] {
    return this.rooms.filter((r) => r.ownerId === null);
  }

  private startNight(): void {
    this.setPhase('night');
    this.phaseLeft = B.phase.night;
    spawnGhost(this);
  }

  private stepEconomy(dt: number): void {
    for (const r of this.rooms) {
      if (r.ownerId === null || r.eliminated) continue;
      r.candy += this.incomeOf(r) * (this.script?.incomeMul ?? 1) * dt;
      r.flame += this.flameIncomeOf(r) * dt;
      const d = r.door;
      d.repairCd = Math.max(0, d.repairCd - dt);
      // Обучение ждёт нажатия на ключ: сама дверь не лечится, иначе становится целой, ключ отвечает
      // «Дверь целая», и шаг «Чини дверь!» не кончается никогда.
      const heals = this.phase === 'night' && !d.broken && !this.script?.ghostHitHold;
      if (heals && r.items.some((i) => i.kind === 'toolbox')) {
        d.hp = Math.min(d.maxHp, d.hp + d.maxHp * B.items.toolbox * dt);
      }
      if (heals) this.stepWorkbench(r, dt);
    }
  }

  /** Верстак ночью латает дверь раз в B.workbench.interval с. Целую дверь не трогает — готов сразу, как её ударят. */
  private stepWorkbench(r: Room, dt: number): void {
    const d = r.door;
    for (const b of r.buildings) {
      if (b.kind !== 'workbench') continue;
      b.cooldown = Math.max(0, b.cooldown - dt);
      if (b.cooldown > 0 || d.hp >= d.maxHp) continue;
      b.cooldown = B.workbench.interval;
      const amount = Math.min(d.maxHp - d.hp, d.maxHp * benchHeal(b.level));
      d.hp += amount;
      this.events.push({ type: 'benchFix', roomId: r.id, amount: Math.round(amount) });
    }
  }

  /**
   * Капканы: призрак на виду (идёт, ломится, убегает) в радиусе заряженного капкана и без иммунитета — застывает.
   * Входящего в комнату и лечащегося не держат. За тик срабатывает не больше одного капкана.
   */
  private stepTraps(dt: number): void {
    const g = this.ghost;
    const can = g.state === 'moving' || g.state === 'attacking' || g.state === 'retreating';
    let fired = false;
    for (const r of this.rooms) {
      if (r.ownerId === null || r.eliminated) continue;
      for (const b of r.buildings) {
        if (b.kind !== 'trap') continue;
        b.cooldown = Math.max(0, b.cooldown - dt);
        if (fired || !can || b.cooldown > 0 || g.held > 0 || g.holdImmune > 0) continue;
        if (Math.hypot(g.x - b.x - 0.5, g.y - b.y - 0.5) > B.trap.radius) continue;
        g.held = trapHold(b.level);
        g.holdImmune = g.held + B.trap.immune;
        b.cooldown = trapRecharge(b.level);
        fired = true;
        this.events.push({ type: 'trapped', roomId: r.id, x: b.x, y: b.y });
      }
    }
  }

  private stepChar(c: Character, dt: number): void {
    c.prevX = c.x;
    c.prevY = c.y;
    if (c.spirit) return this.stepSpirit(c, dt);
    if (c.caught) return;
    if (c.path.length) {
      this.walk(c, dt);
      if (c.path.length) return;
    }
    const t = c.task;
    if (!t) return;
    const room = this.rooms[c.roomId!];

    if (t.stage === 'walk') this.startWork(c, room, t);
    else if (t.stage === 'work') {
      t.workLeft -= dt;
      if (t.workLeft <= 0) this.finishWork(c, room, t);
    }
  }

  /** Дух: откаты умений и полёт по прямой к flyTo — без пути, сквозь стены. */
  private stepSpirit(c: Character, dt: number): void {
    c.booCd = Math.max(0, c.booCd - dt);
    c.sparkCd = Math.max(0, c.sparkCd - dt);
    const t = c.flyTo;
    if (!t) return;
    const dx = t.x - c.x;
    const dy = t.y - c.y;
    const d = Math.hypot(dx, dy);
    const step = B.spirit.speed * dt;
    if (Math.abs(dx) > 0.01) c.facing = dx > 0 ? 1 : -1;
    if (d <= step) {
      c.x = t.x;
      c.y = t.y;
      c.flyTo = null;
    } else {
      c.x += (dx / d) * step;
      c.y += (dy / d) * step;
    }
  }

  private walk(c: Character, dt: number): void {
    let budget = B.walkSpeed * dt;
    while (budget > 0 && c.path.length) {
      const tx = c.path[0].x + 0.5;
      const ty = c.path[0].y + 0.5;
      const dx = tx - c.x;
      const dy = ty - c.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.01) c.facing = dx > 0 ? 1 : -1;
      if (d <= budget) {
        c.x = tx;
        c.y = ty;
        c.path.shift();
        budget -= d;
      } else {
        c.x += (dx / d) * budget;
        c.y += (dy / d) * budget;
        budget = 0;
      }
    }
  }

  private fail(c: Character, msg: string): void {
    c.task = null;
    this.events.push({ type: 'fail', charId: c.id, msg });
  }

  private beginWork(c: Character, t: Task, kind: WorkKind, target: Vec, time: number): void {
    t.stage = 'work';
    t.kind = kind;
    t.target = target;
    t.workLeft = t.workTotal = time;
    const dx = target.x + 0.5 - c.x;
    if (Math.abs(dx) > 0.01) c.facing = dx > 0 ? 1 : -1;
  }

  private startWork(c: Character, r: Room, t: Task): void {
    const cmd = t.cmd;
    const doorTarget = { x: r.door.x, y: r.door.y };
    switch (cmd.type) {
      case 'move':
      case 'pickRoom':
        c.task = null;
        return;
      case 'build': {
        const err = this.canPlace(r, cmd.x, cmd.y, cmd.kind);
        const cost = this.buildCost(cmd.kind);
        if (err) return this.fail(c, err);
        if (!this.canAfford(r, cost)) return this.fail(c, this.missing(r, cost));
        this.pay(r, cost);
        t.paid = cost;
        const kind = cmd.kind === 'pumpkin' ? 'plant' : 'build';
        return this.beginWork(c, t, kind, cmd, kind === 'plant' ? B.work.plant : B.work.build);
      }
      case 'upgrade': {
        const b = buildingAt(r, cmd.x, cmd.y);
        const cost = b && this.upgradeCost(b);
        if (!b || !cost) return this.fail(c, 'Нельзя улучшить');
        if (!this.canAfford(r, cost)) return this.fail(c, this.missing(r, cost));
        this.pay(r, cost);
        t.paid = cost;
        return this.beginWork(c, t, 'upgrade', cmd, B.work.upgrade);
      }
      case 'sell':
        if (!buildingAt(r, cmd.x, cmd.y)) return this.fail(c, 'Тут ничего нет');
        return this.beginWork(c, t, 'sell', cmd, B.work.sell);
      case 'upgradeDoor': {
        const cost = this.doorUpgradeCost(r);
        if (r.door.broken || !cost) return this.fail(c, 'Нельзя улучшить');
        if (!this.canAfford(r, cost)) return this.fail(c, this.missing(r, cost));
        this.pay(r, cost);
        t.paid = cost;
        return this.beginWork(c, t, 'door', doorTarget, B.work.door);
      }
      case 'repair':
        if (r.door.broken) return this.fail(c, 'Дверь сломана');
        if (r.door.hp >= r.door.maxHp) {
          c.task = null;
          return;
        }
        if (r.door.repairCd > 0) return this.fail(c, 'Ключ ещё не готов');
        return this.beginWork(c, t, 'repair', doorTarget, B.repair.work);
      case 'upgradeSofa': {
        // Дверь не может понизиться в уровне сама по себе, так что это защита от гонки, а не основная проверка (та — в command).
        const need = this.sofaBlockedBy(r);
        if (need) return this.fail(c, `Сначала дверь до ур. ${need}`);
        const cost = this.sofaUpgradeCost(r);
        if (!cost) return this.fail(c, 'Нельзя улучшить');
        if (!this.canAfford(r, cost)) return this.fail(c, this.missing(r, cost));
        this.pay(r, cost);
        t.paid = cost;
        return this.beginWork(c, t, 'sofa', r.sofa, B.work.sofa);
      }
    }
  }

  private finishWork(c: Character, r: Room, t: Task): void {
    const cmd = t.cmd;
    c.task = null;
    switch (cmd.type) {
      case 'build':
        r.buildings.push({ kind: cmd.kind, x: cmd.x, y: cmd.y, level: 1, cooldown: 0 });
        this.events.push({ type: 'built', roomId: r.id, x: cmd.x, y: cmd.y, kind: cmd.kind });
        break;
      case 'upgrade': {
        const b = buildingAt(r, cmd.x, cmd.y);
        if (!b) break;
        b.level++;
        this.events.push({ type: 'upgraded', roomId: r.id, x: b.x, y: b.y, level: b.level });
        break;
      }
      case 'sell': {
        const b = buildingAt(r, cmd.x, cmd.y);
        if (!b) break;
        const refund = this.sellValue(b);
        r.candy += refund;
        r.buildings.splice(r.buildings.indexOf(b), 1);
        this.events.push({ type: 'sold', roomId: r.id, x: b.x, y: b.y, refund });
        break;
      }
      case 'upgradeDoor': {
        const d = r.door;
        if (d.broken) break;
        d.level++;
        d.maxHp = doorMaxHp(d.level);
        d.hp = d.maxHp;
        this.events.push({ type: 'doorUpgraded', roomId: r.id, level: d.level });
        break;
      }
      case 'repair': {
        const d = r.door;
        if (d.broken) break;
        d.hp = Math.min(d.maxHp, d.hp + d.maxHp * B.repair.amount);
        const fast = r.ownerId === this.playerId ? (this.opts.boosters?.repairMul ?? 1) : 1;
        d.repairCd = B.repair.cooldown * fast;
        this.events.push({ type: 'repaired', roomId: r.id });
        break;
      }
      case 'upgradeSofa':
        r.sofa.level++;
        this.events.push({ type: 'sofaUpgraded', roomId: r.id, level: r.sofa.level });
        break;
      default:
        break;
    }
  }

  private stepCannons(dt: number): void {
    const g = this.ghost;
    const active = ghostTargetable(g);
    for (const r of this.rooms) {
      if (r.ownerId === null || r.eliminated) continue;
      // Пушка бьёт всё, что в радиусе, — и когда призрак ломится в дверь, и когда пролетает мимо.
      const inside = active && inRoom(r, Math.floor(g.x), Math.floor(g.y));
      for (const b of r.buildings) {
        if (b.kind !== 'cannon') continue;
        b.cooldown = Math.max(0, b.cooldown - dt);
        // «Искорка» духа: пока горит — урон ×sparkMul. Гаснет всегда, даже если пушка сейчас не стреляет.
        const mul = b.boost ? B.spirit.sparkMul : 1;
        if (b.boost) b.boost = Math.max(0, b.boost - dt);
        if (!active || b.cooldown > 0) continue;
        const bx = b.x + 0.5;
        const by = b.y + 0.5;
        if (!inside && Math.hypot(g.x - bx, g.y - by) > cannonRange(b.level)) continue;
        b.cooldown = B.cannon.interval;
        g.hp -= cannonDmg(b.level) * mul;
        // Обучение: до финала призрак не умирает — успеть показать починку и улучшение.
        if (this.script) g.hp = Math.max(g.hp, g.maxHp * this.script.hpFloor);
        this.events.push({ type: 'shot', roomId: r.id, fromX: bx, fromY: by, toX: g.x, toY: g.y });
        if (g.hp <= 0) {
          g.hp = 0;
          g.state = 'dead';
          this.events.push({ type: 'ghostDead' });
          this.teamWin = this.player.spirit;
          this.finish('win', 'ghost');
          return;
        }
      }
    }
  }

  /**
   * Вызывается призраком, когда он поймал хозяина комнаты. Поимка игрока не конец: он становится духом
   * и помогает соседям. Поражение — только когда поймали всех.
   */
  onEliminated(c: Character): void {
    if (this.firstElimAt < 0) this.firstElimAt = this.nightTime;
    if (this.survivors === 0) {
      // Последнего поймали — матч проигран, духом уже не стать (карточка духа не нужна).
      this.finish('lose', 'allCaught');
      return;
    }
    if (c.isPlayer) {
      c.spirit = true;
      c.flyTo = null;
      c.booCd = 0;
      c.sparkCd = 0;
      this.events.push({ type: 'spirit', charId: c.id });
    }
  }

  private finish(result: 'win' | 'lose', reason: Match['resultReason']): void {
    if (this.result) return;
    this.result = result;
    this.resultReason = reason;
    this.endTimer = B.endDelay;
  }
}
