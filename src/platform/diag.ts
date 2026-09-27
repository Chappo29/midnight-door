import Phaser from 'phaser';

/**
 * Диагностика на чужом телефоне (жалоба «не могу двигаться и кликать», Galaxy S24, 2026-09-27).
 *   ?diag   — поверх игры плашка: браузер, экран, видеокарта, рендер, идут ли кадры, доходят ли касания
 *             и какой элемент их ловит, последние ошибки. Нажатия не перехватывает.
 *   ?canvas — рендер Canvas вместо WebGL (проверить, не виновата ли видеокарта).
 * Без параметров ничего не делает. Ошибки копятся всегда (последние 5) — плашка покажет и те, что были до неё.
 */
const params = new URLSearchParams(location.search);
const errors: string[] = [];
const remember = (msg: string) => {
  errors.push(msg.slice(0, 160));
  if (errors.length > 5) errors.shift();
};
window.addEventListener('error', (e) => remember(`${e.message} @${(e.filename ?? '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => remember(`promise: ${String((e.reason as Error)?.message ?? e.reason)}`));

/** Какой рендер просить у Phaser: ?canvas — Canvas, иначе как обычно (WebGL, если есть). */
export function rendererType(): number {
  return params.has('canvas') ? Phaser.CANVAS : Phaser.AUTO;
}

/** Видеокарта по данным WebGL (на отдельном маленьком холсте, игру не трогает). */
function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'WebGL нет';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch (e) {
    return `ошибка: ${(e as Error).message}`;
  }
}

/** Включить плашку диагностики, если в адресе есть ?diag. */
export function startDiag(game: Phaser.Game): void {
  if (!params.has('diag')) return;
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;left:4px;top:4px;right:4px;z-index:99999;pointer-events:none;background:rgba(0,0,0,.78);color:#9f9;' +
    'font:11px/1.35 monospace;padding:6px 8px;border-radius:8px;white-space:pre-wrap;word-break:break-all';
  document.body.appendChild(box);
  const gpu = gpuName();
  const n = { down: 0, touch: 0, cancel: 0, canvasDown: 0 };
  let last = '—';
  let lastTarget = '—';
  const describe = (el: Element | null) => (el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''}` : 'ничего');
  window.addEventListener('pointerdown', (e) => {
    n.down++;
    last = `${e.pointerType} ${Math.round(e.clientX)},${Math.round(e.clientY)}`;
    lastTarget = describe(document.elementFromPoint(e.clientX, e.clientY));
  }, true);
  window.addEventListener('touchstart', () => n.touch++, { capture: true, passive: true });
  window.addEventListener('pointercancel', () => n.cancel++, true);
  const hookCanvas = () => game.canvas?.addEventListener('pointerdown', () => n.canvasDown++, true);
  if (game.canvas) hookCanvas();
  else game.events.once(Phaser.Core.Events.READY, hookCanvas);
  let frames = 0;
  window.setInterval(() => {
    const loop = game.loop;
    const f = loop?.frame ?? 0;
    const running = f !== frames;
    frames = f;
    const scenes = game.scene?.getScenes(true).map((s) => s.sys.settings.key).join(',') || '—';
    box.textContent = [
      navigator.userAgent,
      `экран ${innerWidth}×${innerHeight} dpr ${devicePixelRatio} касаний ${navigator.maxTouchPoints}`,
      `GPU: ${gpu}`,
      `рендер: ${game.renderer ? (game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas') : 'ещё нет'}${params.has('canvas') ? ' (?canvas)' : ''}`,
      `кадры: ${f} ${running ? 'идут' : 'СТОЯТ'} fps ${Math.round(loop?.actualFps ?? 0)} | сцены: ${scenes}`,
      `нажатия: pointer ${n.down} touch ${n.touch} отмена ${n.cancel} по холсту ${n.canvasDown}`,
      `последнее: ${last} → ${lastTarget}`,
      `ошибки: ${errors.length ? errors.join(' | ') : 'нет'}`,
    ].join('\n');
  }, 500);
}
