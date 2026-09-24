/// <reference types="node" />
/**
 * Быстрый подбор баланса: меняет числа B на лету и гоняет короткую серию матчей.
 *   npx tsx scripts/tune.ts '{"ghost":{"hpMul":1.25}}' 40
 * Печатает % побед (убит призрак) и среднее время по сложностям для игрока-ИИ умения 0.5.
 */
import { B, DIFF } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import type { Difficulty } from '../src/sim/types';

const patch = JSON.parse(process.argv[2] ?? '{}') as Record<string, Record<string, number>>;
const N = Number(process.argv[3] ?? 40);
// {"ghost":{...}} правит B, {"DIFF":{"easy":{...}}} — параметры сложности.
for (const [k, v] of Object.entries(patch)) {
  if (k === 'DIFF') for (const [d, p] of Object.entries(v)) Object.assign(DIFF[d as Difficulty], p);
  else Object.assign((B as unknown as Record<string, object>)[k], v);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const mm = (s: number) => (Number.isNaN(s) ? '—' : `${(s / 60).toFixed(1)}м`);
const out: string[] = [];
for (const difficulty of ['easy', 'hard', 'nightmare'] as Difficulty[]) {
  let wins = 0;
  const win: number[] = [];
  const lose: number[] = [];
  for (let seed = 1; seed <= N; seed++) {
    const m = new Match({ seed: seed * 7919, difficulty, flameUnlocked: true, autoPlayer: true, autoPlayerSkill: 0.5 });
    for (let i = 0; i < 20 * 2400 && m.phase !== 'end'; i++) m.step();
    if (m.result === 'win') {
      wins++;
      win.push(m.nightTime);
    } else lose.push(m.nightTime);
  }
  out.push(`${difficulty}: ${Math.round((wins / N) * 100)}% (убил ${mm(avg(win))}, проиграл ${mm(avg(lose))})`);
}
console.log(process.argv[2] ?? '{}', '→', out.join(' | '));
