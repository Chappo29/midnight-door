import { B, doorMaxHp } from './balance';
import type { Rng } from './rng';
import { allConnected, cellIn, key, roomCells } from './roomgrid';
import type { Item, ItemKind, Room, Vec } from './types';

/*
 * Этаж генерируется случайно (как в Haunted Dorm), но по общей схеме 31×25 клеток:
 *   y 1–5    полоса A: комнаты, дверь вниз (в верхний коридор)
 *   y 7–8    верхний коридор, справа гнездо призрака
 *   y 10–14  полоса B: комнаты с дверью вверх или вниз; её режут 1–2 перемычки между коридорами
 *   y 16–17  нижний коридор (концы обрезаны случайно)
 *   y 19–23  полоса C: комнаты, дверь вверх (в нижний коридор)
 * Комнаты разной ширины и неровные: у прямоугольника случайно «откушены» углы.
 * Двери только в горизонтальных стенах — так у дверей и героев два вида: сверху и снизу.
 */
export const W = 31;
export const H = 25;
const ROOM_H = 5;
const MIN_W = 5;
const MAX_W = 9;
const MAX_ROOMS = 9;
/** Минимум мест под пушку, достающую до двери: иначе комнату не защитить, как ни играй. */
const MIN_GUARD_SLOTS = 4;
const C1 = 7;
const C2 = 16;

export const Tile = { Wall: 0, Floor: 1, Soil: 2, Door: 3, Corridor: 4, Nest: 5 } as const;
export type TileT = (typeof Tile)[keyof typeof Tile];

export interface GameMap {
  tiles: TileT[][];
  rooms: Room[];
  /** Центр гнезда призрака. */
  nest: Vec;
}

interface Plan {
  x0: number;
  x1: number;
  y0: number;
  /** Дверь в нижней стене (комната над коридором). */
  top: boolean;
}

export function generateMap(rng: Rng): GameMap {
  for (let attempt = 0; attempt < 200; attempt++) {
    const map = tryGenerate(rng);
    if (map) return map;
  }
  throw new Error('Не удалось сгенерировать этаж');
}

function tryGenerate(rng: Rng): GameMap | null {
  const tiles: TileT[][] = Array.from({ length: H }, () => new Array<TileT>(W).fill(Tile.Wall));
  const set = (x: number, y: number, t: TileT) => {
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) tiles[y][x] = t;
  };

  // Коридоры: верхний во всю ширину, нижний с обрезанными концами, 1–2 перемычки.
  const c2From = 1 + rng.int(5);
  const c2To = W - 2 - rng.int(5);
  const bridges: number[] = [];
  bridges.push(c2From + 2 + rng.int(Math.max(1, Math.floor((c2To - c2From) / 2) - 3)));
  if (rng.next() < 0.6) {
    const x = bridges[0] + 9 + rng.int(Math.max(1, c2To - bridges[0] - 12));
    if (x + 1 <= c2To - 1) bridges.push(x);
  }
  for (let x = 1; x < W - 1; x++) for (let y = C1; y <= C1 + 1; y++) set(x, y, Tile.Corridor);
  for (let x = c2From; x <= c2To; x++) for (let y = C2; y <= C2 + 1; y++) set(x, y, Tile.Corridor);
  for (const bx of bridges) for (let y = C1 + 2; y < C2; y++) for (let x = bx; x <= bx + 1; x++) set(x, y, Tile.Corridor);
  const nestX0 = W - 5;
  for (let x = nestX0; x <= W - 2; x++) for (let y = C1; y <= C1 + 1; y++) set(x, y, Tile.Nest);

  // Полосы под комнаты: A и C целиком, B — куски между перемычками.
  const plans: Plan[] = [];
  const cut = (y0: number, from: number, to: number, top: () => boolean) => {
    let x = from + rng.int(2);
    while (to - x + 1 >= MIN_W) {
      let w = MIN_W + rng.int(MAX_W - MIN_W + 1);
      w = Math.min(w, to - x + 1);
      // Не оставлять хвост, в который не влезет комната: отдать его этой.
      if (to - (x + w) < MIN_W && to - x + 1 <= MAX_W) w = to - x + 1;
      plans.push({ x0: x, x1: x + w - 1, y0, top: top() });
      x += w + 1;
    }
  };
  cut(1, 1, nestX0 - 2, () => true);
  cut(C2 + 3, 1, W - 2, () => false);
  const walls = [0, ...bridges.flatMap((b) => [b - 1, b + 2]), W - 1];
  for (let i = 0; i + 1 < walls.length; i += 2) cut(C1 + 3, walls[i] + 1, walls[i + 1] - 1, () => rng.next() < 0.5);

  const opens = (x: number, doorY: number, top: boolean) => {
    const outY = top ? doorY + 1 : doorY - 1;
    return tiles[outY]?.[x] === Tile.Corridor;
  };

  const rooms: Room[] = [];
  for (const p of rng.shuffle(plans)) {
    if (rooms.length >= MAX_ROOMS) break;
    const room = layoutRoom(rng, rooms.length, p, opens);
    if (room) rooms.push(room);
  }
  if (rooms.length < 7) return null;

  // Порядок id — слева направо, сверху вниз: удобнее читать и тестировать.
  rooms.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).forEach((r, i) => (r.id = i));
  for (const r of rooms) {
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) if (cellIn(r, x, y)) tiles[y][x] = Tile.Floor;
    for (const s of r.soil) tiles[s.y][s.x] = Tile.Soil;
    tiles[r.door.y][r.door.x] = Tile.Door;
  }
  return { tiles, rooms, nest: { x: W - 2.5, y: C1 + 1 } };
}

function layoutRoom(rng: Rng, id: number, p: Plan, opens: (x: number, doorY: number, top: boolean) => boolean): Room | null {
  const w = p.x1 - p.x0 + 1;
  const h = ROOM_H;
  const frontY = p.top ? p.y0 + h - 1 : p.y0;
  const backY = p.top ? p.y0 : p.y0 + h - 1;
  const doorY = p.top ? p.y0 + h : p.y0 - 1;

  for (let attempt = 0; attempt < 60; attempt++) {
    // Форма: прямоугольник с откушенными углами (сзади чаще и крупнее, спереди — мелко).
    const mask = new Array<boolean>(w * h).fill(true);
    const bite = (left: boolean, back: boolean, bw: number, bh: number) => {
      for (let dy = 0; dy < bh; dy++) {
        const y = back ? backY + (p.top ? dy : -dy) : frontY + (p.top ? -dy : dy);
        for (let dx = 0; dx < bw; dx++) {
          const x = left ? p.x0 + dx : p.x1 - dx;
          mask[(y - p.y0) * w + (x - p.x0)] = false;
        }
      }
    };
    for (const left of [true, false]) {
      if (rng.next() < 0.55) bite(left, true, 1 + rng.int(Math.min(3, w - 3)), 1 + rng.int(2));
      if (rng.next() < 0.3) bite(left, false, 1 + rng.int(2), 1 + rng.int(2));
    }
    const has = (x: number, y: number) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y < p.y0 + h && mask[(y - p.y0) * w + (x - p.x0)];
    const area = mask.filter(Boolean).length;
    if (area < 18) continue;

    // Дверь: в передней стене, напротив коридора; за ней две клетки прохода.
    const deeper = p.top ? -1 : 1;
    const doorCols = [];
    for (let x = p.x0 + 1; x < p.x1; x++) if (has(x, frontY) && has(x, frontY + deeper) && opens(x, doorY, p.top)) doorCols.push(x);
    if (!doorCols.length) continue;
    const mid = (p.x0 + p.x1) / 2;
    doorCols.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    const doorX = doorCols[rng.int(Math.min(2, doorCols.length))];

    const cells: Vec[] = [];
    for (let y = p.y0; y < p.y0 + h; y++) for (let x = p.x0; x <= p.x1; x++) if (has(x, y)) cells.push({ x, y });
    const isEdge = (v: Vec) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !has(v.x + dx, v.y + dy));
    const inside = { x: doorX, y: frontY };
    const approach = { x: doorX, y: frontY + deeper };

    const taken = new Set([key(inside.x, inside.y), key(approach.x, approach.y)]);
    const take = (list: Vec[]): Vec | null => {
      for (const v of rng.shuffle([...list])) {
        if (!taken.has(key(v.x, v.y))) {
          taken.add(key(v.x, v.y));
          return { x: v.x, y: v.y };
        }
      }
      return null;
    };

    const sofa = take(cells.filter((v) => v.y !== frontY && isEdge(v)));
    if (!sofa) continue;

    // Мебель в комнате не повторяется: два одинаковых шкафа смотрелись как баг.
    const furniture: Room['furniture'] = [];
    const variants = rng.shuffle([1, 2, 3]);
    for (let n = 1 + rng.int(2); n > 0; n--) {
      const v = take(cells.filter(isEdge));
      if (v) furniture.push({ ...v, variant: variants[furniture.length] });
    }

    const items: Item[] = [];
    for (const kind of rng.shuffle<ItemKind>(['lavender', 'safe', 'toolbox']).slice(0, rng.int(3))) {
      const v = take(cells.filter(isEdge));
      if (v) items.push({ kind, ...v });
    }

    const soil: Vec[] = [];
    for (let n = 2 + rng.int(2); n > 0; n--) {
      const v = take(cells.filter((c) => !isEdge(c) && c.y !== frontY));
      if (v) soil.push(v);
    }
    if (soil.length < 2) continue;

    const hp = doorMaxHp(1);
    const room: Room = {
      id,
      x0: p.x0,
      y0: p.y0,
      w,
      h,
      mask,
      top: p.top,
      door: {
        x: doorX,
        y: doorY,
        inside,
        front: { x: doorX + 0.5, y: p.top ? doorY + 1.5 : doorY - 0.5 },
        level: 1,
        hp,
        maxHp: hp,
        broken: false,
        repairCd: 0,
      },
      sofa: { ...sofa, level: 1 },
      furniture,
      soil,
      items,
      buildings: [],
      ownerId: null,
      eliminated: false,
      candy: 0,
      flame: 0,
    };
    if (allConnected(room) && guardSlots(room) >= MIN_GUARD_SLOTS) return room;
  }
  return null;
}

/** Свободные клетки комнаты, откуда пушка достаёт до места, где призрак ломает дверь. */
export function guardSlots(r: Room): number {
  const f = r.door.front;
  const busy = [r.door.inside, r.sofa, ...r.soil, ...r.furniture, ...r.items];
  return roomCells(r).filter(
    (c) => !busy.some((b) => b.x === c.x && b.y === c.y) && Math.hypot(c.x + 0.5 - f.x, c.y + 0.5 - f.y) <= B.cannon.range,
  ).length;
}
