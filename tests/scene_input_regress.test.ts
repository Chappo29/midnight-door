/**
 * Регрессия FINAL_QA_REPORT.md QA-07 (ПК шире 2:1: координаты холста ≠ координаты окна), QA-09 (щипок в обучении),
 * QA-18 (меню стройки после поворота экрана), QA-20 (захват клавиш после матча). Настоящий GameScene без браузера: Phaser заглушен.
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

// Узел без DOM: GameScene трогает document.hidden в init() и window.addEventListener в setupInput().
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

const { GameScene } = await import('../src/view/GameScene');
const { inRoomMatch } = await import('./helpers');

type AnyScene = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Поле по центру окна со сдвигом left (как на ПК шире 2:1). */
function scene(left = 280, tutorial = false) {
  const s = new GameScene() as unknown as AnyScene;
  const hud = { hideMenu: vi.fn(), isEchoOfPress: vi.fn(() => false), inputReadyAt: 0, menuOpen: false };
  s.init({ match: inRoomMatch(), hud, sfx: { play() {} }, onEnd: vi.fn(), onMenu: vi.fn() });
  const canvas = { getBoundingClientRect: () => ({ left, top: 0 }) };
  const handlers: Record<string, (p: unknown) => void> = {};
  const cam = { zoom: 1, scrollX: 0, scrollY: 0, worldView: { x: 0, y: 0 }, setZoom: vi.fn(), getWorldPoint: (x: number, y: number) => ({ x, y }) };
  s.game = { canvas };
  s.cameras = { main: cam };
  const onShutdown: Array<() => void> = [];
  s.events = { once: (ev: string, fn: () => void) => ev === 'shutdown' && onShutdown.push(fn) };
  const keyboard = { addKeys: vi.fn(() => ({})), on() {}, removeCapture: vi.fn() };
  s.input = {
    addPointer() {},
    on: (ev: string, fn: (p: unknown) => void) => (handlers[ev] = fn),
    manager: { pointers: [] as unknown[] },
    keyboard,
  };
  s.fitCamera = vi.fn();
  s.clampCamera = () => {};
  s.tap = vi.fn();
  if (tutorial) s.tut = { done: false };
  s.setupInput();
  return { s, hud, handlers, cam, canvas, keyboard, shutdown: () => onShutdown.forEach((fn) => fn()) };
}

describe('координаты окна vs холста на ПК шире 2:1 (QA-07)', () => {
  it('test_tutorial_target_rect_includes_canvas_offset', () => {
    const { s } = scene(280);
    const r = s.targetRect({ kind: 'cell', at: { x: 2, y: 3 } });
    // Центр клетки 2,5 × 48 = 120 px от холста → 400 px от окна.
    expect(r.x + r.width / 2).toBe(280 + 2.5 * 48);
    expect(r.y + r.height / 2).toBe(3.5 * 48);
  });

  it('test_field_tap_echo_check_uses_window_coordinates', () => {
    const { handlers, hud } = scene(280);
    const p = { x: 10, y: 20, isDown: true, wasTouch: false };
    handlers.pointerdown(p);
    handlers.pointerup(p);
    expect(hud.isEchoOfPress).toHaveBeenCalledWith(expect.any(Number), 290, 20);
  });
});

describe('щипок в обучении (QA-09)', () => {
  function twoFingers(canvas: unknown, s: AnyScene) {
    const a = { x: 100, y: 100, isDown: true, downElement: canvas, wasTouch: true };
    const b = { x: 200, y: 100, isDown: true, downElement: canvas, wasTouch: true };
    s.input.manager.pointers = [a, b];
    return { a, b };
  }

  it('test_pinch_does_not_zoom_during_tutorial', () => {
    const { s, handlers, cam, canvas } = scene(0, true);
    const { a, b } = twoFingers(canvas, s);
    handlers.pointerdown(b);
    b.x = 400; // пальцы разводятся
    handlers.pointermove(b);
    expect(s.pinch.active).toBe(false);
    expect(cam.setZoom).not.toHaveBeenCalled();
    handlers.pointerup(a);
    expect(s.tap).not.toHaveBeenCalled(); // двумя пальцами — не тап
  });

  it('test_pinch_still_zooms_after_tutorial', () => {
    const { s, handlers, cam, canvas } = scene(0, false);
    const { b } = twoFingers(canvas, s);
    handlers.pointerdown(b);
    b.x = 400;
    handlers.pointermove(b);
    expect(s.pinch.active).toBe(true);
    expect(cam.setZoom).toHaveBeenCalled();
  });
});

describe('поворот экрана с открытым меню стройки (QA-18)', () => {
  it('test_resize_closes_build_menu_and_selection', () => {
    const { s, hud } = scene(0);
    s.selected = { x: 3, y: 2 };
    s.onResize();
    expect(hud.hideMenu).toHaveBeenCalled();
    expect(s.selected).toBeNull();
    expect(s.fitCamera).toHaveBeenCalled();
  });
});

describe('клавиатура после матча (QA-20)', () => {
  it('test_scene_shutdown_releases_key_capture', () => {
    const { keyboard, shutdown } = scene(0);
    const keys = (keyboard.addKeys.mock.calls[0] as unknown[])[0] as string;
    expect(keys).toContain('ESC');
    expect(keys).not.toContain('SPACE'); // пробел в игре не нужен — страницу им не блокируем
    shutdown();
    expect(keyboard.removeCapture).toHaveBeenCalledWith(keys); // захват снят с тех же клавиш
  });
});
