/// <reference types="node" />
/**
 * Замер давления призрака на игрока (GHOST_ATTACK_DIRECTOR.md): N сидов одной сложности, ИИ-игрок.
 *   npx tsx scripts/attack-director-sim.ts easy 500                 — как сейчас в balance.ts
 *   npx tsx scripts/attack-director-sim.ts easy 500 '{"enabled":false}'   — со своими числами режиссёра
 *   npx tsx scripts/attack-director-sim.ts easy 500 '{}' 0.3 out.json — умение ИИ-игрока и файл для сравнения
 * «Атака» — настоящая осада (siegeEnd.meaningful, B.ghost.meaningfulHits ударов); время — секунды ночи.
 */
import fs from 'fs';
import { ATTACK_DIRECTOR } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import type { Difficulty, SiegeEndReason } from '../src/sim/types';

const diff = (process.argv[2] ?? 'easy') as Difficulty;
const N = Number(process.argv[3] ?? 500);
Object.assign(ATTACK_DIRECTOR[diff], JSON.parse(process.argv[4] ?? '{}'));
const skill = Number(process.argv[5] ?? 0.5);
const outFile = process.argv[6];
const MAX_SEC = 2400;

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const share = (xs: boolean[]) => (xs.length ? (100 * xs.filter(Boolean).length) / xs.length : NaN);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

interface MatchStat {
  first: number | null;
  visits3: number;
  visits6: number | null;
  total: number;
  alive: number;
  maxGap: number;
  intervals: number[];
  minDoor: number;
  caught: boolean;
  win: boolean;
  neighborsAlive: number;
  night: number;
  sieges: { dur: number; hits: number; dmgFrac: number; reason: SiegeEndReason; meaningful: boolean }[];
  neighborMeaningful: number;
  neighborMinutes: number;
}

const stats: MatchStat[] = [];
for (let seed = 1; seed <= N; seed++) {
  const m = new Match({ seed: seed * 7919, difficulty: diff, flameUnlocked: true, autoPlayer: true, autoPlayerSkill: skill });
  const starts: number[] = [];
  const ends: number[] = [];
  const sieges: MatchStat['sieges'] = [];
  let aliveEnd = -1;
  let minDoor = 1;
  let neighborMeaningful = 0;
  let neighborMinutes = 0;
  for (let i = 0; i < 20 * MAX_SEC && m.phase !== 'end'; i++) {
    m.step();
    if (m.phase !== 'night') continue;
    const r = m.playerRoom!;
    for (const e of m.events) {
      if (e.type !== 'siegeEnd') continue;
      if (e.roomId === r.id) {
        sieges.push({ dur: e.duration, hits: e.hits, dmgFrac: e.dmg / r.door.maxHp, reason: e.reason, meaningful: e.meaningful });
        if (e.meaningful && aliveEnd < 0) {
          starts.push(e.start);
          ends.push(e.start + e.duration);
        }
      } else if (e.meaningful) neighborMeaningful++;
    }
    neighborMinutes += (m.rooms.filter((q) => q.ownerId !== null && q.ownerId !== m.playerId && !q.eliminated).length * 0.05) / 60;
    if (aliveEnd < 0) {
      minDoor = Math.min(minDoor, r.door.hp / r.door.maxHp);
      if (m.player.caught) aliveEnd = m.nightTime;
    }
  }
  const alive = aliveEnd < 0 ? m.nightTime : aliveEnd;
  // Затишья: от начала ночи до первой атаки, между концом одной и началом следующей, от последней до конца.
  const gaps: number[] = [];
  let calm = 0;
  for (let k = 0; k < starts.length; k++) {
    gaps.push(starts[k] - calm);
    calm = ends[k];
  }
  gaps.push(Math.max(0, alive - calm));
  stats.push({
    first: starts.length ? starts[0] : null,
    visits3: starts.filter((s) => s <= 180).length,
    visits6: alive >= 360 ? starts.filter((s) => s <= 360).length : null,
    total: starts.length,
    alive,
    maxGap: Math.max(...gaps),
    intervals: starts.slice(1).map((s, k) => s - starts[k]),
    minDoor,
    caught: m.player.caught,
    win: m.result === 'win',
    neighborsAlive: m.rooms.filter((q) => q.ownerId !== null && q.ownerId !== m.playerId && !q.eliminated).length,
    night: m.nightTime,
    sieges,
    neighborMeaningful,
    neighborMinutes,
  });
}

const firsts = stats.map((s) => s.first ?? s.alive);
const v6 = stats.filter((s) => s.visits6 !== null).map((s) => s.visits6!);
const allSieges = stats.flatMap((s) => s.sieges);
const meaningful = allSieges.filter((s) => s.meaningful);
const reasons: Record<string, number> = {};
for (const s of allSieges) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
const intervals = stats.flatMap((s) => s.intervals);

const result = {
  diff,
  N,
  skill,
  director: ATTACK_DIRECTOR[diff],
  first: { median: pct(firsts, 0.5), p90: pct(firsts, 0.9), never: share(stats.map((s) => s.first === null)) },
  visits3: { median: pct(stats.map((s) => s.visits3), 0.5) },
  visits6: {
    matches: v6.length,
    median: pct(v6, 0.5),
    p10: pct(v6, 0.1),
    p90: pct(v6, 0.9),
    zero: share(v6.map((v) => v === 0)),
    le1: share(v6.map((v) => v <= 1)),
    le2: share(v6.map((v) => v <= 2)),
  },
  attacksPerMin: avg(stats.map((s) => s.total / Math.max(1, s.alive / 60))),
  totalMedian: pct(stats.map((s) => s.total), 0.5),
  interval: { median: pct(intervals, 0.5), p10: pct(intervals, 0.1), p90: pct(intervals, 0.9) },
  maxGap: {
    median: pct(stats.map((s) => s.maxGap), 0.5),
    p90: pct(stats.map((s) => s.maxGap), 0.9),
    over60: share(stats.map((s) => s.maxGap > 60)),
    over90: share(stats.map((s) => s.maxGap > 90)),
    over120: share(stats.map((s) => s.maxGap > 120)),
    over180: share(stats.map((s) => s.maxGap > 180)),
  },
  door: {
    minMedian: pct(stats.map((s) => s.minDoor), 0.5),
    below70: share(stats.map((s) => s.minDoor < 0.7)),
    below50: share(stats.map((s) => s.minDoor < 0.5)),
    below40: share(stats.map((s) => s.minDoor < 0.4)),
    below30: share(stats.map((s) => s.minDoor < 0.3)),
    below20: share(stats.map((s) => s.minDoor < 0.2)),
  },
  outcome: {
    caught: share(stats.map((s) => s.caught)),
    win: share(stats.map((s) => s.win)),
    neighborsAlive: avg(stats.map((s) => s.neighborsAlive)),
    nightMin: avg(stats.map((s) => s.night)) / 60,
  },
  siege: {
    count: allSieges.length,
    meaningfulShare: (100 * meaningful.length) / Math.max(1, allSieges.length),
    duration: { median: pct(allSieges.map((s) => s.dur), 0.5), p10: pct(allSieges.map((s) => s.dur), 0.1), p90: pct(allSieges.map((s) => s.dur), 0.9) },
    hits: { median: pct(allSieges.map((s) => s.hits), 0.5), p10: pct(allSieges.map((s) => s.hits), 0.1), p90: pct(allSieges.map((s) => s.hits), 0.9) },
    doorDmgPct: { median: 100 * pct(allSieges.map((s) => s.dmgFrac), 0.5), p90: 100 * pct(allSieges.map((s) => s.dmgFrac), 0.9) },
    reasons: Object.fromEntries(Object.entries(reasons).map(([k, v]) => [k, Math.round((100 * v) / allSieges.length)])),
  },
  neighbors: { attacksPerMin: stats.reduce((s, x) => s + x.neighborMeaningful, 0) / Math.max(1, stats.reduce((s, x) => s + x.neighborMinutes, 0)) },
};

const f = (x: number, d = 0) => (Number.isNaN(x) ? '—' : x.toFixed(d));
console.log(
  `${diff} [${ATTACK_DIRECTOR[diff].enabled ? 'режиссёр' : 'старый выбор'}] N=${N}, умение ${skill}\n` +
    `  первая атака: медиана ${f(result.first.median)} с, P90 ${f(result.first.p90)} с, не было ${f(result.first.never, 1)}%\n` +
    `  атак за 3 мин: ${f(result.visits3.median)} | за 6 мин (из ${v6.length} матчей): медиана ${f(result.visits6.median)} (P10 ${f(result.visits6.p10)}, P90 ${f(result.visits6.p90)}), 0 — ${f(result.visits6.zero, 1)}%, ≤1 — ${f(result.visits6.le1, 1)}%, ≤2 — ${f(result.visits6.le2, 1)}%\n` +
    `  атак в минуту ${f(result.attacksPerMin, 2)}, интервал между атаками: медиана ${f(result.interval.median)} с (P10 ${f(result.interval.p10)}, P90 ${f(result.interval.p90)})\n` +
    `  макс. затишье: медиана ${f(result.maxGap.median)} с, P90 ${f(result.maxGap.p90)} с | >60 ${f(result.maxGap.over60)}%, >90 ${f(result.maxGap.over90)}%, >120 ${f(result.maxGap.over120)}%, >180 ${f(result.maxGap.over180)}%\n` +
    `  дверь: мин. HP медиана ${f(result.door.minMedian * 100)}% | <70 ${f(result.door.below70)}%, <50 ${f(result.door.below50)}%, <40 ${f(result.door.below40)}%, <30 ${f(result.door.below30)}%, <20 ${f(result.door.below20)}%\n` +
    `  итог: поймали ${f(result.outcome.caught, 1)}%, победа ${f(result.outcome.win, 1)}%, соседей живых ${f(result.outcome.neighborsAlive, 2)}, ночь ${f(result.outcome.nightMin, 1)} мин\n` +
    `  осады игрока: ${result.siege.count}, настоящих ${f(result.siege.meaningfulShare)}% | длительность медиана ${f(result.siege.duration.median, 1)} с (P10 ${f(result.siege.duration.p10, 1)}, P90 ${f(result.siege.duration.p90, 1)}), ударов ${f(result.siege.hits.median)} (P10 ${f(result.siege.hits.p10)}, P90 ${f(result.siege.hits.p90)}), урон двери ${f(result.siege.doorDmgPct.median)}% (P90 ${f(result.siege.doorDmgPct.p90)}%)\n` +
    `  почему ушёл: ${JSON.stringify(result.siege.reasons)} | соседи: атак на соседа в минуту ${f(result.neighbors.attacksPerMin, 3)}`,
);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
