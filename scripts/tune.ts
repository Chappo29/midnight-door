/// <reference types="node" />
/**
 * Быстрый подбор баланса: меняет числа B на лету и гоняет короткую серию матчей.
 *   npx tsx scripts/tune.ts '{"ghost":{"hpMul":1.25}}' 40
 *   npx tsx scripts/tune.ts '{}' 40 revive   — ещё строка «всегда воскрешается» (ИИ-игрок сразу возвращается в комнату)
 *   npx tsx scripts/tune.ts '{"skill":0.2}' 40 — умение ИИ-игрока (по умолчанию 0.5)
 * Печатает % побед (убит призрак; из них командных — игрок был духом) и среднее время по сложностям
 * для игрока-ИИ умения 0.5 (или "skill" из JSON). Пойманный ИИ-игрок играет духом (npc.ts › spiritThink).
 */
import { B, DIFF } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import type { Difficulty } from '../src/sim/types';

const { skill = 0.5, ...patch } = JSON.parse(process.argv[2] ?? '{}') as { skill?: number } & Record<string, Record<string, number>>;
const N = Number(process.argv[3] ?? 40);
const withRevive = process.argv[4] === 'revive';
/** Матч, не закончившийся за столько секунд, — «завис» (цель — 0). */
const MAX_SEC = 2400;
// {"ghost":{...}} правит B, {"DIFF":{"easy":{...}}} — параметры сложности.
for (const [k, v] of Object.entries(patch)) {
  if (k === 'DIFF') for (const [d, p] of Object.entries(v)) Object.assign(DIFF[d as Difficulty], p);
  else Object.assign((B as unknown as Record<string, object>)[k], v);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const mm = (s: number) => (Number.isNaN(s) ? '—' : `${(s / 60).toFixed(1)}м`);
function row(difficulty: Difficulty, revive: boolean): string {
  let wins = 0;
  let team = 0;
  let stuck = 0;
  const win: number[] = [];
  const lose: number[] = [];
  // Замер (см. docs/plans/2026-09-24-buildings-gate-ghost-spirit.md, «Статус»): темп ударов по дверям и средний уровень призрака —
  // уровень растёт от ударов, по ним подбирается DIFF[*].hitsPerLevel.
  let hits = 0;
  let nightSec = 0;
  const levels: number[] = [];
  for (let seed = 1; seed <= N; seed++) {
    const m = new Match({ seed: seed * 7919, difficulty, flameUnlocked: true, autoPlayer: true, autoPlayerSkill: skill });
    for (let i = 0; i < 20 * MAX_SEC && m.phase !== 'end'; i++) {
      m.step();
      hits += m.events.filter((e) => e.type === 'doorHit' && e.dmg > 0).length;
      // «Всегда воскрешается»: как будто игрок каждый раз смотрит ролик (раз за матч).
      if (revive && m.canRevive() === null) m.revive();
    }
    nightSec += m.nightTime;
    levels.push(m.ghost.level);
    if (m.phase !== 'end') stuck++;
    if (m.result === 'win') {
      wins++;
      if (m.teamWin) team++;
      win.push(m.nightTime);
    } else lose.push(m.nightTime);
  }
  const hbar = nightSec > 0 ? hits / nightSec : 0;
  const pct = (n: number) => `${Math.round((n / N) * 100)}%`;
  const tag = (revive ? ' [всегда воскрешается]' : '') + (skill !== 0.5 ? ` [умение ${skill}]` : '');
  return `${difficulty}${tag}: ${pct(wins)} (соло ${pct(wins - team)}, командных ${pct(team)}; убил ${mm(avg(win))}, проиграл ${mm(avg(lose))}, зависло ${stuck}) h̄=${hbar.toFixed(2)}/с ур.=${avg(levels).toFixed(1)} (hitsPerLevel=${DIFF[difficulty].hitsPerLevel}, страховка ${DIFF[difficulty].levelFallback}с)`;
}

const out: string[] = [];
for (const difficulty of ['easy', 'hard', 'nightmare'] as Difficulty[]) {
  out.push(row(difficulty, false));
  if (withRevive) out.push(row(difficulty, true));
}
console.log(process.argv[2] ?? '{}', '→', out.join(' | '));
