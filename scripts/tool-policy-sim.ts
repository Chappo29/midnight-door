/// <reference types="node" />
/**
 * Замер влияния инструментов сейфа на победы (чеснок, запасной ключ, супер-конфеты; src/sim/match.ts, toolCommand).
 * ИИ-игрок как в core-loop-sim (умение 0.6, темп 0.35, всё открыто), поверх него политика «внимательного ребёнка»:
 * строит сейф, покупает инструменты впрок и применяет их вовремя — настоящими командами Match.command(…, {type:'tool'}).
 *   npx tsx scripts/tool-policy-sim.ts [сложность=all|easy|hard|nightmare] [матчей=300] [patch JSON] [опции JSON]
 * Руки (один и тот же набор сидов): base — ИИ-игрок как есть; safe — то же + сейф, но без инструментов (чтобы отделить
 * доход сейфа 0,7/с от самих инструментов); tools — сейф + инструменты.
 * patch: {"tools":{"limit":{"garlic":1,"key":2,"charge":2},"scareSecs":15},
 *         "econ":{"hard":{"garlicPrices":[120,180],"toolPriceSecs":8},"easy":{"garlicPrices":[80,120]}}}
 *   tools правит B.tools, items — B.items (например {"safe":0.5}: доход сейфа), econ — DIFF[сложность].econ (по сложностям,
 *   у каждой своя копия). Рука base от патча не зависит, safe зависит только от items (с items её не берём из baseFrom).
 * опции: {"skill":0.6,"pace":0.35,"policy":"kid|eager","arms":["base","safe","tools"],"seed0":0,
 *         "baseFrom":"prev.json" (взять руки base и safe из прошлого out — те же сиды, умение и политика — не считать заново),"out":"file.json"}
 *   seed0 — сдвиг сидов (сид = (seed0 + i) · 7919, i = 1..N): второй прогон на других сидах.
 * Политика (policy=kid): решение раз в 0,6–1,6 с; сейф — при двери ≥ 2 и конфетах ≥ цена + резерв (резерв — самая дешёвая
 * из ближайших покупок ИИ: дверь, диван, пушка, улучшение пушки); инструменты — когда конфет ≥ 1,25 × цена + резерв
 * (порядок: чеснок, ключ, супер-конфеты; супер-конфеты — только при ≥ 2 пушках); ключ — осада идёт и дверь < 45%;
 * чеснок — не меньше 2 ударов и дверь < 60% (или призрак сильный); супер-конфеты — призрак у двери и ≥ 2 пушки.
 * policy=eager — верхняя оценка «умелого» игрока: без резерва, чеснок и ключ раньше и чаще.
 */
import fs from 'fs';
import { B, DIFF } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import type { Difficulty, Room, ToolId } from '../src/sim/types';
import { TOOL_IDS } from '../src/sim/types';

const arg = process.argv[2] ?? 'all';
const N = Number(process.argv[3] ?? 300);
const patch = JSON.parse(process.argv[4] || '{}') as { tools?: Record<string, unknown>; items?: Record<string, unknown>; econ?: Partial<Record<Difficulty, Record<string, unknown>>> };
const o = JSON.parse(process.argv[5] || '{}') as {
  skill?: number;
  pace?: number;
  policy?: string;
  arms?: Arm[];
  seed0?: number;
  baseFrom?: string;
  out?: string;
};
const skill = o.skill ?? 0.6;
const pace = o.pace ?? 0.35;
const seed0 = o.seed0 ?? 0;
const MAX_SEC = 2400;
const DIFFS: Difficulty[] = arg === 'all' ? ['easy', 'hard', 'nightmare'] : [arg as Difficulty];

type Arm = 'base' | 'safe' | 'tools';
const ARMS: Arm[] = o.arms ?? ['base', 'safe', 'tools'];

if (patch.tools) Object.assign(B.tools, patch.tools);
if (patch.items) Object.assign(B.items, patch.items);
for (const d of DIFFS) {
  const e = patch.econ?.[d];
  // У сложной и кошмара одна общая HARD_ECON: правим копию, иначе правка одной сложности утекла бы в другую.
  if (e) DIFF[d].econ = { ...DIFF[d].econ, ...e };
}

interface Policy {
  /** Ребёнок замечает, что пора, раз в react[0]…react[1] секунд. */
  react: [number, number];
  /** Инструмент покупается, когда конфет ≥ slack × цена + резерв (резерв выключает useReserve). */
  slack: number;
  useReserve: boolean;
  /** Сейф: строит при конфетах ≥ цена сейфа + (резерв или 0). */
  safeReserve: boolean;
  keyBelow: number;
  garlicBelow: number;
  garlicHits: number;
  /** «Призрак сильный»: уровень призрака, начиная с которого чеснок годится и при целой двери. */
  strongLevel: number;
  /** Супер-конфеты: сколько пушек нужно, чтобы покупать и применять. */
  chargeCannons: number;
  order: ToolId[];
}
const POLICIES: Record<string, Policy> = {
  kid: { react: [0.6, 1.6], slack: 1.25, useReserve: true, safeReserve: true, keyBelow: 0.45, garlicBelow: 0.6, garlicHits: 2, strongLevel: 5, chargeCannons: 2, order: ['garlic', 'key', 'charge'] },
  eager: { react: [0.4, 0.9], slack: 1, useReserve: false, safeReserve: false, keyBelow: 0.6, garlicBelow: 0.75, garlicHits: 1, strongLevel: 3, chargeCannons: 1, order: ['garlic', 'key', 'charge'] },
};
const P = POLICIES[o.policy ?? 'kid'];
if (!P) throw new Error(`нет политики ${o.policy}`);

/** Свой генератор: политика не должна трогать rng матча (иначе сиды разойдутся сами по себе). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Что ИИ-игрок собирается купить в ближайшее время: самая дешёвая из покупок — её конфеты держим в запасе. */
function reserve(m: Match, r: Room): number {
  const costs: number[] = [];
  const door = m.doorUpgradeCost(r);
  if (door && !r.door.broken) costs.push(door.candy);
  if (!m.sofaBlockedBy(r)) {
    const s = m.sofaUpgradeCost(r);
    if (s) costs.push(s.candy);
  }
  const cannons = r.buildings.filter((b) => b.kind === 'cannon');
  if (cannons.length < 4 && m.hasBuildCell(r, 'cannon')) costs.push(m.buildCost('cannon', r).candy);
  const weakest = [...cannons].sort((a, b) => a.level - b.level)[0];
  const up = weakest ? m.upgradeCost(weakest, r) : null;
  if (up) costs.push(up.candy);
  return costs.length ? Math.min(...costs) : 0;
}

interface Tally {
  buys: Record<ToolId, number>;
  uses: Record<ToolId, number>;
  spent: number;
  safeAt: number | null;
  safeIssued: number;
}
const zero = (): Record<ToolId, number> => ({ garlic: 0, key: 0, charge: 0 });

/** Одно «решение ребёнка»: применить, что пора, потом (если ничего не применил) построить сейф или купить впрок. */
function policyStep(m: Match, t: Tally, buyTools: boolean, prepAt: number): void {
  const r = m.playerRoom;
  const p = m.player;
  if (!r || p.caught || p.spirit || m.result || r.eliminated) return;
  const g = m.ghost;
  const door = r.door;
  const frac = door.hp / door.maxHp;
  const atDoor = g.state === 'attacking' && g.targetRoom === r.id;
  const cannons = r.buildings.filter((b) => b.kind === 'cannon').length;

  if (buyTools && m.phase === 'night' && atDoor) {
    const use = (tool: ToolId): boolean => {
      if (m.toolUseBlock(r, tool) || m.command(m.playerId, { type: 'tool', tool, op: 'use' })) return false;
      t.uses[tool]++;
      return true;
    };
    if (!door.broken && frac < P.keyBelow && use('key')) return;
    const siegeOn = g.siegeRoom === r.id && g.siegeHits >= P.garlicHits;
    if (siegeOn && (frac < P.garlicBelow || g.level >= P.strongLevel) && use('garlic')) return;
    if (cannons >= P.chargeCannons && use('charge')) return;
  }

  const spare = P.useReserve ? reserve(m, r) : 0;
  if (!m.hasSafe(r)) {
    // Сейф покупают, а не находят: идёт к клетке подальше от двери (там пушкам мест хватает), деньги — по приходу.
    if (door.level < B.items.safeDoor || r.candy < B.items.safeCost + (P.safeReserve ? spare : 0)) return;
    if (t.safeIssued >= 0 && m.time - t.safeIssued < 15) return;
    const f = door.front;
    const cells = m.placeableCells(r, 'safe').sort((a, b) => Math.hypot(b.x + 0.5 - f.x, b.y + 0.5 - f.y) - Math.hypot(a.x + 0.5 - f.x, a.y + 0.5 - f.y));
    if (!cells.length) return;
    if (!m.command(m.playerId, { type: 'build', kind: 'safe', ...cells[0] })) t.safeIssued = m.time;
    return;
  }
  if (t.safeAt === null) t.safeAt = m.time - prepAt;
  if (!buyTools) return;
  for (const tool of P.order) {
    if (tool === 'charge' && cannons < P.chargeCannons) continue;
    if (m.toolBuyBlock(r, tool)) continue;
    const price = m.toolCost(r, tool);
    if (r.candy < price * P.slack + spare) continue;
    if (m.command(m.playerId, { type: 'tool', tool, op: 'buy' })) continue;
    t.buys[tool]++;
    t.spent += price;
    return;
  }
}

interface Res {
  win: boolean;
  caught: boolean;
  nightMin: number;
  buys: Record<ToolId, number>;
  uses: Record<ToolId, number>;
  left: Record<ToolId, number>;
  spent: number;
  safeAt: number | null;
}

function play(diff: Difficulty, seed: number, arm: Arm): Res {
  const m = new Match({ seed: seed * 7919, difficulty: diff, flameUnlocked: true, lockedKinds: [], autoPlayer: true, autoPlayerSkill: skill });
  m.player.profile = { ...m.player.profile, pace };
  const rng = mulberry32(seed * 104729 + 17);
  const t: Tally = { buys: zero(), uses: zero(), spent: 0, safeAt: null, safeIssued: -1 };
  let prepAt = -1;
  let next = 0;
  for (let i = 0; i < 20 * MAX_SEC && m.phase !== 'end'; i++) {
    if (arm !== 'base' && m.playerRoom && i >= next) {
      if (prepAt < 0 && m.phase === 'prep') prepAt = m.time;
      policyStep(m, t, arm === 'tools', prepAt);
      next = i + Math.round(20 * (P.react[0] + (P.react[1] - P.react[0]) * rng()));
    }
    m.step();
  }
  const left = zero();
  for (const id of TOOL_IDS) left[id] = m.playerRoom?.tools?.stock[id] ? 1 : 0;
  return { win: m.result === 'win' && !m.player.caught, caught: m.player.caught, nightMin: m.nightTime / 60, buys: t.buys, uses: t.uses, left, spent: t.spent, safeAt: t.safeAt };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const winPct = (rs: Res[]) => (100 * rs.filter((r) => r.win).length) / Math.max(1, rs.length);
const f = (x: number, d = 1) => (Number.isNaN(x) ? '—' : x.toFixed(d));
const sign = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1);
/** Погрешность (1σ, п.) разницы побед на одних и тех же сидах: считаются только матчи, где исход разошёлся (McNemar). */
const se = (a: Res[], b: Res[]) => {
  const n = a.length;
  const up = a.filter((x, i) => !x.win && b[i].win).length;
  const down = a.filter((x, i) => x.win && !b[i].win).length;
  return (100 * Math.sqrt(Math.max(0, up + down - (up - down) ** 2 / n))) / n;
};
const LIMIT: Record<Difficulty, number> = { easy: 4, hard: 5, nightmare: 5 };
const TARGET: Record<Difficulty, number> = { easy: 91, hard: 56, nightmare: 38 };

type Runs = Partial<Record<Arm, Res[]>>;
interface Dump {
  policy: string;
  skill: number;
  pace: number;
  seed0: number;
  runs: Partial<Record<Difficulty, Runs>>;
}
const cache: Dump | null = o.baseFrom ? (JSON.parse(fs.readFileSync(o.baseFrom, 'utf8')) as Dump) : null;
const all: Partial<Record<Difficulty, Runs>> = {};
const summary: Record<string, unknown>[] = [];

for (const d of DIFFS) {
  const runs: Runs = {};
  const t0 = Date.now();
  for (const arm of ARMS) {
    const cached = cache?.runs[d]?.[arm];
    // Руки base и safe от патча не зависят (инструментов в них нет), safe — ещё и от политики: берём из прошлого прогона.
    const same = !!cache && cache.seed0 === seed0 && cache.skill === skill && cache.pace === pace && (arm === 'base' || (cache.policy === (o.policy ?? 'kid') && !patch.items));
    if (cached && same && cached.length === N && (arm === 'base' || arm === 'safe')) {
      runs[arm] = cached;
      continue;
    }
    const rs: Res[] = [];
    for (let i = 1; i <= N; i++) rs.push(play(d, seed0 + i, arm));
    runs[arm] = rs;
  }
  all[d] = runs;
  const base = runs.base;
  const safe = runs.safe;
  const tools = runs.tools;
  const line = (name: string, rs: Res[] | undefined) => (rs ? `${name} ${f(winPct(rs))}%` : '');
  console.log(`\n=== ${d}, ${N} матчей, политика ${o.policy ?? 'kid'}, умение ${skill}, темп ${pace}, сиды ${seed0 + 1}…${seed0 + N} (${((Date.now() - t0) / 1000).toFixed(0)} с) ===`);
  console.log(`  победы: ${[line('база', base), line('сейф без инструментов', safe), line('с инструментами', tools)].filter(Boolean).join(' | ')}  (цель базы ~${TARGET[d]}%)`);
  if (base && tools) {
    const dl = winPct(tools) - winPct(base);
    const flipWin = base.filter((b, i) => !b.win && tools[i].win).length;
    const flipLose = base.filter((b, i) => b.win && !tools[i].win).length;
    console.log(`  сдвиг с инструментами к базе: ${sign(dl)} п. (±${f(se(base, tools))}, 1σ парно по сидам), лимит +${LIMIT[d]}; на одном сиде: проиграл→выиграл ${flipWin}, выиграл→проиграл ${flipLose}`);
    if (safe) console.log(`  из них сейф сам по себе: ${sign(winPct(safe) - winPct(base))} п. (±${f(se(base, safe))}); чисто инструменты поверх сейфа: ${sign(winPct(tools) - winPct(safe))} п. (±${f(se(safe, tools))})`);
  }
  if (tools) {
    const buys = TOOL_IDS.map((id) => `${id} ${f(avg(tools.map((r) => r.buys[id])), 2)}`).join(', ');
    const uses = TOOL_IDS.map((id) => `${id} ${f(avg(tools.map((r) => r.uses[id])), 2)}`).join(', ');
    const left = TOOL_IDS.map((id) => `${id} ${f(100 * avg(tools.map((r) => r.left[id])), 0)}%`).join(', ');
    const safeAt = tools.filter((r) => r.safeAt !== null).map((r) => r.safeAt!);
    console.log(`  покупок за матч: ${buys} | применений: ${uses} | лежит неиспользованным в конце: ${left}`);
    console.log(`  потрачено на инструменты ${f(avg(tools.map((r) => r.spent)), 0)} конфет за матч; сейф стоит к ${f(avg(safeAt), 0)} с (построили в ${f((100 * safeAt.length) / tools.length, 0)}% матчей); ночь ${f(avg(tools.map((r) => r.nightMin)))} мин (база ${f(avg((base ?? []).map((r) => r.nightMin)))})`);
    const byBought = (id: ToolId) => {
      const yes = tools.filter((r) => r.buys[id] > 0);
      return `${id}: купили в ${f((100 * yes.length) / tools.length, 0)}% матчей, побед среди них ${f(winPct(yes))}%`;
    };
    console.log(`  ${TOOL_IDS.map(byBought).join(' | ')}`);
  }
  summary.push({
    difficulty: d,
    n: N,
    base_win: base ? winPct(base) : null,
    safe_win: safe ? winPct(safe) : null,
    tools_win: tools ? winPct(tools) : null,
    avg_garlic: tools ? avg(tools.map((r) => r.buys.garlic)) : null,
    avg_key: tools ? avg(tools.map((r) => r.buys.key)) : null,
    avg_charge: tools ? avg(tools.map((r) => r.buys.charge)) : null,
  });
}
console.log('\nJSON: ' + JSON.stringify(summary));
if (o.out) fs.writeFileSync(o.out, JSON.stringify({ policy: o.policy ?? 'kid', skill, pace, seed0, runs: all } satisfies Dump));
