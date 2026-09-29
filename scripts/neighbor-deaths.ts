/// <reference types="node" />
/**
 * Сколько соседей ловят за матч и когда (ИИ-игрок, все постройки): npx tsx scripts/neighbor-deaths.ts [сложность=all] [матчей=200]
 * Ответ на «почему соседи никогда не умирают»: доля матчей без единой потери соседей, среднее число пойманных, время первой поимки.
 */
import { Match } from '../src/sim/match';
import type { Difficulty } from '../src/sim/types';

const arg = process.argv[2] ?? 'all';
const N = Number(process.argv[3] ?? 200);
const diffs: Difficulty[] = arg === 'all' ? ['easy', 'hard', 'nightmare'] : [arg as Difficulty];
for (const d of diffs) {
  let none = 0, total = 0, wins = 0;
  const first: number[] = [], caughtAt: number[] = [];
  const nightLen: number[] = [];
  const byReason = { doorBroken: 0, caught: 0 };
  for (let seed = 1; seed <= N; seed++) {
    const m = new Match({ seed: seed * 7919, difficulty: d, flameUnlocked: true, autoPlayer: true, autoPlayerSkill: 0.6 });
    let n = 0;
    let firstAt = -1;
    for (let i = 0; i < 20 * 2400 && m.phase !== 'end'; i++) {
      m.step();
      for (const e of m.events) {
        if (e.type === 'caught' && e.charId !== m.playerId) {
          n++;
          caughtAt.push(m.nightTime);
          if (firstAt < 0) firstAt = m.nightTime;
        }
        if (e.type === 'doorBroken' && m.rooms[e.roomId].ownerId !== m.playerId) byReason.doorBroken++;
      }
    }
    if (m.result === 'win') wins++;
    if (n === 0) none++;
    total += n;
    if (firstAt >= 0) first.push(firstAt);
    nightLen.push(m.nightTime);
  }
  const avg = (a: number[]) => (a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(0) : '-');
  console.log(`${d.padEnd(10)} матчей ${N}: побед ${((100 * wins) / N).toFixed(0)}% | без потерь соседей ${((100 * none) / N).toFixed(0)}% | пойманных соседей за матч ${(total / N).toFixed(2)} (из 5) | первая поимка в среднем на ${avg(first)} с | ночь ${avg(nightLen)} с | сломанных дверей у соседей ${(byReason.doorBroken / N).toFixed(1)}`);
}
