/// <reference types="node" />
/**
 * Сколько призрак стоит у одной двери: от начала осады до ухода/пролома.
 *   npx tsx scripts/siege-stats.ts [матчей=20]
 */
import { Match } from '../src/sim/match';
import type { Difficulty } from '../src/sim/types';

const N = Number(process.argv[2] ?? 20);
for (const difficulty of ['easy', 'hard', 'nightmare'] as Difficulty[]) {
  const len: number[] = [];
  const why: Record<string, number> = { ушёл: 0, сломал: 0, другое: 0 };
  for (let seed = 1; seed <= N; seed++) {
    const m = new Match({ seed: seed * 7919, difficulty, flameUnlocked: true, autoPlayer: true, autoPlayerSkill: 0.5 });
    let start = -1;
    for (let i = 0; i < 20 * 2400 && m.phase !== 'end'; i++) {
      m.step();
      const t = i / 20;
      const g = m.ghost;
      if (g.state === 'attacking' && start < 0) start = t;
      if (start >= 0 && g.state !== 'attacking') {
        len.push(t - start);
        const left = m.events.some((e) => e.type === 'ghostLeft');
        why[left ? 'ушёл' : g.state === 'entering' ? 'сломал' : 'другое']++;
        start = -1;
      }
    }
  }
  len.sort((a, b) => a - b);
  const q = (p: number) => len[Math.floor(p * (len.length - 1))].toFixed(1);
  console.log(`${difficulty}: осад ${len.length}, мин ${q(0)} / 25% ${q(0.25)} / медиана ${q(0.5)} / 75% ${q(0.75)} / макс ${q(1)} с`, JSON.stringify(why));
}
