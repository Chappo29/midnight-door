/**
 * Финал победы (CORE_LOOP_UX_PASS.md, п. 1; AGE_UX_PLAYTEST.md, №4): смерть призрака видна до итогов.
 * Настоящий GameScene без браузера: Phaser заглушен, как в scene_input_regress.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Scene {
    constructor(public key?: string) {}
  }
  return {
    default: {
      Scene,
      Math: {
        Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
        Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
      },
      Scenes: { Events: { SHUTDOWN: 'shutdown' } },
    },
  };
});

(globalThis as unknown as { document: unknown }).document ??= { hidden: false, querySelector: () => null };
(globalThis as unknown as { window: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as unknown as { DOMRect: unknown }).DOMRect ??= class {
  constructor(
    public x: number,
    public y: number,
    public width: number,
    public height: number,
  ) {}
};

const { GameScene, FINALE } = await import('../src/view/GameScene');
const { inRoomMatch, nightNow } = await import('./helpers');

type AnyScene = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Телефон 844×390, камера смотрит на левый верхний угол карты; призрак — в точке ghostAt (мир, px). */
function scene(ghostAt: { x: number; y: number }) {
  const s = new GameScene() as unknown as AnyScene;
  const m = inRoomMatch();
  nightNow(m);
  const hud = {
    hideMenu: vi.fn(),
    isEchoOfPress: vi.fn(() => false),
    inputReadyAt: 0,
    menuOpen: false,
    banner: vi.fn(),
    setGhostArrow: vi.fn(),
    update: vi.fn(),
    toast: vi.fn(),
    toastInfo: vi.fn(),
  };
  const onEnd = vi.fn();
  const sfx = { play: vi.fn(), heartbeat: vi.fn() };
  s.init({ match: m, hud, sfx, onEnd, onMenu: vi.fn() });
  const handlers: Record<string, (p: unknown) => void> = {};
  const cam = {
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
    width: 844,
    height: 390,
    worldView: { x: 0, y: 0 },
    setZoom: vi.fn(),
    pan: vi.fn(),
    centerOn: vi.fn(),
    getWorldPoint: (x: number, y: number) => ({ x, y }),
  };
  s.game = { canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } };
  s.cameras = { main: cam };
  s.scale = { width: 844, height: 390 };
  s.events = { once: () => {} };
  s.input = {
    addPointer() {},
    on: (ev: string, fn: (p: unknown) => void) => (handlers[ev] = fn),
    manager: { pointers: [] as unknown[] },
    keyboard: { addKeys: vi.fn(() => ({})), on() {}, removeCapture: vi.fn() },
  };
  s.ghostView = { x: ghostAt.x, y: ghostAt.y };
  s.ghostImg = null;
  s.tweens = { add: vi.fn() };
  s.puff = vi.fn();
  s.floatText = vi.fn();
  s.fitCamera = vi.fn();
  s.tap = vi.fn();
  // Отрисовка в тесте не нужна — только логика кадра.
  for (const k of ['renderChars', 'followPlayerToRoom', 'renderGhost', 'updateGhostArrow', 'syncBuildings', 'renderDynamic', 'checkUnlocks', 'renderTutorial', 'renderHint', 'refreshMenu', 'handleKeys', 'trackMissedRepair'])
    s[k] = vi.fn();
  s.setupInput();
  return { s, m, hud, cam, onEnd, sfx, handlers };
}

/** Призрак побеждён: событие симуляции и исход матча (фаза end наступает через B.endDelay, раньше финала). */
function killGhost(s: AnyScene, m: AnyScene): void {
  m.ghost.state = 'dead';
  m.result = 'win';
  s.handleEvents([{ type: 'ghostDead' }]);
}

/** Кадры по 16 мс, всего ms. */
function frames(s: AnyScene, ms: number): void {
  for (let t = 0; t < ms; t += 16) s.update(t, 16);
}

describe('финал победы', () => {
  it('test_finale_offscreen_ghost_pans_camera_before_death', () => {
    // Arrange: призрак далеко за правым нижним краем экрана.
    const { s, m, cam, sfx } = scene({ x: 2400, y: 1400 });
    // Act
    killGhost(s, m);
    // Assert: камера плавно едет (не телепорт), смерть ещё не играет — ждёт подлёта.
    expect(cam.pan).toHaveBeenCalledTimes(1);
    expect(cam.pan.mock.calls[0][2]).toBe(FINALE.panMs);
    expect(cam.centerOn).not.toHaveBeenCalled();
    expect(sfx.play).not.toHaveBeenCalledWith('ghost_dead');
    frames(s, FINALE.panMs + 32);
    expect(sfx.play).toHaveBeenCalledWith('ghost_dead');
  });

  it('test_finale_visible_ghost_keeps_camera_and_dies_at_once', () => {
    // Arrange: призрак посреди экрана.
    const { s, m, cam, sfx } = scene({ x: 420, y: 230 });
    // Act
    killGhost(s, m);
    frames(s, 32);
    // Assert: камера не двигается, анимация смерти сразу.
    expect(cam.pan).not.toHaveBeenCalled();
    expect(sfx.play).toHaveBeenCalledWith('ghost_dead');
  });

  it('test_finale_results_wait_for_death_animation_and_fire_once', () => {
    // Arrange
    const { s, m, hud, onEnd } = scene({ x: 2400, y: 1400 });
    killGhost(s, m);
    m.phase = 'end'; // симуляция уже закончила матч (B.endDelay меньше финала)
    // Act + Assert: пока финал идёт — итогов нет; «Победа!» появляется до итогов.
    frames(s, FINALE.panMs + FINALE.deathMs - 100);
    expect(onEnd).not.toHaveBeenCalled();
    expect(hud.banner).toHaveBeenCalledWith('Победа!', expect.any(Number));
    frames(s, 400);
    expect(onEnd).toHaveBeenCalledTimes(1);
    // Повторные кадры и повторное событие не вызывают итоги/награду снова.
    s.handleEvents([{ type: 'ghostDead' }]);
    frames(s, 2000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('test_finale_total_length_is_one_to_two_seconds', () => {
    expect(FINALE.deathMs).toBeGreaterThanOrEqual(1000);
    expect(FINALE.panMs + FINALE.deathMs).toBeLessThanOrEqual(2200);
    expect(FINALE.cheerMs).toBeLessThan(FINALE.deathMs);
  });

  it('test_finale_blocks_gameplay_input', () => {
    // Arrange
    const { s, m, handlers, hud } = scene({ x: 2400, y: 1400 });
    killGhost(s, m);
    // Act: тап по полю, колесо, ключ.
    const p = { x: 100, y: 200, isDown: true, wasTouch: true };
    handlers.pointerdown(p);
    handlers.pointerup(p);
    (handlers.wheel as (...a: unknown[]) => void)(p, null, 0, 1);
    s.tutRepair();
    // Assert: ни тапа, ни ругательного тоста «Игра окончена», меню закрыто.
    expect(s.tap).not.toHaveBeenCalled();
    expect(hud.toast).not.toHaveBeenCalled();
    expect(hud.hideMenu).toHaveBeenCalled();
  });
});

describe('бегство лечиться читается (п. 8)', () => {
  it('test_retreat_from_my_door_shows_banner', () => {
    // Arrange: призрак ломился в мою дверь, камера смотрит в другое место.
    const { s, m, hud } = scene({ x: 2400, y: 1400 });
    m.ghost.targetRoom = m.player.roomId!;
    m.ghost.x = m.ghost.y = 40;
    // Act
    s.handleEvents([{ type: 'ghostRetreat', left: 2 }]);
    // Assert: крупно по центру, а не только мелкая надпись над призраком.
    expect(hud.banner).toHaveBeenCalledWith('Убегает лечиться!', expect.any(Number));
  });

  it('test_healed_ghost_coming_back_says_same_ghost', () => {
    // Arrange
    const { s, m, hud } = scene({ x: 2400, y: 1400 });
    // Act: вышел из гнезда и выбрал мою дверь; потом — обычный выбор двери.
    s.handleEvents([{ type: 'ghostHealed' }, { type: 'ghostTarget', roomId: m.player.roomId }]);
    s.handleEvents([{ type: 'ghostTarget', roomId: m.player.roomId }]);
    // Assert
    expect(hud.banner.mock.calls.map((c: unknown[]) => c[0])).toEqual(['Вылечился и идёт к тебе!', 'Призрак идёт к тебе!']);
  });
});

describe('своя дверь видна во время атаки (п. 7)', () => {
  it('test_ghost_coming_pans_camera_to_hidden_door', () => {
    // Arrange: камера отведена далеко от своей двери (scroll за пределами комнаты).
    const { s, m, cam } = scene({ x: 2400, y: 1400 });
    const d = m.playerRoom!.door;
    cam.scrollX = d.x * 48 + 2000;
    cam.scrollY = d.y * 48 + 2000;
    cam.worldView = { x: cam.scrollX, y: cam.scrollY };
    // Act
    s.handleEvents([{ type: 'ghostTarget', roomId: m.player.roomId }]);
    // Assert: плавно, а не прыжком.
    expect(cam.pan).toHaveBeenCalledTimes(1);
    expect(cam.centerOn).not.toHaveBeenCalled();
  });

  it('test_ghost_coming_keeps_camera_when_door_in_safe_band', () => {
    // Arrange: дверь посреди экрана.
    const { s, m, cam } = scene({ x: 2400, y: 1400 });
    const d = m.playerRoom!.door;
    cam.scrollX = (d.x + 0.5) * 48 - 422;
    cam.scrollY = (d.y + 0.5) * 48 - 215;
    cam.worldView = { x: cam.scrollX, y: cam.scrollY };
    // Act
    s.handleEvents([{ type: 'ghostTarget', roomId: m.player.roomId }]);
    // Assert
    expect(cam.pan).not.toHaveBeenCalled();
  });
});
