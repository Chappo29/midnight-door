import { describe, expect, it } from 'vitest';
import { Match } from '../src/sim/match';
import type { Difficulty } from '../src/sim/types';
import { inRoomMatch, nightNow, pinGhostAtDoor, quietFloor, runUntil } from './helpers';

/**
 * Регрессия FINAL_QA_REPORT.md QA-05: призрак, уже входящий в комнату (дверь сломана), убегал лечиться —
 * комната оставалась жить со сломанной дверью, которую нельзя ни чинить, ни улучшать.
 */
describe('сломанная дверь не остаётся у живой комнаты (QA-05)', () => {
  it('test_ghost_low_hp_while_entering_does_not_flee', () => {
    const m = inRoomMatch({ difficulty: 'easy' });
    nightNow(m);
    quietFloor(m);
    const room = m.playerRoom!;
    room.door.hp = 1;
    pinGhostAtDoor(m, room);
    runUntil(m, (mm) => mm.ghost.state === 'entering', 5);
    expect(m.ghost.state).toBe('entering');
    m.ghost.hp = m.ghost.maxHp * 0.2; // ниже порога бегства, пока входит
    m.step();
    expect(m.ghost.state).toBe('entering');
    expect(m.events.some((e) => e.type === 'ghostRetreat')).toBe(false);
    runUntil(m, (mm) => mm.player.caught || mm.ghost.state === 'dead', 20);
    // Вошёл и поймал (или пушки добили) — «подвешенной» комнаты нет.
    expect(m.player.caught || m.ghost.state === 'dead').toBe(true);
  });

  it('test_ghost_low_hp_while_attacking_still_flees', () => {
    // Бегство с осады не тронуто: дверь цела, призрак уходит лечиться как раньше.
    const m = inRoomMatch({ difficulty: 'easy' });
    nightNow(m);
    quietFloor(m);
    pinGhostAtDoor(m, m.playerRoom!);
    m.ghost.hp = m.ghost.maxHp * 0.2;
    m.step();
    expect(m.ghost.state).toBe('retreating');
    expect(m.playerRoom!.door.broken).toBe(false);
  });

  it('test_no_live_room_keeps_broken_door_in_natural_matches', () => {
    // Естественные сиды, где раньше призрак сбегал, уже войдя (hard 162, 1061, 1278), и ещё немного соседних.
    const seeds = [162, 1061, 1278, ...Array.from({ length: 12 }, (_, s) => s * 31 + 7)];
    const diffs: Difficulty[] = ['hard', 'nightmare'];
    for (const difficulty of diffs) {
      for (const seed of seeds) {
        const m = new Match({ seed, difficulty, flameUnlocked: true, autoPlayer: true, autoPlayerSkill: 0.5 });
        for (let t = 0; m.phase !== 'end' && t < 20 * 60 * 40; t++) {
          m.step();
          const g = m.ghost;
          for (const r of m.rooms) {
            if (r.ownerId === null || r.eliminated || !r.door.broken || m.result) continue;
            // Сломанная дверь у живой комнаты допустима, только пока призрак в неё входит.
            expect(g.state === 'entering' && g.targetRoom === r.id, `${difficulty} seed ${seed} t=${m.time.toFixed(1)} room ${r.id} ghost ${g.state}`).toBe(true);
          }
        }
      }
    }
  }, 120_000);
});
