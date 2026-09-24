import { DIRS, key } from './roomgrid';
import type { Vec } from './types';

/**
 * Поиск пути в ширину по сетке. Возвращает клетки после `start` до ближайшей цели
 * (пустой массив — уже стоим на цели) или null, если дойти нельзя.
 * Комнаты маленькие (6×5), так что BFS хватает с запасом.
 */
export function bfs(start: Vec, goals: readonly Vec[], passable: (x: number, y: number) => boolean): Vec[] | null {
  const goalKeys = new Set(goals.map((g) => key(g.x, g.y)));
  if (goalKeys.has(key(start.x, start.y))) return [];

  const parent = new Map<string, Vec | null>([[key(start.x, start.y), null]]);
  const queue: Vec[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const d of DIRS) {
      const next = { x: cur.x + d.x, y: cur.y + d.y };
      const k = key(next.x, next.y);
      if (parent.has(k) || !passable(next.x, next.y)) continue;
      parent.set(k, cur);
      if (goalKeys.has(k)) {
        const path: Vec[] = [];
        for (let v: Vec | null = next; v && !(v.x === start.x && v.y === start.y); v = parent.get(key(v.x, v.y)) ?? null) {
          path.unshift(v);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
