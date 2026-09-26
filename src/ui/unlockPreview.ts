import { B, buildBaseCost } from '../sim/balance';
import type { UnlockKind } from '../meta/unlocks';
import { SPRITES } from '../view/sprites';

/**
 * Экран «Новое!»: несколько коротких кадров-сценок из спрайтов игры (CSS-анимация), объясняем картинкой, а не текстом.
 * Кадры: (для поздних построек) сначала укрепи дверь → как поставить → что делает. У тыквы вместо двери —
 * «зачем пламя». Сценки показывают настоящую механику из sim: тыква даёт пламя, капкан держит призрака на месте,
 * верстак ночью чинит дверь, холодильник — призрак бьёт реже; цены и уровни дверей — из balance.ts.
 */
export const UNLOCK_INFO: Record<UnlockKind, { name: string; line: string; sprite: string }> = {
  pumpkin: { name: 'Тыква', line: 'Даёт {flame}', sprite: 'pumpkin' },
  trap: { name: 'Капкан', line: 'Задерживает призрака', sprite: 'trap' },
  workbench: { name: 'Верстак', line: 'Чинит дверь ночью', sprite: 'workbench' },
  // Механика: призрак бьёт дверь этой комнаты реже (B.fridge.slow) — не «отвлекает», так и пишем.
  fridge: { name: 'Холодильник', line: 'Призрак стучит реже', sprite: 'fridge' },
};

/** Один кадр экрана «Новое!»: подпись (можно с иконками) и сценка; ms — сколько кадр показывается. */
export interface UnlockFrame {
  caption: string;
  html: string;
  ms: number;
}

const pic = (key: string, cls: string): string => (SPRITES[key] ? `<img class="${cls}" src="${SPRITES[key]}" alt="">` : '');

/** Иконки для подписей и сценок (svg пламени приходит из общей библиотеки интерфейса). */
interface Icons {
  flame: string;
  lock: string;
}

const doorBadge = (level: number) => `<span class="pv-doorbadge">${pic('door_l1', 'pv-doorbadge-img')}${level}</span>`;

/** Цена, как в меню постройки: конфеты и, если нужно, пламя. */
function costHtml(kind: UnlockKind, ic: Icons): string {
  const c = buildBaseCost(kind);
  const candy = `<span class="pv-cost-part">${pic('candy_shot', 'pv-cost-ico')}${c.candy}</span>`;
  const flame = c.flame ? `<span class="pv-cost-part"><span class="pv-cost-ico">${ic.flame}</span>${c.flame}</span>` : '';
  return candy + flame;
}

/**
 * «Как поставить»: палец нажимает на клетку у двери (у тыквы — на грядку) → открывается меню с постройкой →
 * палец выбирает её → постройка появляется на клетке. Так же, как в игре.
 */
function placeHtml(kind: UnlockKind, ic: Icons): string {
  const info = UNLOCK_INFO[kind];
  const soil = kind === 'pumpkin';
  return `
    <div class="pv pv-place">
      <span class="pv-room"></span>
      ${pic('door_l2', 'pv-walldoor')}
      <span class="pv-cell${soil ? ' soil' : ''}"></span>
      <span class="pv-ring"></span>
      ${pic(info.sprite, 'pv-built')}
      <span class="pv-menu">
        <span class="pv-menu-title">${soil ? 'Грядка' : 'Пол'}</span>
        <span class="pv-menu-row">${pic(info.sprite, 'pv-menu-ico')}<b>${info.name}</b><span class="pv-cost">${costHtml(kind, ic)}</span></span>
      </span>
      <span class="pv-finger">👆</span>
    </div>`;
}

/** «Сначала дверь»: замок 🚪N у постройки → палец улучшает дверь → дверь N-го уровня → замок открылся. */
function doorHtml(kind: UnlockKind, need: number, ic: Icons): string {
  const info = UNLOCK_INFO[kind];
  return `
    <div class="pv pv-doorup">
      <span class="pv-room"></span>
      <span class="pv-doorpair">${pic('door_l1', 'pv-door-old')}${pic(`door_l${need}`, 'pv-door-new')}</span>
      <span class="pv-up-arrow">▲</span>
      <span class="pv-menu">
        <span class="pv-menu-title">Дверь</span>
        <span class="pv-menu-row"><span class="pv-menu-up">▲</span><b>Улучшить</b></span>
      </span>
      <span class="pv-lockbox">${pic(info.sprite, 'pv-lock-thing')}<span class="pv-lock"><span class="pv-cost-ico">${ic.lock}</span>${doorBadge(need)}</span><span class="pv-open">✓</span></span>
      <span class="pv-finger">👆</span>
    </div>`;
}

/** Тыква, кадр «зачем»: пламя из счётчика уходит на улучшение двери и пушки. */
function flameUseHtml(ic: Icons): string {
  return `
    <div class="pv pv-flameuse">
      <span class="pv-counter"><span class="pv-ci">${ic.flame}</span><span class="pv-n">5</span></span>
      <span class="pv-useitem pv-use-door">${pic('door_l3', 'pv-use-img')}<span class="pv-use-chip">▲<span class="pv-ci">${ic.flame}</span></span></span>
      <span class="pv-useitem pv-use-cannon">${pic('cannon_base', 'pv-use-img')}<span class="pv-use-chip">▲<span class="pv-ci">${ic.flame}</span></span></span>
    </div>`;
}

/** Сценка «что делает» (зацикленная). */
export function demoHtml(kind: UnlockKind, flame: string): string {
  switch (kind) {
    case 'pumpkin':
      // Тыква подпрыгивает → «+🔥» вылетает и летит в счётчик → счётчик 0→1 → загорается улучшение двери за 🔥.
      return `
        <div class="pv pv-pumpkin">
          <span class="pv-counter"><span class="pv-ci">${flame}</span><span class="pv-n pv-n0">0</span><span class="pv-n pv-n1">1</span></span>
          ${pic('pumpkin', 'pv-thing pv-pump')}
          <span class="pv-fly"><b>+</b>${flame}</span>
          <span class="pv-doorbox">${pic('door_l3', 'pv-door')}<span class="pv-up">▲<span class="pv-ci">${flame}</span></span></span>
        </div>`;
    case 'trap':
      // Призрак летит по коридору → попадает в капкан → стоит на месте (звёздочки) → исчезает, круг сначала.
      return `
        <div class="pv pv-trap">
          <span class="pv-floor"></span>
          ${pic('trap', 'pv-thing pv-trapimg')}
          <span class="pv-ghostbox">${pic('ghost_side_fly1', 'pv-ghost')}<span class="pv-stars">✦ ✦ ✦</span></span>
        </div>`;
    case 'workbench':
      // Дверь побита (полоска короткая) → верстак стучит → «+» летит к двери → полоска подрастает, трижды.
      return `
        <div class="pv pv-bench">
          ${pic('workbench', 'pv-thing pv-benchimg')}
          <span class="pv-plus pv-p1">+</span><span class="pv-plus pv-p2">+</span><span class="pv-plus pv-p3">+</span>
          <span class="pv-doorbox">${pic('door_l2', 'pv-door')}<span class="pv-bar"><span class="pv-fill"></span></span></span>
        </div>`;
    case 'fridge':
      // Призрак снаружи, холодильник в комнате за дверью. Сначала призрак бьёт дверь часто (три удара) → холодильник дует холодом → синий призрак бьёт реже (два удара за дольше).
      return `
        <div class="pv pv-fridge">
          <span class="pv-ghostbox">${pic('ghost_side_attack1', 'pv-ghost')}</span>
          <span class="pv-doorbox">${pic('door_l2', 'pv-door')}<span class="pv-hit"></span></span>
          <span class="pv-cold"></span>
          ${pic('fridge', 'pv-thing pv-fridgeimg')}
        </div>`;
  }
}

/** Кадры экрана «Новое!» по порядку. Подписи короткие: одна строка, главное — картинка. */
export function unlockFrames(kind: UnlockKind, ic: Icons): UnlockFrame[] {
  const flameIco = `<span class="unlock-cap-ico">${ic.flame}</span>`;
  const effect: UnlockFrame = {
    caption: UNLOCK_INFO[kind].line.replace('{flame}', flameIco),
    html: demoHtml(kind, ic.flame),
    ms: kind === 'fridge' ? 5000 : 4500,
  };
  if (kind === 'pumpkin') {
    return [
      { caption: 'Нажми на грядку и выбери тыкву', html: placeHtml(kind, ic), ms: 4500 },
      { caption: `Тыква даёт ${flameIco}`, html: effect.html, ms: 4500 },
      { caption: `${flameIco} нужно, чтобы улучшать дверь и пушки`, html: flameUseHtml(ic), ms: 4000 },
    ];
  }
  const need = B.unlock[kind];
  return [
    { caption: `Сначала улучши дверь до ${doorBadge(need)}`, html: doorHtml(kind, need, ic), ms: 4500 },
    { caption: kind === 'trap' ? 'Поставь капкан на пол у двери' : `Поставь на пол в комнате`, html: placeHtml(kind, ic), ms: 4500 },
    effect,
  ];
}
