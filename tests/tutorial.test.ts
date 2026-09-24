import { describe, expect, it } from 'vitest';
import { TICK } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import { TutorialDirector } from '../src/tutorial/director';

const SEED = 20260924;

/** Один тик: симуляция, события — режиссёру. */
function tick(m: Match, d: TutorialDirector): void {
  m.step();
  d.onEvents(m.events);
  d.update(TICK);
}

describe('обучение («Ночь 0»)', () => {
  it('ребёнок, делающий то, что показывают, проходит все шаги и побеждает призрака', () => {
    const m = new Match({ seed: SEED, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const steps: string[] = [];
    const d = new TutorialDirector(m, (name, data) => name === 'tut_step' && steps.push(String(data.step)));
    let retry = 0;
    for (let i = 0; i < 20 * 600 && m.phase !== 'end'; i++) {
      tick(m, d);
      if (d.done || --retry > 0 || m.player.task) continue;
      retry = 20; // «ребёнок» нажимает раз в секунду
      const v = d.view()!;
      const room = m.playerRoom;
      switch (v.step.id) {
        case 'intro':
          d.allowTap(0, 0);
          break;
        case 'pick':
          if (v.target.kind === 'cell') {
            const at = v.target.at;
            const r = m.rooms.find((q) => q.ownerId === null && q.x0 <= at.x && at.x < q.x0 + q.w && q.y0 <= at.y && at.y < q.y0 + q.h);
            m.command(0, { type: 'pickRoom', roomId: (r ?? m.rooms.find((q) => q.ownerId === null)!).id });
          }
          break;
        case 'sofa':
          m.command(0, { type: 'upgradeSofa' });
          break;
        case 'cannon':
          if (v.target.kind === 'cell') {
            expect(d.allowTap(v.target.at.x, v.target.at.y)).toBe(true);
            m.command(0, { type: 'build', kind: 'cannon', x: v.target.at.x, y: v.target.at.y });
          }
          break;
        case 'door':
          m.command(0, { type: 'upgradeDoor' });
          break;
        case 'repair':
          m.command(0, { type: 'repair' });
          break;
        case 'upcannon': {
          const b = room!.buildings.find((q) => q.kind === 'cannon')!;
          m.command(0, { type: 'upgrade', x: b.x, y: b.y });
          break;
        }
      }
    }
    expect(steps).toEqual(['intro', 'pick', 'walk', 'sofa', 'candy', 'cannon', 'door', 'midnight', 'repair', 'upcannon', 'finale']);
    expect(d.done).toBe(true);
    expect(m.result).toBe('win');
    expect(m.player.caught).toBe(false);
  });

  it('проиграть нельзя: 10 минут ничего не делать после выбора комнаты', () => {
    const m = new Match({ seed: SEED, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const d = new TutorialDirector(m);
    d.allowTap(0, 0);
    m.command(0, { type: 'pickRoom', roomId: 0 });
    // Режиссёр сам не доводит до полуночи — ребёнок стоит. Запустим ночь принудительно.
    for (let i = 0; i < 20 * 20; i++) tick(m, d);
    m.script!.holdPhase = false;
    m.script!.ghostTarget = m.player.roomId;
    for (let i = 0; i < 20 * 600 && m.phase !== 'end'; i++) tick(m, d);
    expect(m.player.caught).toBe(false);
    const door = m.playerRoom!.door;
    expect(door.broken).toBe(false);
    expect(door.hp).toBeGreaterThanOrEqual(door.maxHp * 0.3 - 1e-6);
  });

  it('test_tutorial_pick_only_suggested_room', () => {
    const m = new Match({ seed: SEED, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const d = new TutorialDirector(m);
    d.allowTap(0, 0); // вступление
    const v = d.view()!;
    expect(v.step.id).toBe('pick');
    if (v.target.kind !== 'cell') throw new Error('палец должен показывать на клетку');
    const at = v.target.at;
    const suggested = m.rooms.find((r) => r.x0 <= at.x && at.x < r.x0 + r.w && r.y0 <= at.y && at.y < r.y0 + r.h)!;
    const other = m.rooms.find((r) => r !== suggested)!;
    expect(d.allowTap(other.door.inside.x, other.door.inside.y)).toBe(false);
    expect(d.allowTap(suggested.door.inside.x, suggested.door.inside.y)).toBe(true);
  });

  it('обычный матч без обучения не трогает сценарий', () => {
    const m = new Match({ seed: SEED, difficulty: 'easy', flameUnlocked: false });
    expect(m.script).toBeNull();
  });
});
