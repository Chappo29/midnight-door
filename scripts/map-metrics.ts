/// <reference types="node" />
/**
 * Метрики генератора этажа (level design: всё мерим в единицах персонажа).
 *   npx tsx scripts/map-metrics.ts [число карт]
 * Печатает наблюдения, а не вердикты: распределения и сколько карт вышли за ориентиры.
 */
import { B } from '../src/sim/balance';
import { Tile, generateMap, guardSlots } from '../src/sim/map';
import { bfs } from '../src/sim/path';
import { Rng } from '../src/sim/rng';
import { roomCells } from '../src/sim/roomgrid';

const N = Number(process.argv[2] ?? 500);

const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `мин ${s[0].toFixed(1)} · 10% ${q(0.1).toFixed(1)} · медиана ${q(0.5).toFixed(1)} · 90% ${q(0.9).toFixed(1)} · макс ${s.at(-1)!.toFixed(1)}`;
};

const rooms: number[] = [];
const area: number[] = [];
const slots: number[] = [];
const ghostTravel: number[] = [];
const walkIn: number[] = [];
const areaSpread: number[] = [];
const travelSpread: number[] = [];
let fewSlots = 0;

for (let seed = 1; seed <= N; seed++) {
  const map = generateMap(new Rng(seed));
  const hall = (x: number, y: number) => map.tiles[y]?.[x] === Tile.Corridor || map.tiles[y]?.[x] === Tile.Nest;
  const nest = { x: Math.floor(map.nest.x), y: Math.floor(map.nest.y) };
  const corridor: { x: number; y: number }[] = [];
  map.tiles.forEach((row, y) => row.forEach((t, x) => t === Tile.Corridor && corridor.push({ x, y })));
  rooms.push(map.rooms.length);
  const areas: number[] = [];
  const travels: number[] = [];
  for (const r of map.rooms) {
    const a = roomCells(r).length;
    areas.push(a);
    area.push(a);
    const g = guardSlots(r);
    slots.push(g);
    if (g < 4) fewSlots++;
    const front = { x: Math.floor(r.door.front.x), y: Math.floor(r.door.front.y) };
    const path = bfs(nest, [front], hall)!;
    const t = path.length / B.ghost.speed;
    travels.push(t);
    ghostTravel.push(t);
    // Худший случай: от самой дальней точки коридора до своей двери.
    let worst = 0;
    for (const c of corridor.filter((_, i) => i % 7 === 0)) worst = Math.max(worst, bfs(c, [front], hall)!.length);
    walkIn.push(worst / B.walkSpeed);
  }
  areaSpread.push(Math.max(...areas) / Math.min(...areas));
  travelSpread.push(Math.max(...travels) - Math.min(...travels));
}

console.log(`карт: ${N}`);
console.log(`комнат на карте:          ${stat(rooms)}`);
console.log(`площадь комнаты, клеток:  ${stat(area)}`);
console.log(`разброс площади (макс/мин в одной карте): ${stat(areaSpread)}`);
console.log(`мест под пушку у двери (в радиусе ${B.cannon.range}): ${stat(slots)}; комнат, где меньше 4: ${fewSlots} из ${area.length}`);
console.log(`призрак от гнезда до двери, с:  ${stat(ghostTravel)}`);
console.log(`разброс этого времени в одной карте, с: ${stat(travelSpread)}`);
console.log(`герой из худшей точки коридора до двери, с: ${stat(walkIn)} (на выбор+заселение: ${B.phase.pick} с + подготовка ${B.phase.prep} с)`);
