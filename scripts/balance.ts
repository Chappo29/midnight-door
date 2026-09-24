/// <reference types="node" />
/**
 * Прогон баланса: игроком управляет ИИ заданного умения, считаем исходы.
 *   npm run balance            — 200 матчей на каждую сложность
 *   npm run balance -- 500     — другое число матчей
 */
import { Match } from '../src/sim/match';
import type { Difficulty } from '../src/sim/types';

const N = Number(process.argv[2] ?? 200);
const skills = [0.2, 0.5, 0.8];
const diffs: Difficulty[] = ['easy', 'hard', 'nightmare'];

const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`.padStart(4);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

const mmss = (sec: number) => (Number.isNaN(sec) ? '  —  ' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`.padStart(5));

// Рассвета нет: победа — убить призрака. Матч длиннее 40 минут считаем зависшим.
for (const flameUnlocked of [false, true]) {
  console.log(`
=== пламя ${flameUnlocked ? 'открыто' : 'закрыто (первый матч)'} ===`);
  console.log('сложность  умение  победа  убил за  проиграл на  ур.призрака  выжило соседей  зависло');
  for (const difficulty of diffs) {
    for (const skill of skills) {
      let wins = 0;
      let stuck = 0;
      const killAt: number[] = [];
      const loseAt: number[] = [];
      const levels: number[] = [];
      const survivors: number[] = [];
      for (let seed = 1; seed <= N; seed++) {
        const m = new Match({ seed: seed * 7919, difficulty, flameUnlocked, autoPlayer: true, autoPlayerSkill: skill });
        for (let i = 0; i < 20 * 2400 && m.phase !== 'end'; i++) m.step();
        if (m.phase !== 'end') stuck++;
        if (m.result === 'win') {
          wins++;
          killAt.push(m.nightTime);
        } else if (m.result === 'lose') loseAt.push(m.nightTime);
        levels.push(m.ghost.level);
        survivors.push(m.survivors - (m.player.caught ? 0 : 1));
      }
      console.log(
        `${difficulty.padEnd(10)} ${skill.toFixed(1).padStart(6)}  ${pct(wins, N)}    ${mmss(avg(killAt))}      ${mmss(avg(loseAt))}` +
          `        ${avg(levels).toFixed(1).padStart(5)}        ${avg(survivors).toFixed(1).padStart(4)} из 5     ${stuck}`,
      );
    }
  }
}
