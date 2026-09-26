import { describe, expect, it } from 'vitest';
import { ATTACK_DIRECTOR, B } from '../src/sim/balance';
import { directorPick, roomWeight, spawnGhost } from '../src/sim/ghost';
import { Match } from '../src/sim/match';
import type { Room } from '../src/sim/types';
import { inRoomMatch, nightNow, stepSec } from './helpers';

const D = ATTACK_DIRECTOR.easy;

/** Ночь идёт, игрок в комнате; вернёт матч, комнату игрока и живые комнаты. */
function night(): { m: Match; me: Room; alive: Room[] } {
  const m = inRoomMatch();
  nightNow(m);
  const me = m.playerRoom!;
  return { m, me, alive: m.rooms.filter((r) => r.ownerId !== null && !r.eliminated) };
}

/** Игрока только что по-настоящему атаковали (since секунд назад). */
function attackedAgo(m: Match, r: Room, since: number): void {
  m.ghost.attacked[r.id] = true;
  m.ghost.calmSince[r.id] = m.nightTime - since;
}

describe('режиссёр атак: выбор цели', () => {
  it('test_director_is_enabled_in_normal_matches', () => {
    expect(ATTACK_DIRECTOR.easy.enabled && ATTACK_DIRECTOR.hard.enabled && ATTACK_DIRECTOR.nightmare.enabled).toBe(true);
  });

  it('test_director_respite_player_not_picked_right_after_attack', () => {
    // Arrange: атака на игрока только что кончилась, другие комнаты живы.
    const { m, me, alive } = night();
    m.nightTime = 200;
    attackedAgo(m, me, 1);
    // Act: много выборов подряд.
    const picks = Array.from({ length: 300 }, () => directorPick(m, alive).id);
    // Assert: во время передышки игрока не выбирают ни разу.
    expect(picks).not.toContain(me.id);
  });

  it('test_director_weight_grows_with_calm_time', () => {
    const { m, me } = night();
    m.nightTime = 900;
    const w = (since: number) => {
      attackedAgo(m, me, since);
      return roomWeight(m, me);
    };
    // Передышка — 0; потом чем дольше спокойно — тем больше вес игрока, но не выше maxWeight × playerMul.
    expect(w(0)).toBe(0);
    expect(w(D.respite + 1)).toBeGreaterThan(0);
    expect(w(D.respite + 30)).toBeGreaterThan(w(D.respite + 1));
    expect(w(800)).toBeCloseTo(D.maxWeight * D.playerMul);
  });

  it('test_director_neighbors_keep_old_uniform_choice', () => {
    // Игра соседей не меняется: между собой они равновероятны, как в старом выборе, сколько бы ни прошло времени.
    const { m, alive } = night();
    const [a, b] = alive.filter((r) => r.ownerId !== m.playerId);
    m.nightTime = 300;
    attackedAgo(m, a, 1);
    attackedAgo(m, b, 250);
    expect(roomWeight(m, a)).toBe(roomWeight(m, b));
  });

  it('test_director_max_drought_player_gets_priority', () => {
    // Arrange: игрока не атаковали дольше forceAfter.
    const { m, me, alive } = night();
    m.nightTime = 400;
    attackedAgo(m, me, D.forceAfter + 1);
    // Act + Assert: ближайший выбор цели — игрок, всегда.
    for (let i = 0; i < 50; i++) expect(directorPick(m, alive)).toBe(me);
  });

  it('test_director_first_attack_forced_after_first_by', () => {
    const { m, me, alive } = night();
    m.nightTime = D.firstBy - 1;
    // До срока — обычный случайный выбор (не всегда игрок) …
    expect(new Set(Array.from({ length: 200 }, () => directorPick(m, alive).id)).size).toBeGreaterThan(1);
    // … после — игрок, пока его ещё не атаковали.
    m.nightTime = D.firstBy + 1;
    expect(directorPick(m, alive)).toBe(me);
  });

  it('test_director_first_real_attack_on_player_comes_early_in_real_matches', () => {
    // Интеграция: в настоящих матчах первая настоящая атака на игрока — в первую минуту ночи.
    for (let seed = 1; seed <= 12; seed++) {
      const m = new Match({ seed: seed * 7919, difficulty: 'easy', flameUnlocked: true, autoPlayer: true });
      let first = -1;
      for (let i = 0; i < 20 * 400 && first < 0 && m.phase !== 'end'; i++) {
        m.step();
        const me = m.playerRoom;
        for (const e of m.events) if (e.type === 'siegeEnd' && me && e.roomId === me.id && e.meaningful) first = e.start;
      }
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(75);
    }
  });

  it('test_director_only_player_alive_respite_does_not_idle_ghost', () => {
    // Живым остался только игрок, и у него передышка: призрак всё равно идёт к нему, а не стоит без цели.
    const { m, me } = night();
    m.nightTime = 200;
    attackedAgo(m, me, 1);
    expect(directorPick(m, [me])).toBe(me);
  });

  it('test_director_caught_player_excluded', () => {
    // Пойманного игрока режиссёр больше не «навещает»: его комнаты нет среди целей, хоть затишье и огромное.
    const { m, me } = night();
    m.nightTime = 900;
    attackedAgo(m, me, 800);
    me.eliminated = true;
    for (let i = 0; i < 30; i++) {
      spawnGhost(m);
      expect(m.ghost.targetRoom).not.toBe(me.id);
    }
  });
});

describe('режиссёр атак: не ломает остальное', () => {
  it('test_director_does_not_interrupt_retreat_and_healing', () => {
    // Arrange: призрак убегает лечиться, а у игрока «горит» затишье.
    const { m, me } = night();
    const g = m.ghost;
    // Призрак далеко от гнезда — у двери игрока, чтобы бегство было настоящим.
    g.x = g.prevX = me.door.front.x;
    g.y = g.prevY = me.door.front.y;
    g.hp = g.maxHp * B.ghost.retreatAt * 0.5;
    stepSec(m, 0.1);
    expect(g.state).toBe('retreating');
    attackedAgo(m, me, 999);
    // Act: пока бежит и лечится — цель не меняется.
    const states: string[] = [];
    let target = -2;
    for (let i = 0; i < 20 * 40 && target === -2; i++) {
      m.step();
      states.push(g.state);
      for (const e of m.events) if (e.type === 'ghostTarget') target = e.roomId;
    }
    // Assert: дошёл до гнезда, отлечился и только потом выбрал цель — игрока (затишье учтено при следующем выборе).
    expect(states).toContain('healing');
    expect(target).toBe(me.id);
  });

  it('test_director_off_in_tutorial', () => {
    // Обучение: цель задаёт сценарий, режиссёр не вмешивается, даже когда игрок «должен» быть атакован.
    const m = new Match({ seed: 20260924, difficulty: 'easy', flameUnlocked: false, tutorial: true });
    m.command(0, { type: 'pickRoom', roomId: 2 });
    for (let i = 0; i < 40 && m.player.roomId === null; i++) m.step();
    const other = m.rooms.find((r) => r.id !== 2)!;
    other.ownerId = 3;
    m.nightTime = 999;
    m.script!.ghostTarget = other.id;
    spawnGhost(m);
    expect(m.ghost.targetRoom).toBe(other.id);
    // Без указания сценария — прежний равновероятный выбор, а не «всегда игрок».
    m.script!.ghostTarget = null;
    const picks = new Set<number>();
    for (let i = 0; i < 40; i++) {
      spawnGhost(m);
      picks.add(m.ghost.targetRoom);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('test_director_same_seed_same_match', () => {
    // Детерминизм: тот же сид — та же последовательность целей и исход.
    const run = () => {
      const m = new Match({ seed: 4242, difficulty: 'hard', flameUnlocked: true, autoPlayer: true });
      const targets: number[] = [];
      for (let i = 0; i < 20 * 1200 && m.phase !== 'end'; i++) {
        m.step();
        for (const e of m.events) if (e.type === 'ghostTarget') targets.push(e.roomId);
      }
      return { targets, result: m.result, night: m.nightTime };
    };
    expect(run()).toEqual(run());
  });
});
