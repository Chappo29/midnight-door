/// <reference types="node" />
/**
 * Замер core loop (CORE_LOOP_UX_PASS.md): угроза атак, ремонт, пустые паузы, пламя — для игрока-ИИ,
 * который реагирует как внимательный ребёнок (решение раз в ~1–2 с, без долгого отдыха после покупки).
 *   npx tsx scripts/core-loop-sim.ts [сложность=easy] [матчей=200] [сценарий=m1|m2|all] [patch JSON] [опции JSON]
 * patch: {"ghost":{"switchMin":9}} правит B, {"DIFF":{"easy":{"ghostMul":0.8}}} — сложность, {"pumpkin":{"rate":0.6}} …
 * опции: {"skill":0.6,"pace":0.35,"noRepair":true,"out":"file.json"}
 *   сценарий m1 — первый матч (тыква и поздние постройки закрыты), m2 — второй (открыта тыква), all — открыто всё.
 * Время — секунды от начала подготовки (скука считается и до полуночи). «Событие» — покупка/улучшение, ремонт,
 * начало настоящей атаки на игрока.
 */
import fs from 'fs';
import { ATTACK_DIRECTOR, B, DIFF } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import type { BuildKind, Difficulty } from '../src/sim/types';

const diff = (process.argv[2] ?? 'easy') as Difficulty;
const N = Number(process.argv[3] ?? 200);
const scenario = process.argv[4] ?? 'm1';
const patch = JSON.parse(process.argv[5] || '{}') as Record<string, Record<string, unknown>>;
const o = JSON.parse(process.argv[6] || '{}') as { skill?: number; pace?: number; noRepair?: boolean; out?: string };
const skill = o.skill ?? 0.6;
const pace = o.pace ?? 0.35;
for (const [k, v] of Object.entries(patch)) {
  if (k === 'DIFF') for (const [d, p] of Object.entries(v)) Object.assign(DIFF[d as Difficulty], p);
  else if (k === 'DIRECTOR') for (const [d, p] of Object.entries(v)) Object.assign(ATTACK_DIRECTOR[d as Difficulty], p);
  else if (typeof v !== 'object') (B as unknown as Record<string, unknown>)[k] = v;
  else Object.assign((B as unknown as Record<string, object>)[k], v);
}
const LOCKED: Record<string, BuildKind[]> = {
  m1: ['pumpkin', 'trap', 'workbench', 'fridge'],
  m2: ['trap', 'workbench', 'fridge'],
  m3: ['workbench', 'fridge'],
  all: [],
};
const MAX_SEC = 2400;

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const share = (xs: boolean[]) => (xs.length ? (100 * xs.filter(Boolean).length) / xs.length : NaN);

interface Siege {
  idx: number;
  doorLevel: number;
  ghostLevel: number;
  loss: number;
  minFrac: number;
  dur: number;
  repairs: number;
}
interface Stat {
  win: boolean;
  caught: boolean;
  night: number;
  minDoor: number;
  repairs: number;
  sieges: Siege[];
  maxGap: number;
  gapsOver30: number;
  firstBored: number | null;
  boredShare: number;
  purchaseGaps: number[];
  candyAvg: number;
  flameAvg: number;
  flameMax: number;
  flameEnd: number;
  flameFirstUse: number | null;
  flameEarned: number;
  flameSpent: number;
  purchases: number;
}

const stats: Stat[] = [];
const gapEnders: { what: string; at: number; gap: number }[] = [];
for (let seed = 1; seed <= N; seed++) {
  const m = new Match({ seed: seed * 7919, difficulty: diff, flameUnlocked: true, lockedKinds: LOCKED[scenario], autoPlayer: true, autoPlayerSkill: skill });
  m.player.profile = { ...m.player.profile, pace };
  const events: number[] = [];
  const labeled: { t: number; what: string }[] = [];
  const purchases: number[] = [];
  const sieges: Siege[] = [];
  let cur: { start: number; startFrac: number; minFrac: number; repairs: number } | null = null;
  let prepAt = -1;
  let minDoor = 1;
  let repairs = 0;
  let candySum = 0;
  let flameSum = 0;
  let flameMax = 0;
  let ticks = 0;
  let pumpkinAt = -1;
  let flameFirstUse: number | null = null;
  let flameEarned = 0;
  let flameSpent = 0;
  let prevFlame = 0;
  let end = -1;
  for (let i = 0; i < 20 * MAX_SEC && m.phase !== 'end'; i++) {
    const r0 = m.playerRoom;
    if (o.noRepair && r0) r0.door.repairCd = 999;
    m.step();
    const r = m.playerRoom;
    if (prepAt < 0 && m.phase === 'prep') prepAt = m.time;
    if (!r || prepAt < 0 || end >= 0) continue;
    const t = m.time - prepAt;
    const d = r.door;
    const frac = d.hp / d.maxHp;
    // Пламя: рост — доход, падение — трата.
    if (r.flame > prevFlame) flameEarned += r.flame - prevFlame;
    else if (r.flame < prevFlame - 1e-6) {
      flameSpent += prevFlame - r.flame;
      if (flameFirstUse === null && pumpkinAt >= 0) flameFirstUse = t - pumpkinAt;
    }
    prevFlame = r.flame;
    for (const e of m.events) {
      if ('roomId' in e && e.roomId !== r.id) continue;
      if (e.type === 'built' || e.type === 'upgraded' || e.type === 'doorUpgraded' || e.type === 'sofaUpgraded') {
        events.push(t);
        purchases.push(t);
        const lvl = 'level' in e ? e.level : 1;
        const what = e.type === 'built' ? `build:${e.kind}` : e.type === 'upgraded' ? `up:${r.buildings.find((b) => b.x === e.x && b.y === e.y)?.kind}${lvl}` : e.type === 'doorUpgraded' ? `door${lvl}` : `sofa${lvl}`;
        labeled.push({ t, what });
        if (e.type === 'built' && e.kind === 'pumpkin' && pumpkinAt < 0) pumpkinAt = t;
      } else if (e.type === 'repaired') {
        events.push(t);
        labeled.push({ t, what: 'repair' });
        if (m.phase === 'night') repairs++;
        if (cur) cur.repairs++;
      } else if (e.type === 'siegeEnd' && e.meaningful) {
        events.push(e.start - m.nightTime + t);
        labeled.push({ t: e.start - m.nightTime + t, what: 'attack' });
        if (cur) sieges.push({ idx: sieges.length + 1, doorLevel: r.door.level, ghostLevel: m.ghost.level, loss: cur.startFrac - cur.minFrac, minFrac: cur.minFrac, dur: e.duration, repairs: cur.repairs });
        cur = null;
      } else if (e.type === 'siegeEnd') cur = null;
    }
    const g = m.ghost;
    if (g.siegeRoom === r.id && !cur) cur = { start: t, startFrac: frac, minFrac: frac, repairs: 0 };
    if (cur) cur.minFrac = Math.min(cur.minFrac, frac);
    if (m.phase === 'night') {
      minDoor = Math.min(minDoor, frac);
      candySum += r.candy;
      flameSum += r.flame;
      flameMax = Math.max(flameMax, r.flame);
      ticks++;
    }
    if (m.player.caught || m.result) end = t;
  }
  const r = m.playerRoom!;
  const last = end >= 0 ? end : m.time - prepAt;
  const ts = [0, ...events.filter((x) => x >= 0).sort((a, b) => a - b), last];
  let maxGap = 0;
  let over30 = 0;
  let boredTime = 0;
  let firstBored: number | null = null;
  for (let k = 1; k < ts.length; k++) {
    const gap = ts[k] - ts[k - 1];
    maxGap = Math.max(maxGap, gap);
    if (gap > 30) {
      over30++;
      boredTime += gap - 30;
      if (firstBored === null) firstBored = ts[k - 1] + 30;
    }
  }
  purchases.sort((a, b) => a - b);
  labeled.sort((a, b) => a.t - b.t);
  for (let k = 1; k < labeled.length; k++) {
    const gap = labeled[k].t - labeled[k - 1].t;
    if (gap > 30) gapEnders.push({ what: labeled[k].what, at: labeled[k - 1].t, gap });
  }
  stats.push({
    win: m.result === 'win' && !m.player.caught,
    caught: m.player.caught,
    night: m.nightTime,
    minDoor,
    repairs,
    sieges,
    maxGap,
    gapsOver30: over30,
    firstBored,
    boredShare: boredTime / Math.max(1, last),
    purchaseGaps: purchases.slice(1).map((x, k) => x - purchases[k]),
    candyAvg: candySum / Math.max(1, ticks),
    flameAvg: flameSum / Math.max(1, ticks),
    flameMax,
    flameEnd: r.flame,
    flameFirstUse,
    flameEarned,
    flameSpent,
    purchases: purchases.length,
  });
}

const S = stats.flatMap((s) => s.sieges);
const f = (x: number, d = 0) => (Number.isNaN(x) ? '—' : x.toFixed(d));
const res = {
  diff,
  scenario,
  N,
  skill,
  pace,
  noRepair: !!o.noRepair,
  patch,
  win: share(stats.map((s) => s.win)),
  caught: share(stats.map((s) => s.caught)),
  nightMin: avg(stats.map((s) => s.night)) / 60,
  nightP90: pct(stats.map((s) => s.night), 0.9) / 60,
  minDoorMedian: pct(stats.map((s) => s.minDoor), 0.5),
  minDoorBelow50: share(stats.map((s) => s.minDoor < 0.5)),
  repairsPerMatch: avg(stats.map((s) => s.repairs)),
  siegesPerMatch: S.length / N,
  siegeLoss: { median: pct(S.map((s) => s.loss), 0.5), p90: pct(S.map((s) => s.loss), 0.9) },
  siegeDur: pct(S.map((s) => s.dur), 0.5),
  siegeNoticeable: share(S.map((s) => s.loss >= 0.2)),
  siegeNeedsRepair: share(S.map((s) => s.minFrac < 0.5)),
  siegeRepaired: share(S.map((s) => s.repairs > 0)),
  maxGap: { median: pct(stats.map((s) => s.maxGap), 0.5), p90: pct(stats.map((s) => s.maxGap), 0.9) },
  gapsOver30: avg(stats.map((s) => s.gapsOver30)),
  firstBored: pct(stats.map((s) => s.firstBored ?? Infinity), 0.5),
  boredShare: avg(stats.map((s) => s.boredShare)),
  purchaseGap: { median: pct(stats.flatMap((s) => s.purchaseGaps), 0.5), p90: pct(stats.flatMap((s) => s.purchaseGaps), 0.9) },
  purchases: avg(stats.map((s) => s.purchases)),
  candyAvg: avg(stats.map((s) => s.candyAvg)),
  flame: {
    avg: avg(stats.map((s) => s.flameAvg)),
    max: pct(stats.map((s) => s.flameMax), 0.5),
    end: pct(stats.map((s) => s.flameEnd), 0.5),
    firstUse: pct(stats.filter((s) => s.flameFirstUse !== null).map((s) => s.flameFirstUse!), 0.5),
    neverUsed: share(stats.map((s) => s.flameFirstUse === null)),
    spentShare: (100 * stats.reduce((a, s) => a + s.flameSpent, 0)) / Math.max(1, stats.reduce((a, s) => a + s.flameEarned, 0)),
    earned: pct(stats.map((s) => s.flameEarned), 0.5),
    spent: pct(stats.map((s) => s.flameSpent), 0.5),
    firstUseP90: pct(stats.filter((s) => s.flameFirstUse !== null).map((s) => s.flameFirstUse!), 0.9),
    firstUseBy120: share(stats.map((s) => s.flameFirstUse !== null && s.flameFirstUse <= 120)),
  },
};
console.log(
  `${diff} ${scenario} N=${N} skill ${skill} pace ${pace}${o.noRepair ? ' БЕЗ РЕМОНТА' : ''} ${JSON.stringify(patch)}\n` +
    `  исход: победа ${f(res.win, 1)}%, поймали ${f(res.caught, 1)}%, ночь ${f(res.nightMin, 1)} мин (P90 ${f(res.nightP90, 1)})\n` +
    `  дверь: мин. HP медиана ${f(res.minDoorMedian * 100)}%, <50% в ${f(res.minDoorBelow50)}% матчей | ремонтов за матч ${f(res.repairsPerMatch, 1)}\n` +
    `  атаки на игрока: ${f(res.siegesPerMatch, 1)} за матч, длятся ${f(res.siegeDur, 1)} с, потеря двери медиана ${f(res.siegeLoss.median * 100)}% (P90 ${f(res.siegeLoss.p90 * 100)}%)` +
    ` | заметных (≥20%) ${f(res.siegeNoticeable)}%, нужен ремонт (<50%) ${f(res.siegeNeedsRepair)}%, чинил ${f(res.siegeRepaired)}%\n` +
    `  паузы: макс. без события медиана ${f(res.maxGap.median)} с (P90 ${f(res.maxGap.p90)}), пауз >30 с ${f(res.gapsOver30, 1)} за матч, первая скука ${f(res.firstBored)} с, доля «скучного» времени ${f(res.boredShare * 100)}%\n` +
    `  покупки: ${f(res.purchases, 1)} за матч, между ними медиана ${f(res.purchaseGap.median)} с (P90 ${f(res.purchaseGap.p90)}), конфет в среднем на руках ${f(res.candyAvg)}\n` +
    `  пламя: в среднем ${f(res.flame.avg)}, максимум ${f(res.flame.max)}, в конце ${f(res.flame.end)}, первое применение через ${f(res.flame.firstUse)} с после тыквы (не применил ${f(res.flame.neverUsed)}%), потрачено ${f(res.flame.spentShare)}% добытого (добыто ${f(res.flame.earned)}, потрачено ${f(res.flame.spent)}; P90 первого применения ${f(res.flame.firstUseP90)} с, до 120 с — ${f(res.flame.firstUseBy120)}%)`,
);
const byIdx = [1, 2, 3, 4, 5, 6, 7].map((k) => {
  const xs = S.filter((s) => s.idx === k);
  return `#${k}: ${f(pct(xs.map((s) => s.loss), 0.5) * 100)}% (<50% ${f(share(xs.map((s) => s.minFrac < 0.5)))}%, дверь ${f(avg(xs.map((s) => s.doorLevel)), 1)} / призрак ${f(avg(xs.map((s) => s.ghostLevel)), 1)})`;
});
const ends: Record<string, number> = {};
for (const g of gapEnders) ends[g.what] = (ends[g.what] ?? 0) + 1;
const top = Object.entries(ends).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${f((100 * v) / gapEnders.length)}%`);
const when = [0, 60, 120, 180, 240, 300, 360, 420, 480].map((t0) => `${t0 / 60}м:${gapEnders.filter((g) => g.at >= t0 && g.at < t0 + 60).length}`);
console.log(`  паузы >30 с (${gapEnders.length}) закрывает: ${top.join(', ')} | начинаются на: ${when.join(' ')}`);
console.log(`  по номеру атаки: ${byIdx.join(' · ')}`);
if (o.out) fs.writeFileSync(o.out, JSON.stringify(res, null, 2));
