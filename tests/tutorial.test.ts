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
    expect(steps).toEqual(['intro', 'pick', 'walk', 'sofa', 'candy', 'cannon', 'door', 'midnight', 'knock', 'repair', 'upcannon', 'finale']);
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

  it('test_tutorial_repeated_taps_on_finger_do_not_cancel_cannon_build', () => {
    // Arrange: довести до шага «Поставь пушку тут».
    const m = new Match({ seed: SEED, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const d = new TutorialDirector(m);
    d.allowTap(0, 0);
    for (let i = 0; i < 20 * 120 && d.view()?.step.id !== 'cannon'; i++) {
      tick(m, d);
      if (m.player.task) continue;
      const id = d.view()?.step.id;
      if (id === 'pick') m.command(0, { type: 'pickRoom', roomId: m.rooms.indexOf(m.rooms.find((r) => d.allowTap(r.door.x, r.door.y))!) });
      if (id === 'sofa') m.command(0, { type: 'upgradeSofa' });
    }
    expect(d.view()?.step.id).toBe('cannon');

    // Act: «ребёнок» жмёт на палец раз в 0,7 с, как это делает сцена: тап по пустой клетке — «иди сюда»,
    // затем пункт меню «Пушка». Так бот в аудите крутился на шаге ~200 с (GAME_AUDIT.md, B6).
    let sec = 0;
    for (let i = 0; i < 20 * 60 && d.view()?.step.id === 'cannon'; i++) {
      tick(m, d);
      if (i % 14) continue;
      const v = d.view()!;
      if (v.target.kind !== 'cell') continue;
      const at = d.gateTap(v.target.at.x, v.target.at.y);
      if (!at) continue;
      m.command(0, { type: 'move', x: at.x, y: at.y });
      m.command(0, { type: 'build', kind: 'cannon', x: at.x, y: at.y });
      sec = i * TICK;
    }

    // Assert: шаг пройден, пока строили — пальца нет и тапы не проходят.
    expect(d.view()?.step.id).toBe('door');
    expect(sec).toBeLessThan(5);
  });

  it('test_tutorial_repair_step_survives_child_waiting_long', () => {
    // Arrange: послушный ребёнок доходит до «Чини дверь!».
    const m = new Match({ seed: SEED, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const d = new TutorialDirector(m);
    d.allowTap(0, 0);
    for (let i = 0; i < 20 * 300 && d.view()?.step.id !== 'repair'; i++) {
      tick(m, d);
      if (m.player.task || i % 20) continue;
      const v = d.view()!;
      const at = v.target.kind === 'cell' ? v.target.at : null;
      if (v.step.id === 'pick') m.command(0, { type: 'pickRoom', roomId: m.rooms.indexOf(m.rooms.find((r) => d.allowTap(r.door.x, r.door.y))!) });
      if (v.step.id === 'sofa') m.command(0, { type: 'upgradeSofa' });
      if (v.step.id === 'cannon' && at) m.command(0, { type: 'build', kind: 'cannon', x: at.x, y: at.y });
      if (v.step.id === 'door') m.command(0, { type: 'upgradeDoor' });
    }
    expect(d.view()?.step.id).toBe('repair');

    // Act: полторы минуты ребёнок не жмёт ключ (ящик с инструментами в комнате сам лечит дверь),
    // потом жмёт. Раньше дверь успевала стать целой, ключ отвечал «Дверь целая» — шаг навсегда.
    for (let i = 0; i < 20 * 90; i++) tick(m, d);
    const door = m.playerRoom!.door;
    const err = m.command(0, { type: 'repair' });
    for (let i = 0; i < 20 * 10 && d.view()?.step.id === 'repair'; i++) tick(m, d);

    // Assert
    expect(door.hp).toBeLessThan(door.maxHp);
    expect(err).toBeNull();
    expect(d.view()?.step.id).toBe('upcannon');
  });

  it('test_tutorial_repair_step_starts_with_damaged_door', () => {
    // Шаг «Чини дверь!» не должен начинаться с целой двери: правильное нажатие отвечало «Дверь целая».
    const m = new Match({ seed: SEED, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const d = new TutorialDirector(m);
    d.allowTap(0, 0);
    let hpAtRepairStart = -1;
    for (let i = 0; i < 20 * 300 && hpAtRepairStart < 0; i++) {
      tick(m, d);
      if (d.view()?.step.id === 'repair') hpAtRepairStart = m.playerRoom!.door.hp / m.playerRoom!.door.maxHp;
      if (m.player.task || i % 20) continue;
      const v = d.view()!;
      const at = v.target.kind === 'cell' ? v.target.at : null;
      if (v.step.id === 'pick') m.command(0, { type: 'pickRoom', roomId: m.rooms.indexOf(m.rooms.find((r) => d.allowTap(r.door.x, r.door.y))!) });
      if (v.step.id === 'sofa') m.command(0, { type: 'upgradeSofa' });
      if (v.step.id === 'cannon' && at) m.command(0, { type: 'build', kind: 'cannon', x: at.x, y: at.y });
      if (v.step.id === 'door') m.command(0, { type: 'upgradeDoor' });
    }
    expect(hpAtRepairStart).toBeGreaterThan(0);
    expect(hpAtRepairStart).toBeLessThan(0.6 + 1e-6);
    expect(m.command(0, { type: 'repair' })).toBeNull();
  });

  it('test_tutorial_hides_finger_while_player_builds', () => {
    const m = new Match({ seed: SEED, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const d = new TutorialDirector(m);
    d.allowTap(0, 0);
    for (let i = 0; i < 20 * 120 && d.view()?.step.id !== 'cannon'; i++) {
      tick(m, d);
      if (m.player.task) continue;
      const id = d.view()?.step.id;
      if (id === 'pick') m.command(0, { type: 'pickRoom', roomId: m.rooms.indexOf(m.rooms.find((r) => d.allowTap(r.door.x, r.door.y))!) });
      if (id === 'sofa') m.command(0, { type: 'upgradeSofa' });
    }
    const v = d.view()!;
    if (v.target.kind !== 'cell') throw new Error('палец должен показывать на клетку');
    const at = v.target.at;
    expect(m.command(0, { type: 'build', kind: 'cannon', x: at.x, y: at.y })).toBeNull();
    expect(d.view()!.target.kind).toBe('none');
    expect(d.allowTap(at.x, at.y)).toBe(false);
  });

  it('обычный матч без обучения не трогает сценарий', () => {
    const m = new Match({ seed: SEED, difficulty: 'easy', flameUnlocked: false });
    expect(m.script).toBeNull();
  });
});
