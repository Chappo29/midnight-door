import type { Building, Room, Vec } from './types';

export const key = (x: number, y: number) => `${x},${y}`;
export const DIRS: readonly Vec[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Клетка принадлежит комнате (комнаты неровные — проверяется по маске). */
export function cellIn(r: Pick<Room, 'x0' | 'y0' | 'w' | 'h' | 'mask'>, x: number, y: number): boolean {
  return x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h && r.mask[(y - r.y0) * r.w + (x - r.x0)];
}

export function inRoom(r: Room, x: number, y: number): boolean {
  return cellIn(r, x, y);
}

/** Все клетки комнаты. */
export function roomCells(r: Room): Vec[] {
  const cells: Vec[] = [];
  for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) if (cellIn(r, x, y)) cells.push({ x, y });
  return cells;
}

/** Клетка комнаты ближе всего к её середине — для подписей и камеры (середина неровной комнаты может быть стеной). */
export function roomCenter(r: Room): Vec {
  const mx = r.x0 + r.w / 2 - 0.5;
  const my = r.y0 + r.h / 2 - 0.5;
  let best = roomCells(r)[0];
  for (const c of roomCells(r)) if (Math.hypot(c.x - mx, c.y - my) < Math.hypot(best.x - mx, best.y - my)) best = c;
  return { x: best.x + 0.5, y: best.y + 0.5 };
}

export function roomAtCell(rooms: readonly Room[], x: number, y: number): Room | null {
  return rooms.find((r) => inRoom(r, x, y)) ?? null;
}

export function roomAtPoint(rooms: readonly Room[], px: number, py: number): Room | null {
  return roomAtCell(rooms, Math.floor(px), Math.floor(py));
}

export function roomByDoor(rooms: readonly Room[], x: number, y: number): Room | null {
  return rooms.find((r) => r.door.x === x && r.door.y === y) ?? null;
}

export function buildingAt(r: Room, x: number, y: number): Building | undefined {
  return r.buildings.find((b) => b.x === x && b.y === y);
}

export type Occupant = 'sofa' | 'furniture' | 'item' | Building | null;

export function occupantAt(r: Room, x: number, y: number): Occupant {
  if (r.sofa.x === x && r.sofa.y === y) return 'sofa';
  if (r.furniture.some((f) => f.x === x && f.y === y)) return 'furniture';
  if (r.items.some((i) => i.x === x && i.y === y)) return 'item';
  return buildingAt(r, x, y) ?? null;
}

export function isSoil(r: Room, x: number, y: number): boolean {
  return r.soil.some((s) => s.x === x && s.y === y);
}

export function walkable(r: Room, x: number, y: number, blocked?: Vec): boolean {
  if (!inRoom(r, x, y) || occupantAt(r, x, y) !== null) return false;
  return !(blocked && blocked.x === x && blocked.y === y);
}

/**
 * Комната «проходима»: от двери можно дойти до каждой свободной клетки,
 * к дивану и к каждой постройке можно подойти вплотную.
 * `blocked` — клетка, которую хотим занять новой постройкой.
 */
export function allConnected(r: Room, blocked?: Vec): boolean {
  const start = r.door.inside;
  if (!walkable(r, start.x, start.y, blocked)) return false;

  let total = 0;
  for (const c of roomCells(r)) if (walkable(r, c.x, c.y, blocked)) total++;

  const seen = new Set([key(start.x, start.y)]);
  const queue: Vec[] = [start];
  while (queue.length) {
    const c = queue.pop()!;
    for (const d of DIRS) {
      const nx = c.x + d.x;
      const ny = c.y + d.y;
      const k = key(nx, ny);
      if (!seen.has(k) && walkable(r, nx, ny, blocked)) {
        seen.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  if (seen.size !== total) return false;

  const reachable = (v: Vec) => DIRS.some((d) => seen.has(key(v.x + d.x, v.y + d.y)));
  if (!reachable(r.sofa)) return false;
  if (!r.buildings.every(reachable)) return false;
  return !blocked || reachable(blocked);
}
