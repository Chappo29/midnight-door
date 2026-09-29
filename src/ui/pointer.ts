/**
 * Палец-указатель и стрелка для обучения и экрана «Новое!»: картинка вместо эмодзи 👆 и ➤,
 * которых нет в шрифтах старых систем (правила Яндекса 1.14, 1.20).
 */
const INK = '#1c1330';

/** Рука с поднятым пальцем: кончик пальца — верх по центру левой трети. */
export const HAND_SVG = `<svg class="pointer-svg" viewBox="0 0 40 54" width="1em" height="1.35em" aria-hidden="true" focusable="false"><path d="M13 5.5a4.2 4.2 0 0 1 8.4 0V22l3.1-1a3.6 3.6 0 0 1 4.6 2.3l.6 1.6 2.1-.6a3.5 3.5 0 0 1 4.3 2.4l.4 1.6 1.2-.3a3.4 3.4 0 0 1 4.1 2.7l.8 6.4c.6 4.6-1.6 9.1-5.6 11.3l-.5 3.6H15.4l-1.6-4.8-8.6-11a3.6 3.6 0 0 1 .5-5 3.7 3.7 0 0 1 5.1.4L13 30.4z" fill="#fff" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/></svg>`;

/** Стрелка к цели за краем экрана (поворачивается CSS-переменной --ang). */
export const ARROW_SVG = `<svg class="pointer-svg" viewBox="0 0 40 40" width="1em" height="1em" aria-hidden="true" focusable="false"><path d="M6 8l30 12L6 32l7-12z" fill="#ffd35c" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/></svg>`;
