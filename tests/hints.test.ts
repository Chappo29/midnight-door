import { describe, expect, it } from 'vitest';
import { B, TICK } from '../src/sim/balance';
import { Match } from '../src/sim/match';
import { TutorialDirector } from '../src/tutorial/director';
import { HintDirector } from '../src/tutorial/hints';

/** Матч, где игрок уже в комнате и наступила ночь. */
function nightMatch(): Match {
  const m = new Match({ seed: 7, difficulty: 'easy', flameUnlocked: true });
  m.command(0, { type: 'pickRoom', roomId: 2 });
  while (m.phase !== 'night') m.step();
  return m;
}

function run(m: Match, h: HintDirector, seconds: number): string[] {
  const shown: string[] = [];
  for (let i = 0; i < seconds / TICK; i++) {
    m.step();
    h.onEvents(m.events);
    const hint = h.update(TICK);
    if (hint && shown[shown.length - 1] !== hint.id) shown.push(hint.id);
  }
  return shown;
}

describe('подсказки по ходу игры', () => {
  it('test_hints_weak_door_at_night_shows_repair_once', () => {
    // Arrange
    const m = nightMatch();
    // Подсказки «на будущее» (тыква, новые постройки) уже видели — проверяем только ремонт.
    const seen = new Set<string>(['flame', 'trap', 'workbench', 'fridge']);
    const saved: string[] = [];
    const h = new HintDirector(m, seen, (id) => saved.push(id));
    run(m, h, 6); // первые секунды ночи — тишина
    const d = m.playerRoom!.door;

    // Act
    d.hp = d.maxHp * 0.2;
    const first = run(m, h, 1);
    run(m, h, 7); // подсказка отвисела и исчезла
    d.hp = d.maxHp * 0.2;
    const later = run(m, h, 60);

    // Assert
    expect(first).toEqual(['repair']);
    expect(later).not.toContain('repair');
    expect(saved.filter((id) => id === 'repair')).toHaveLength(1);
  });

  it('test_hints_current_hint_disappears_when_match_ends', () => {
    // Arrange: подсказка про ремонт на экране.
    const m = nightMatch();
    const h = new HintDirector(m, new Set(['flame', 'trap', 'workbench', 'fridge']), () => {});
    run(m, h, 6);
    m.playerRoom!.door.hp = m.playerRoom!.door.maxHp * 0.2;
    expect(run(m, h, 1)).toEqual(['repair']);

    // Act: матч закончился (итоги выходят поверх), подсказке оставалось жить ещё несколько секунд.
    m.phase = 'end';
    const hint = h.update(TICK);

    // Assert: палец кота не остаётся поверх экрана итогов (GAME_AUDIT.md, B10).
    expect(hint).toBeNull();
  });

  it('test_hints_first_seconds_of_night_are_quiet', () => {
    const m = nightMatch();
    const h = new HintDirector(m, new Set(), () => {});
    const d = m.playerRoom!.door;
    d.hp = d.maxHp * 0.2;
    expect(run(m, h, 3)).toEqual([]);
  });

  it('test_hints_already_seen_are_never_repeated', () => {
    const m = nightMatch();
    const h = new HintDirector(m, new Set(['repair']), () => {});
    run(m, h, 6);
    const d = m.playerRoom!.door;
    d.hp = d.maxHp * 0.2;
    expect(run(m, h, 2)).not.toContain('repair');
  });

  it('test_hints_at_most_one_per_gap', () => {
    // Две причины сразу (дверь слабая и нет места) — вторая ждёт паузы между подсказками.
    const m = nightMatch();
    const h = new HintDirector(m, new Set(), () => {});
    run(m, h, 6);
    const d = m.playerRoom!.door;
    d.hp = d.maxHp * 0.2;
    const shown = run(m, h, 10);
    expect(shown.length).toBeLessThanOrEqual(1);
  });
});

describe('обучение: неточный тап', () => {
  it('test_tutorial_tap_next_to_target_snaps_to_target', () => {
    const m = new Match({ seed: 20260924, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    const d = new TutorialDirector(m);
    d.allowTap(0, 0); // вступление
    const v = d.view()!;
    expect(v.step.id).toBe('pick');
    // На шаге выбора комнаты можно тапать куда угодно — проверим шаг с одной клеткой.
    m.command(0, { type: 'pickRoom', roomId: 0 });
    for (let i = 0; i < 20 * 30 && d.view()?.step.id !== 'sofa'; i++) {
      m.step();
      d.onEvents(m.events);
      d.update(TICK);
    }
    const sofa = m.playerRoom!.sofa;
    expect(d.gateTap(sofa.x + 1, sofa.y)).toEqual({ x: sofa.x, y: sofa.y });
    expect(d.gateTap(sofa.x + 3, sofa.y)).toBeNull();
  });
});

describe('подсказки «на будущее»', () => {
  /** Матч в начале подготовки: игрок у себя в комнате, конфет с запасом. */
  function prepMatch(): Match {
    const m = new Match({ seed: 7, difficulty: 'easy', flameUnlocked: true });
    m.command(0, { type: 'pickRoom', roomId: 2 });
    while (m.phase !== 'prep') m.step();
    m.playerRoom!.candy = 9999;
    return m;
  }

  it('test_hints_flame_shows_in_prep_when_pumpkin_affordable', () => {
    const m = prepMatch();
    const h = new HintDirector(m, new Set(), () => {});
    expect(run(m, h, 5)).toContain('flame');
  });

  it('test_hints_trap_shows_only_after_door_unlocks_it', () => {
    const m = prepMatch();
    const h = new HintDirector(m, new Set(['flame']), () => {});
    expect(run(m, h, 5)).not.toContain('trap');
    m.playerRoom!.door.level = B.unlock.trap;
    expect(run(m, h, 25)).toContain('trap');
  });
});
