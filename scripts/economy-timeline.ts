/// <reference types="node" />
/**
 * Таймлайн экономики игрока-ИИ по минутам ночи: npx tsx scripts/economy-timeline.ts [сложность=all] [матчей=100]
 * По каждой отметке времени: уровень дивана и двери, доход конфет/с, конфеты на руках, сумма уровней пушек, число построек,
 * сколько конфет ушло в покупки за последние 60 с и доля матчей, где призрак уже убит. Показывает, когда «всё куплено» и конфеты копятся впустую.
 */
import { Match } from '../src/sim/match';
import type { Difficulty } from '../src/sim/types';

const arg = process.argv[2] ?? 'all';
const N = Number(process.argv[3] ?? 100);
const diffs: Difficulty[] = arg === 'all' ? ['easy', 'hard', 'nightmare'] : [arg as Difficulty];
const marks = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600];
for (const d of diffs) {
  const rows = marks.map(() => ({ n: 0, sofa: 0, door: 0, inc: 0, candy: 0, cannonLv: 0, builds: 0, doorHpFrac: 0 }));
  let wins = 0;
  for (let seed = 1; seed <= N; seed++) {
    const m = new Match({ seed: seed * 7919, difficulty: d, flameUnlocked: true, autoPlayer: true, autoPlayerSkill: 0.6 });
    let mi = 0;
    for (let i = 0; i < 20 * 2400 && m.phase !== 'end'; i++) {
      m.step();
      if (m.phase === 'night' && mi < marks.length && m.nightTime >= marks[mi]) {
        const r = m.playerRoom!;
        const row = rows[mi++];
        row.n++;
        row.sofa += r.sofa.level;
        row.door += r.door.level;
        row.inc += m.incomeOf(r);
        row.candy += r.candy;
        row.cannonLv += r.buildings.filter((b) => b.kind === 'cannon').reduce((s, b) => s + b.level, 0);
        row.builds += r.buildings.length;
        row.doorHpFrac += r.door.hp / r.door.maxHp;
      }
    }
    if (m.result === 'win') wins++;
  }
  console.log(`\n== ${d}: побед ${((100 * wins) / N).toFixed(0)}% (N=${N}) — среднее по матчам, дожившим до отметки`);
  console.log('ночь,с  доживших  диван  дверь  доход/с  конфет на руках  сумма ур. пушек  построек');
  marks.forEach((t, i) => {
    const r = rows[i];
    if (!r.n) return;
    const f = (x: number, k = 1) => (x / r.n).toFixed(k);
    console.log(`${String(t).padStart(5)}  ${String(r.n).padStart(8)}  ${f(r.sofa).padStart(5)}  ${f(r.door).padStart(5)}  ${f(r.inc, 0).padStart(7)}  ${f(r.candy, 0).padStart(14)}  ${f(r.cannonLv, 0).padStart(14)}  ${f(r.builds).padStart(8)}`);
  });
}
