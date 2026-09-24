import { SPRITES } from '../view/sprites';
import type { Pose } from './steps';

/** Держать «пропустить», мс: случайный тап ребёнка не сработает, взрослому читать не надо. */
const SKIP_HOLD_MS = 1200;

/**
 * DOM-слой обучения. Затемнение с «прожектором» лежит между игрой и интерфейсом
 * (кнопки HUD и меню остаются яркими), палец и кот — поверх всего.
 * Сам ничего не решает: куда показывать, говорит режиссёр через show().
 */
export class TutorialOverlay {
  private readonly dim: HTMLDivElement;
  private readonly top: HTMLDivElement;
  private readonly spot: HTMLDivElement;
  /** Четыре тёмные панели вокруг «прожектора» (огромная box-shadow рисуется не везде). */
  private readonly panels: HTMLDivElement[];
  private readonly hand: HTMLDivElement;
  private readonly guide: HTMLDivElement;
  private readonly cat: HTMLImageElement | HTMLDivElement;
  private readonly bubble: HTMLDivElement;
  private readonly skipBtn: HTMLButtonElement;
  private skipTimer = 0;
  private lastText = '';
  private lastPose: Pose | '' = '';

  /**
   * light — режим подсказок во время обычной игры: без затемнения, звёздочек и «пропустить».
   */
  constructor(
    onSkip: () => void,
    light = false,
  ) {
    this.dim = el('div', light ? 'tut-dim light' : 'tut-dim');
    this.spot = el('div', 'tut-spot');
    this.panels = [0, 1, 2, 3].map(() => el('div', 'tut-shade'));
    this.dim.append(...this.panels, this.spot);
    // Между #game и #ui: HUD и меню не затемняются.
    document.body.insertBefore(this.dim, document.getElementById('ui'));

    this.top = el('div', light ? 'tut-top light' : 'tut-top');
    this.hand = el('div', 'tut-hand');
    this.hand.textContent = '👆';
    this.guide = el('div', 'tut-guide');
    this.cat = SPRITES.mascot_wave ? Object.assign(document.createElement('img'), { className: 'tut-cat', alt: '' }) : el('div', 'tut-cat');
    if (!(this.cat instanceof HTMLImageElement)) this.cat.textContent = '🐱';
    this.bubble = el('div', 'tut-bubble');
    this.guide.append(this.cat, this.bubble);
    this.skipBtn = document.createElement('button');
    this.skipBtn.className = 'tut-skip';
    this.skipBtn.setAttribute('aria-label', 'Пропустить обучение (держать)');
    this.skipBtn.innerHTML = '<span class="ring"></span>⏭';
    this.top.append(this.hand, this.guide, this.skipBtn);
    document.body.appendChild(this.top);

    const start = (e: Event) => {
      e.preventDefault();
      this.skipBtn.classList.add('holding');
      this.skipTimer = window.setTimeout(onSkip, SKIP_HOLD_MS);
    };
    const stop = () => {
      this.skipBtn.classList.remove('holding');
      window.clearTimeout(this.skipTimer);
    };
    this.skipBtn.addEventListener('pointerdown', start);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) this.skipBtn.addEventListener(ev, stop);
  }

  /**
   * Показать шаг. rect — куда светить и показывать пальцем (экранные px), null — никуда.
   * nudge растёт, пока ребёнок бездействует: палец крупнее, цель пульсирует.
   */
  show(text: string, pose: Pose, rect: DOMRect | null, nudge: number, hand = true): void {
    if (text !== this.lastText) {
      this.bubble.textContent = text;
      this.lastText = text;
      this.guide.classList.remove('pop');
      void this.guide.offsetWidth;
      this.guide.classList.add('pop');
    }
    if (pose !== this.lastPose && this.cat instanceof HTMLImageElement) {
      this.cat.src = SPRITES[`mascot_${pose}`] ?? SPRITES.mascot_wave;
      this.lastPose = pose;
    }
    this.top.classList.remove('off');

    if (!rect) {
      this.spot.classList.add('off');
      this.hand.classList.add('off');
      this.shade(null);
      return;
    }
    this.pointAt(rect, nudge);
    // Когда надо просто смотреть (призрак), пальцем не тыкаем — нажимать нечего.
    if (!hand) this.hand.classList.add('off');
  }

  /** Прожектор и палец на цель; цель за краем экрана — стрелка у края в её сторону. */
  private pointAt(rect: DOMRect, nudge: number): void {
    const pad = 10;
    Object.assign(this.spot.style, {
      left: `${rect.left - pad}px`,
      top: `${rect.top - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });
    this.spot.classList.remove('off');
    this.spot.classList.toggle('nudge', nudge > 0);
    this.shade(new DOMRect(rect.left - pad, rect.top - pad, rect.width + pad * 2, rect.height + pad * 2));
    this.hand.classList.remove('off');
    this.hand.classList.toggle('big', nudge > 0);
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const m = 48;
    const x = Math.min(window.innerWidth - m, Math.max(m, cx));
    const y = Math.min(window.innerHeight - m, Math.max(m, cy));
    const off = x !== cx || y !== cy;
    this.hand.classList.toggle('edge', off);
    this.hand.textContent = off ? '➤' : '👆';
    this.hand.style.setProperty('--ang', `${Math.atan2(cy - y, cx - x)}rad`);
    // Палец кончиком в центр цели.
    this.hand.style.left = `${x}px`;
    this.hand.style.top = `${y}px`;
  }

  /** Затемнить всё, кроме дырки hole (null — затемнить весь экран слабее). */
  private shade(hole: DOMRect | null): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const boxes = hole
      ? [
          [0, 0, W, Math.max(0, hole.top)],
          [0, hole.bottom, W, Math.max(0, H - hole.bottom)],
          [0, hole.top, Math.max(0, hole.left), hole.height],
          [hole.right, hole.top, Math.max(0, W - hole.right), hole.height],
        ]
      : [[0, 0, W, H], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    this.dim.classList.toggle('soft', !hole);
    this.panels.forEach((p, i) => {
      const [x, y, w, h] = boxes[i];
      p.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    });
  }

  /** Спрятать (подсказка кончилась). */
  hide(): void {
    this.top.classList.add('off');
    this.spot.classList.add('off');
  }

  /** Короткая похвала за выполненный шаг. */
  praise(): void {
    this.guide.classList.remove('yay');
    void this.guide.offsetWidth;
    this.guide.classList.add('yay');
  }

  destroy(): void {
    window.clearTimeout(this.skipTimer);
    this.dim.remove();
    this.top.remove();
  }
}

function el(tag: string, cls: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = cls;
  return e;
}
