import type { Progress } from '../platform/storage';
import type { Match } from '../sim/match';
import type { Cost, Difficulty } from '../sim/types';
import { SPRITES } from '../view/sprites';
import { B } from '../sim/balance';
import { BOOSTER_MAX } from '../meta/economy';
import type { BoosterId, Reward, SkinSlot } from '../meta/economy';
import type { CaughtTip, CaughtTipKind } from './caughtTip';
import { HOLDOVER_MS, INPUT_GUARD_MS, isEchoAfterScreenChange, isHoldover, menuTopAwayFromFinger } from './inputGuard';

export interface MenuOption {
  /** Код пункта (для обучения: какой пункт показать и куда указать пальцем; и для подбора иконки). */
  id?: string;
  icon: string;
  label: string;
  /** Короткая серая строка-описание под названием (необязательно). */
  desc?: string;
  cost?: Cost | null;
  note?: string;
  poor?: boolean;
  disabled?: boolean;
  /** Пункт упёрся в уровень двери (диван, поздние постройки): кликабелен, но выглядит запертым —
   *  вместо цены пилюля с замком и номером нужного уровня; onPick решает сам, что делать (например, подсветить дверь). */
  lockDoor?: number;
  /** Сколько у игрока сейчас: для «банки», которая наполняется до цены (не хватает — видно без чисел). */
  have?: Cost;
  /** Нажали, а денег не хватает: меню не закрываем, кнопка вздрагивает; тут — доп. реакция (подсказка про тыкву). */
  onPoor?: () => void;
  /** Опасное действие (продать): первый тап спрашивает этот текст и показывает «Да» в стороне от пальца. */
  confirm?: string;
  /** Второстепенный пункт — приглушённый, не зовёт нажать. */
  secondary?: boolean;
  /** Только что открылась — метка «Новое!». */
  isNew?: boolean;
  onPick: () => void;
}

export interface HudHandlers {
  repair: () => void;
  home: () => void;
  pause: () => void;
  /** Умения духа (игрока поймали): «Бу!» и «Искорка». */
  boo: () => void;
  spark: () => void;
}

/** Метапрогресс на главном меню: монеты и переходы в магазин/подарок. */
export interface MenuMeta {
  coins: number;
  giftReady: boolean;
  onShop: () => void;
  onGift: () => void;
}

export interface ShopView {
  coins: number;
  heroes: { look: number; name: string; price: number; owned: boolean; selected: boolean }[];
  skins: { slot: SkinSlot; items: { id: string; name: string; price: number; ready: boolean; owned: boolean; selected: boolean }[] }[];
  boosters: { id: BoosterId; title: string; desc: string; price: number; count: number }[];
}

export interface ShopHandlers {
  buyHero: (look: number) => void;
  selectHero: (look: number) => void;
  buySkin: (slot: SkinSlot, id: string) => void;
  selectSkin: (slot: SkinSlot, id: string) => void;
  buyBooster: (id: BoosterId) => void;
  close: () => void;
}

type ShopTab = 'heroes' | 'skins' | 'boosters';

const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Лёгкая', hard: 'Сложная', nightmare: 'Кошмар' };
const DIFF_DESC: Record<Difficulty, string> = { easy: 'для начала', hard: 'призрак хитрее', nightmare: 'только для смелых' };

/** Текстовое представление цены — без эмодзи, для aria-label и служебных нужд. */
export function costText(c: Cost): string {
  return `${Math.round(c.candy)} конфет${c.flame ? ` + ${Math.round(c.flame)} пламени` : ''}`;
}

/** Любые уцелевшие эмодзи в тексте, который пришёл снаружи (GameScene), вырезаем перед показом как «значок». */
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]/gu;
const stripEmoji = (s: string): string => s.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();

function img(key: string, cls = ''): string {
  const url = SPRITES[key];
  return url ? `<img class="${cls}" src="${url}" alt="">` : '';
}

/* ---------------- общая библиотека SVG-иконок (толстый контур, глянец — в духе спрайтов) ---------------- */

const ICON_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="hg-mint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8bf7d6"/><stop offset=".55" stop-color="#2fe3a6"/><stop offset="1" stop-color="#0e9c6e"/></linearGradient>
  <linearGradient id="hg-straw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8fa3"/><stop offset=".55" stop-color="#ff4d6d"/><stop offset="1" stop-color="#c31e42"/></linearGradient>
  <linearGradient id="hg-amber" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset=".55" stop-color="#ffb238"/><stop offset="1" stop-color="#d97f0e"/></linearGradient>
  <linearGradient id="hg-grape" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3a6ff"/><stop offset=".55" stop-color="#8b5cf6"/><stop offset="1" stop-color="#5a32b8"/></linearGradient>
  <linearGradient id="hg-silver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6fb"/><stop offset=".6" stop-color="#c7ccd6"/><stop offset="1" stop-color="#8c93a3"/></linearGradient>
  <radialGradient id="hg-coin" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#fff6d0"/><stop offset=".45" stop-color="#ffd166"/><stop offset="1" stop-color="#b9790c"/></radialGradient>
</defs></svg>`;

const ICON = {
  flame: `<svg viewBox="0 0 24 24"><path d="M12 1.8c.6 2.9 3.4 4.6 4.9 7.4 1.9 3.4 1 7.7-2.1 9.6-1.6 1-3.5 1.4-5.3.9-3.3-.9-5.4-4.1-4.8-7.5.3-1.9 1.4-3.3 2.4-4.6.3 1.3 1 2.3 2 2.8-.4-3 .9-6 2.9-8.6z" fill="#ff7a2e" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M12.2 10.6c.4 1.6 2.3 2.5 2.4 4.6.1 1.9-1.3 3.4-3 3.4-1.8 0-3.1-1.6-2.8-3.4.1-.9.6-1.6 1.1-2.2.2.7.6 1.1 1.1 1.3-.2-1.5.4-2.7 1.2-3.7z" fill="#ffd166" stroke="var(--ink)" stroke-width="1" stroke-linejoin="round"/></svg>`,
  clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" fill="url(#hg-silver)" stroke="var(--ink)" stroke-width="1.4"/><path d="M12 8v5l3.5 2" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M9.5 2h5" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.6" fill="#fff" stroke="var(--ink)" stroke-width="1.3"/><rect x="14" y="5" width="4" height="14" rx="1.6" fill="#fff" stroke="var(--ink)" stroke-width="1.3"/></svg>`,
  soundOn: `<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4z" fill="#fff" stroke="var(--ink)" stroke-width="1.3" stroke-linejoin="round"/><path d="M16.5 9a4.5 4.5 0 0 1 0 6" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  soundOff: `<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4z" fill="#fff" stroke="var(--ink)" stroke-width="1.3" stroke-linejoin="round"/><path d="M16 9l5 6M21 9l-5 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  home: `<svg viewBox="0 0 24 24"><path d="M4 11.5 12 4l8 7.5" stroke="var(--ink)" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M6 10.5V20h12v-9.5" fill="#fff" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/><rect x="10" y="14" width="4" height="6" fill="url(#hg-grape)" stroke="var(--ink)" stroke-width="1.2"/></svg>`,
  wrench: `<svg viewBox="0 0 24 24"><path d="M14.7 6.3a3.5 3.5 0 0 0-4.6 4l-6 6 2 2 6-6a3.5 3.5 0 0 0 4-4.6l-2.1 2.1-1.6-1.6 2.1-2.1z" fill="url(#hg-silver)" stroke="var(--ink)" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>`,
  up: `<svg viewBox="0 0 24 24"><path d="M12 19V6M6 11l6-6 6 6" stroke="var(--ink)" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M5 7h14l-1.2 12.4a2 2 0 0 1-2 1.6H8.2a2 2 0 0 1-2-1.6z" fill="#d9d3e6" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M3.5 7h17M9.5 7V4.5h5V7" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="var(--ink)" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  lock: `<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2" fill="#fff" stroke="var(--ink)" stroke-width="1.3"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="var(--ink)" stroke-width="1.6"/></svg>`,
  /** Поздние постройки — заглушки, пока нет спрайтов trap/workbench/fridge: капкан (тарелка с липким желе и леденцом), верстак с молотком, холодильник с магнитом-конфетой. */
  trap: `<svg viewBox="0 0 24 24"><ellipse cx="11" cy="16.5" rx="9" ry="5" fill="url(#hg-silver)" stroke="var(--ink)" stroke-width="1.4"/><ellipse cx="11" cy="15.8" rx="5.6" ry="2.8" fill="#ff7eb6" stroke="var(--ink)" stroke-width="1.1"/><path d="M15 14.5 18 6.5" stroke="var(--ink)" stroke-width="2.8" stroke-linecap="round"/><path d="M15 14.5 18 6.5" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/><circle cx="18.4" cy="5.4" r="3.7" fill="url(#hg-straw)" stroke="var(--ink)" stroke-width="1.3"/><path d="M16.9 5a1.6 1.6 0 1 1 1.6 1.8" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></svg>`,
  bench: `<svg viewBox="0 0 24 24"><path d="M5.5 13v7M18.5 13v7" stroke="var(--ink)" stroke-width="3.2" stroke-linecap="round"/><path d="M5.5 13v7M18.5 13v7" stroke="#b07d42" stroke-width="1.4" stroke-linecap="round"/><rect x="2.5" y="10" width="19" height="4.2" rx="1.4" fill="#c98a4b" stroke="var(--ink)" stroke-width="1.3"/><path d="M6.5 8.5 13.5 4.6" stroke="var(--ink)" stroke-width="2.8" stroke-linecap="round"/><path d="M6.5 8.5 13.5 4.6" stroke="#f3d7a4" stroke-width="1.2" stroke-linecap="round"/><rect x="12.3" y="1.6" width="6.4" height="4.6" rx="1.1" transform="rotate(-29 15.5 3.9)" fill="url(#hg-silver)" stroke="var(--ink)" stroke-width="1.2"/></svg>`,
  fridge: `<svg viewBox="0 0 24 24"><rect x="5.5" y="2" width="13" height="20" rx="3.4" fill="#eaf6ff" stroke="var(--ink)" stroke-width="1.4"/><path d="M5.5 9.2h13" stroke="var(--ink)" stroke-width="1.2"/><path d="M15.6 4.6v2.4M15.6 11.6v4" stroke="var(--ink)" stroke-width="1.7" stroke-linecap="round"/><path d="M9 14.2 7.4 12.8v2.8zM12.4 14.2l1.6-1.4v2.8z" fill="url(#hg-straw)" stroke="var(--ink)" stroke-width=".8" stroke-linejoin="round"/><circle cx="10.7" cy="14.2" r="2" fill="url(#hg-straw)" stroke="var(--ink)" stroke-width="1"/></svg>`,
  replay: `<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 2.6 5.9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M4 12V7M4 12h5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  menuList: `<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke="var(--ink)" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 10-13h-6l1-7z" fill="url(#hg-amber)" stroke="var(--ink)" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
  skull: `<svg viewBox="0 0 24 24"><path d="M12 2a8 8 0 0 0-6 13.3V19h3v-2h2v2h2v-2h2v2h3v-3.7A8 8 0 0 0 12 2z" fill="#fff" stroke="var(--ink)" stroke-width="1.3" stroke-linejoin="round"/><circle cx="9.3" cy="11" r="1.7" fill="var(--ink)"/><circle cx="14.7" cy="11" r="1.7" fill="var(--ink)"/></svg>`,
  book: `<svg viewBox="0 0 24 24"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13z" fill="url(#hg-grape)" stroke="var(--ink)" stroke-width="1.3"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13z" fill="url(#hg-grape)" stroke="var(--ink)" stroke-width="1.3"/></svg>`,
  star: `<svg viewBox="0 0 24 24"><path d="M12 2l2.6 6.2 6.7.6-5.1 4.4 1.6 6.6L12 16.4 6.2 19.8l1.6-6.6L2.7 8.8l6.7-.6z" fill="url(#hg-amber)" stroke="var(--ink)" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24"><path d="M6 3h12v5a6 6 0 0 1-12 0z" fill="url(#hg-amber)" stroke="var(--ink)" stroke-width="1.3"/><path d="M6 5H3a4 4 0 0 0 4 5" stroke="var(--ink)" stroke-width="1.3" fill="none"/><path d="M18 5h3a4 4 0 0 1-4 5" stroke="var(--ink)" stroke-width="1.3" fill="none"/><rect x="10" y="14" width="4" height="4" fill="url(#hg-amber)" stroke="var(--ink)" stroke-width="1.1"/><rect x="7" y="18" width="10" height="3" rx="1.4" fill="#fff" stroke="var(--ink)" stroke-width="1.1"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="#fff" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  skip: `<svg viewBox="0 0 24 24"><path d="M5 6v12l9-6z" fill="var(--ink)"/><path d="M14 6v12l9-6z" fill="var(--ink)"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="url(#hg-mint)" stroke="var(--ink)" stroke-width="1.3"/><path d="M8 12.5l2.5 2.5L16 9" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  /** Крестик в том же стиле, что галочка: для «выжило», когда тебя поймали. */
  cross: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="url(#hg-straw)" stroke="var(--ink)" stroke-width="1.3"/><path d="M9 9l6 6M15 9l-6 6" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`,
  /** Монета метапрогресса — отдельная от конфеты в матче: золото, эмбоссированная звёздочка. */
  coin: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.6" fill="url(#hg-coin)" stroke="var(--ink)" stroke-width="1.5"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="#fff3c4" stroke-width="1" stroke-opacity=".85"/><path d="M12 7.4l1.1 2.4 2.6.3-1.9 1.8.5 2.6-2.3-1.3-2.3 1.3.5-2.6-1.9-1.8 2.6-.3z" fill="#fff3c4" stroke="var(--ink)" stroke-width=".9" stroke-linejoin="round"/></svg>`,
  shop: `<svg viewBox="0 0 24 24"><path d="M5 9l1.4-4.6A2 2 0 0 1 8.3 3h7.4a2 2 0 0 1 1.9 1.4L19 9" fill="none" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.4 9h15.2l-1 10.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8L4.4 9z" fill="url(#hg-straw)" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/><path d="M8.5 9a3.5 3.5 0 0 0 7 0" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  gift: `<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="1.6" fill="url(#hg-mint)" stroke="var(--ink)" stroke-width="1.4"/><rect x="3" y="7" width="18" height="4" rx="1.2" fill="#fff" stroke="var(--ink)" stroke-width="1.3"/><rect x="11" y="7" width="2" height="13" fill="var(--ink)" opacity=".85"/><path d="M12 7c-1.5-3.4-6-3.6-6-.6 0 1.6 2.6.6 6 .6zm0 0c1.5-3.4 6-3.6 6-.6 0 1.6-2.6.6-6 .6z" fill="url(#hg-straw)" stroke="var(--ink)" stroke-width="1.1" stroke-linejoin="round"/></svg>`,
  /** Телевизор — «посмотреть ролик» (реклама за награду). */
  tv: `<svg viewBox="0 0 24 24"><path d="M9 3l3 3 3-3" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="2.5" y="6" width="19" height="14" rx="3" fill="url(#hg-grape)" stroke="var(--ink)" stroke-width="1.4"/><rect x="5" y="8.5" width="14" height="9" rx="1.6" fill="#fff" stroke="var(--ink)" stroke-width="1.2"/><path d="M10.5 10.6v4.8l4-2.4z" fill="url(#hg-straw)" stroke="var(--ink)" stroke-width="1" stroke-linejoin="round"/></svg>`,
  /** Дух кричит «Бу!»: привиденьице с открытым ртом и волнами крика. */
  boo: `<svg viewBox="0 0 24 24"><path d="M4 21V11a7 7 0 0 1 14 0v10l-2.3-1.8L13.3 21 11 19.2 8.7 21 6.3 19.2z" fill="#fff" stroke="var(--ink)" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8.6" cy="10.5" r="1.3" fill="var(--ink)"/><circle cx="13.4" cy="10.5" r="1.3" fill="var(--ink)"/><ellipse cx="11" cy="14.6" rx="1.7" ry="2.1" fill="var(--ink)"/><path d="M20 7.5l2-1.5M20.5 11h2.2M20 14.5l2 1.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  /** «Искорка»: четырёхлучевая звёздочка с маленькой рядом. */
  spark: `<svg viewBox="0 0 24 24"><path d="M11 2.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" fill="url(#hg-amber)" stroke="var(--ink)" stroke-width="1.3" stroke-linejoin="round"/><path d="M19 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#fff" stroke="var(--ink)" stroke-width="1" stroke-linejoin="round"/></svg>`,
};

/** Цена/сумма с монеткой — общий вид для магазина, подарка дня и итогов. */
function coinAmount(n: number, cls = 'price-ico'): string {
  return `<span class="${cls}">${ICON.coin}</span>${n}`;
}

/* ---------------- иконки пунктов меню построек: по id, не по эмодзи из GameScene ---------------- */

const OPTION_ICON: Record<string, () => string> = {
  'build:cannon': () => img('cannon_base'),
  'build:pumpkin': () => img('pumpkin'),
  // Спрайтов поздних построек может ещё не быть — тогда SVG-заглушка.
  'build:trap': () => img('trap') || ICON.trap,
  'build:workbench': () => img('workbench') || ICON.bench,
  'build:fridge': () => img('fridge') || ICON.fridge,
  upgradeDoor: () => img('door_l1'),
  repair: () => ICON.wrench,
  upgradeSofa: () => img('sofa'),
  upgrade: () => ICON.up,
  sell: () => ICON.trash,
};

function optionIcon(o: MenuOption): string {
  if (o.id && OPTION_ICON[o.id]) return OPTION_ICON[o.id]();
  return o.icon ? stripEmoji(o.icon) : '';
}

function costPill(c: Cost): string {
  const candy = `<span class="cost-part">${img('candy_shot', 'cost-ico')}${Math.round(c.candy)}</span>`;
  const flame = c.flame ? `<span class="cost-part flame"><span class="cost-ico">${ICON.flame}</span>${Math.round(c.flame)}</span>` : '';
  return candy + flame;
}

/** Доля HP двери: ниже — «опасно» (красное, ключ мигает); ниже DOOR_HURT — «повреждена». */
const DOOR_DANGER = 0.4;
const DOOR_HURT = 0.7;

/** Картинка к совету на карточке поимки: понятна и тому, кто не читает. */
const TIP_ICON: Record<CaughtTipKind, () => string> = {
  cannon: () => img('cannon_base'),
  repair: () => ICON.wrench,
  door: () => img('door_l2'),
  strong: () => img('ghost_down_idle'),
};

/** Монеты, которые ребёнок заберёт, выйдя в меню, — прямо на кнопке: выход ничего не отнимает. */
function exitCoinsPill(coins: number): string {
  return coins > 0 ? `<span class="exit-coins">+${coins}${ICON.coin}</span>` : '';
}

/**
 * «Банка» вместо цены, когда не хватает: наполняется тем, чего не хватает (конфеты или пламя).
 * Ребёнку не надо сравнивать «69 < 320» — видно, сколько ещё копить.
 */
function jarPill(c: Cost, have: Cost): string {
  const shortCandy = have.candy + 1e-6 < c.candy;
  const frac = shortCandy ? have.candy / c.candy : c.flame ? have.flame / c.flame : 1;
  const pct = Math.round(Math.max(0.06, Math.min(1, frac)) * 100);
  const ico = shortCandy ? img('candy_shot', 'cost-ico') : `<span class="cost-ico">${ICON.flame}</span>`;
  return `<span class="jar${shortCandy ? '' : ' flame'}">${ico}<span class="jar-bar"><i style="width:${pct}%"></i></span></span>`;
}

/** Пункт заперт дверью: пилюля с замком, иконкой двери и нужным уровнем — вместо цены. */
function lockPill(doorLevel: number): string {
  return `<span class="lock-pill">${ICON.lock}${img('door_l1', 'cost-ico')}${doorLevel}</span>`;
}

/** Небольшая метка вместо цены — «+30%», «через 5 с», а для «Продать» — число конфет со значком. */
function noteVisual(note: string): string {
  const gain = /🍬\s*(\d+)/u.exec(note);
  if (gain) return `<span class="cost-part gain">+${img('candy_shot', 'cost-ico')}${gain[1]}</span>`;
  const clean = stripEmoji(note);
  return clean ? `<span class="cost-note">${clean}</span>` : '';
}

/** Интерфейс поверх canvas на обычном DOM: чёткий текст и крупные кнопки на любом экране. */
export class Hud {
  private readonly el: Record<string, HTMLElement> = {};
  private handlers: HudHandlers = { repair: () => {}, home: () => {}, pause: () => {}, boo: () => {}, spark: () => {} };
  private readonly last = new Map<string, string>();
  private bannerTimer = 0;
  private toastTimer = 0;
  private toastScreenTimer = 0;
  private menuOpts: MenuOption[] = [];
  /** Магазин перерисовывается на месте (см. showShop/renderShop) — вкладка переживает перерисовку. */
  private shopTab: ShopTab = 'heroes';
  private shopView?: ShopView;
  private shopHandlers?: ShopHandlers;
  /**
   * До этого момента (performance.now) нажатия глотаются: второй тап двойного тапа не должен
   * попадать в только что открытое окно или меню, а через него — в игру (GAME_AUDIT.md, B5).
   * GameScene сверяет с ним начало жеста на поле.
   */
  inputReadyAt = 0;
  /** Меню постройки: когда и у какой точки открыли — повторный тап ребёнка рядом не покупает. */
  private menuOpenedAt = 0;
  private menuAnchor = { x: 0, y: 0 };
  /** Последнее нажатие мышью/пальцем по интерфейсу — чтобы его повтор не ушёл в игру под окном. */
  private lastPress = { t: -Infinity, x: 0, y: 0 };
  /** Когда последний раз сменилось окно (#screen открыли, перерисовали или закрыли). */
  private screenChangedAt = -Infinity;
  /** Звук интерфейса (клик, открытие меню); подключает main.ts. */
  onSound: (key: string) => void = () => {};
  /** Переключатель звука; возвращает новое состояние «выключен». */
  onToggleMute: () => boolean = () => false;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      ${ICON_DEFS}
      <div class="hud-top">
        <div class="topbar">
          <span class="chip candy-chip" id="candy"><span class="ico">${img('candy_shot')}</span><span class="num"></span></span>
          <span class="chip flame-chip" id="flame"><span class="ico">${ICON.flame}</span><span class="num"></span></span>
          <span class="chip timer-chip" id="clock"><span class="ico">${ICON.clock}</span><span class="num"></span></span>
        </div>
        <div id="portraits"></div>
        <div id="toast"></div>
      </div>
      <div class="hud-side">
        <button class="btn-round-sm" id="pause" aria-label="Пауза" type="button">${ICON.pause}</button>
        <button class="btn-round-sm blue" id="sound" aria-label="Звук" type="button">${ICON.soundOn}</button>
      </div>
      <div id="banner"></div>
      <button class="btn-round home-btn" id="home" aria-label="К своей комнате" type="button">${ICON.home}</button>
      <button class="btn-round repair-btn" id="repair" aria-label="Чинить дверь" type="button">
        <span class="repair-ico">${ICON.wrench}</span>
        <span class="repair-cd-num"></span>
      </button>
      <button class="btn-round spirit-btn boo-btn hidden" id="boo" aria-label="Бу! Напугать призрака" type="button">
        <span class="spirit-ico">${ICON.boo}</span>
        <span class="spirit-cd-num"></span>
      </button>
      <button class="btn-round spirit-btn spark-btn hidden" id="spark" aria-label="Искорка: пушка соседа бьёт сильнее" type="button">
        <span class="spirit-ico">${ICON.spark}</span>
        <span class="spirit-cd-num"></span>
      </button>
      <div class="door-hud hidden" id="doorHud" aria-hidden="true">
        <span class="door-hud-ico">${img('door_l1')}</span>
        <span class="door-hud-bar"><i></i></span>
      </div>
      <div class="ghost-arrow hidden" id="ghostArrow" aria-hidden="true">
        <span class="ghost-arrow-tip"></span>
        <span class="ghost-arrow-ico">${img('ghost_down_idle')}</span>
      </div>
      <div id="menu"></div>
      <div id="screen"></div>
      <div id="toastScreen" class="toast-top"></div>`;
    for (const id of ['candy', 'flame', 'clock', 'pause', 'sound', 'banner', 'toast', 'home', 'repair', 'boo', 'spark', 'menu', 'screen', 'portraits', 'toastScreen', 'doorHud', 'ghostArrow']) {
      this.el[id] = root.querySelector<HTMLElement>(`#${id}`)!;
    }
    // Первым: пока окно/меню только появились, клик до кнопок не доходит (и не щёлкает звуком).
    // Плюс повтор тапа ребёнка (до 1 с, рядом) по кнопке, которой ещё не было при первом тапе:
    // иначе двойной тап «Выйти в меню» попадал в «Кошмар» в открывшемся меню.
    root.addEventListener(
      'click',
      (e) => {
        const now = performance.now();
        const pt = { x: e.clientX, y: e.clientY };
        const echo = e.detail > 0 && isEchoAfterScreenChange(now, this.lastPress, this.screenChangedAt, pt);
        if (e.detail > 0) this.lastPress = { t: now, ...pt };
        if (now < this.inputReadyAt || echo) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true,
    );
    this.el.repair.addEventListener('click', () => this.handlers.repair());
    this.el.home.addEventListener('click', () => this.handlers.home());
    // Серая «Бу!» (призрак далеко) не реагирует — без ругательного тоста.
    this.el.boo.addEventListener('click', () => {
      if (!this.el.boo.classList.contains('off')) this.handlers.boo();
    });
    this.el.spark.addEventListener('click', () => this.handlers.spark());
    this.el.pause.addEventListener('click', () => this.handlers.pause());
    this.el.sound.addEventListener('click', () => this.setMuteIcon(this.onToggleMute()));
    // Щелчок на любой кнопке интерфейса.
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.onSound('click');
    }, true);
  }

  /**
   * Касание поля в момент t в точке (x, y) — повтор последнего нажатия по интерфейсу
   * (двойной тап по «Ещё раз» / «Играть духом»), а не новое действие в игре.
   */
  isEchoOfPress(t: number, x: number, y: number): boolean {
    return isHoldover(t, this.lastPress.t, this.lastPress, { x, y });
  }

  /** Глотать нажатия ms миллисекунд: экран или меню только что сменились. */
  armInput(ms = INPUT_GUARD_MS): void {
    this.inputReadyAt = Math.max(this.inputReadyAt, performance.now() + ms);
  }

  setMuteIcon(muted: boolean): void {
    this.el.sound.innerHTML = muted ? ICON.soundOff : ICON.soundOn;
  }

  bind(h: HudHandlers): void {
    this.handlers = h;
  }

  setInGame(v: boolean): void {
    this.root.classList.toggle('in-game', v);
    if (!v) this.hideMenu();
  }

  private set(id: string, value: string, sel = '.num'): void {
    const key = sel === '.num' ? id : `${id}${sel}`;
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    const target = this.el[id].querySelector<HTMLElement>(sel) ?? this.el[id];
    target.textContent = value;
  }

  private toggle(id: string, cls: string, on: boolean): void {
    const k = `${id}.${cls}`;
    const v = on ? '1' : '0';
    if (this.last.get(k) === v) return;
    this.last.set(k, v);
    this.el[id].classList.toggle(cls, on);
  }

  /** Для какого матча построены портреты. */
  private portraitsFor: Match | null = null;

  private buildPortraits(m: Match): void {
    const box = this.el.portraits;
    box.innerHTML = '';
    for (const c of m.chars) {
      const p = document.createElement('div');
      p.className = 'portrait';
      p.id = `p-${c.id}`;
      p.style.setProperty('--col', `#${c.color.toString(16).padStart(6, '0')}`);
      const face = SPRITES[`char${c.look}`];
      if (face) {
        p.classList.add('face');
        p.style.backgroundImage = `url(${face})`;
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'portrait-fallback';
        fallback.textContent = c.name[0];
        p.appendChild(fallback);
      }
      p.title = c.name;
      if (c.isPlayer) p.classList.add('me');
      const tagMe = document.createElement('span');
      tagMe.className = 'p-tag p-tag-me';
      tagMe.textContent = 'ТЫ';
      const tagTarget = document.createElement('span');
      tagTarget.className = 'p-tag p-tag-target';
      tagTarget.textContent = 'ЦЕЛЬ';
      p.append(tagMe, tagTarget);
      box.appendChild(p);
    }
  }

  update(m: Match): void {
    // Портреты — заново на каждый матч: герой игрока (и значит соседи) меняется в магазине.
    // Раньше строились один раз за запуск, и после смены героя оставалась старая иконка.
    if (this.portraitsFor !== m) {
      this.portraitsFor = m;
      this.buildPortraits(m);
    }
    const inMatch = m.phase !== 'pick';
    this.toggle('portraits', 'hidden', !inMatch);
    if (inMatch) {
      const g = m.ghost;
      const targetRoom = g.state === 'attacking' || g.state === 'entering' ? g.targetRoom : -1;
      for (const c of m.chars) {
        const el = document.getElementById(`p-${c.id}`);
        if (!el) continue;
        const targeted = c.roomId === targetRoom;
        const k = `portrait-${c.id}`;
        const state = c.caught ? 'gone' : targeted ? 'target' : 'ok';
        if (this.last.get(k) !== state) {
          this.last.set(k, state);
          el.classList.toggle('gone', c.caught);
          el.classList.toggle('target', targeted);
        }
      }
    }

    const room = m.playerRoom;
    this.set('candy', String(room ? Math.floor(room.candy) : 0));
    this.toggle('flame', 'hidden', !m.opts.flameUnlocked);
    this.set('flame', String(room ? Math.floor(room.flame) : 0));
    // Пламя открывается со 2-го матча — до этого счётчик не показываем (всегда 0, только путает).
    this.toggle('flame', 'hidden', !m.opts.flameUnlocked);
    // Коротко, чтобы все три чипа были одной ширины: «до полуночи» и так объявляет баннер.
    const left = Math.ceil(Math.max(0, m.phaseLeft));
    if (m.phase === 'pick' && m.player.roomId !== null) this.set('clock', '…');
    else if (m.phase === 'pick' || m.phase === 'prep') this.set('clock', `0:${String(left).padStart(2, '0')}`);
    else this.set('clock', m.clock);
    this.toggle('clock', 'countdown', m.phase === 'pick' || m.phase === 'prep');

    const active = !!room && (m.phase === 'prep' || m.phase === 'night') && !m.player.caught;
    this.toggle('repair', 'hidden', !active);
    // На выборе комнаты «домой» = «весь этаж ↔ ко мне».
    this.toggle('home', 'hidden', !room && m.phase !== 'pick');
    const d = room?.door;
    const doorFrac = d ? d.hp / d.maxHp : 1;
    // Состояния ключа (Child UX): не нужен (дверь целая) → можно → срочно (<40 %) → перезарядка.
    // «Срочно» остаётся видно и на перезарядке — красное кольцо не гаснет (GAME_AUDIT.md, Top-6).
    const danger = !!d && m.phase === 'night' && !d.broken && doorFrac < DOOR_DANGER;
    const busy = m.player.task?.kind === 'repair';
    this.toggle('repair', 'alert', danger);
    this.toggle('repair', 'busy', busy);
    this.toggle('repair', 'idle', !!d && !busy && doorFrac >= 0.999);
    // Перезарядка ключа: серая кнопка + кольцо, сколько секунд до готовности.
    const cd = d ? Math.ceil(d.repairCd) : 0;
    this.toggle('repair', 'cd', cd > 0);
    this.set('repair', cd > 0 ? String(cd) : '', '.repair-cd-num');
    // С «Быстрым ключом» перезарядка вдвое короче — кольцо считаем от неё, а не от обычной (B13).
    const cdTotal = B.repair.cooldown * (m.opts.boosters?.repairMul ?? 1);
    const frac = d && d.repairCd > 0 ? Math.min(1, d.repairCd / cdTotal) : 0;
    const cdKey = frac.toFixed(2);
    if (this.last.get('repair-ring') !== cdKey) {
      this.last.set('repair-ring', cdKey);
      this.el.repair.style.setProperty('--cd', cdKey);
    }

    // Крупная полоска своей двери у ключа: видна, пока дверь побита или её ломают. Без чисел — цвет и длина.
    const g = m.ghost;
    const sieged = !!room && g.targetRoom === room.id && (g.state === 'attacking' || g.state === 'entering');
    const showDoor = active && m.phase === 'night' && !!d && !d.broken && (sieged || doorFrac < 0.999);
    this.toggle('doorHud', 'hidden', !showDoor);
    if (showDoor) {
      const state = doorFrac < DOOR_DANGER ? 'danger' : doorFrac < DOOR_HURT ? 'hurt' : 'ok';
      this.toggle('doorHud', 'hurt', state === 'hurt');
      this.toggle('doorHud', 'danger', state === 'danger');
      this.toggle('doorHud', 'sieged', sieged);
      const w = `${Math.max(4, Math.round(doorFrac * 100))}%`;
      if (this.last.get('door-w') !== w) {
        this.last.set('door-w', w);
        this.el.doorHud.style.setProperty('--hp', w);
      }
    }

    // Дух: две кнопки умений вместо ключа — откат цифрой и кольцом, как у ключа.
    const p = m.player;
    const spirit = p.spirit && m.phase === 'night' && !m.result;
    this.toggle('boo', 'hidden', !spirit);
    this.toggle('spark', 'hidden', !spirit);
    if (spirit) {
      this.abilityCd('boo', p.booCd, B.spirit.booCd);
      this.abilityCd('spark', p.sparkCd, B.spirit.sparkCd);
      // Серые, пока не до кого дотянуться: призрак далеко / рядом нет пушки соседа.
      this.toggle('boo', 'off', !m.booInRange(p));
      this.toggle('spark', 'off', m.sparkCannons(p).length === 0);
    }
  }

  /** Откат умения духа на кнопке: класс cd, число секунд и кольцо --cd. */
  private abilityCd(id: 'boo' | 'spark', left: number, total: number): void {
    const cd = Math.ceil(left);
    this.toggle(id, 'cd', cd > 0);
    this.set(id, cd > 0 ? String(cd) : '', '.spirit-cd-num');
    const frac = left > 0 ? Math.min(1, left / total).toFixed(2) : '0.00';
    if (this.last.get(`${id}-ring`) !== frac) {
      this.last.set(`${id}-ring`, frac);
      this.el[id].style.setProperty('--cd', frac);
    }
  }

  banner(text: string, ms = 2600): void {
    const b = this.el.banner;
    b.textContent = stripEmoji(text);
    b.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), ms);
  }

  toast(text: string): void {
    const t = this.el.toast;
    t.textContent = stripEmoji(text);
    t.classList.remove('info');
    t.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 1600);
  }

  /** Спокойное сообщение (не ошибка): кремовое, без красного — например, «Дверь целая» на ключе. */
  toastInfo(text: string): void {
    this.toast(text);
    this.el.toast.classList.add('info');
    window.setTimeout(() => this.el.toast.classList.remove('info'), 1700);
  }

  /**
   * Стрелка к призраку у края экрана, пока он идёт к моей двери за кадром.
   * pos — точка у края (экранные px) и угол на призрака; null — спрятать.
   */
  setGhostArrow(pos: { x: number; y: number; angle: number } | null): void {
    const el = this.el.ghostArrow;
    this.toggle('ghostArrow', 'hidden', !pos);
    if (!pos) return;
    el.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
    el.style.setProperty('--ang', `${pos.angle.toFixed(2)}rad`);
  }

  /** То же самое, но живёт вне .hud-top — видно поверх магазина/подарка, где матча ещё/уже нет. */
  toastScreen(text: string): void {
    const t = this.el.toastScreen;
    t.textContent = stripEmoji(text);
    t.classList.add('show');
    window.clearTimeout(this.toastScreenTimer);
    this.toastScreenTimer = window.setTimeout(() => t.classList.remove('show'), 1600);
  }

  showMenu(x: number, y: number, title: string, options: MenuOption[]): void {
    const menu = this.el.menu;
    menu.innerHTML = `
      <div class="menu-head">
        <h3 class="menu-title"></h3>
        <button type="button" class="menu-close" aria-label="Закрыть">${ICON.close}</button>
      </div>
      <div class="menu-body"></div>`;
    menu.querySelector('.menu-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideMenu();
    });
    const body = menu.querySelector('.menu-body')!;
    this.menuOpts = options;
    options.forEach((_, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'opt-wrap';
      wrap.innerHTML = `
        <button class="opt" type="button">
          <span class="ico"></span>
          <span class="opt-main"><span class="lbl"></span><span class="opt-desc"></span></span>
          <span class="cost"></span>
          <span class="opt-lock">${ICON.lock}</span>
        </button>
        <div class="opt-reason"></div>`;
      const b = wrap.querySelector('button')!;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        // Тот же тап, что открыл меню (ребёнок жмёт дважды), — не покупка.
        if (e.detail > 0 && isHoldover(performance.now(), this.menuOpenedAt, this.menuAnchor, { x: e.clientX, y: e.clientY })) return;
        const o = this.menuOpts[i];
        if (!o) return;
        if (o.poor) {
          // Не хватает: кнопка вздрагивает, «банка» рядом показывает, сколько копить. Без красной ошибки.
          wrap.classList.remove('nope');
          void wrap.offsetWidth;
          wrap.classList.add('nope');
          this.onSound('click');
          o.onPoor?.();
          return;
        }
        if (o.confirm) {
          this.askConfirm(wrap, o);
          return;
        }
        this.hideMenu();
        o.onPick();
      });
      body.appendChild(wrap);
    });
    this.refreshMenu(title, options);
    menu.style.display = 'block';
    this.menuOpenedAt = performance.now();
    this.menuAnchor = { x, y };
    this.armInput();
    this.onSound('popup');
    this.placeMenu(x, y);
    // Шрифт/картинки могли догрузиться и поменять размер — поправим ещё раз после раскладки.
    requestAnimationFrame(() => this.placeMenu(x, y));
  }

  /**
   * Ставит меню у точки нажатия, но целиком в экране (с учётом толстой обводки-тени).
   * На узком экране — по центру по ширине: у края пальцем не попасть и меню обрезается;
   * по высоте тогда — над пальцем или под ним, а не на нём (иначе второй тап покупает пункт).
   */
  private placeMenu(x: number, y: number): void {
    const menu = this.el.menu;
    if (menu.style.display !== 'block') return;
    const edge = 18; // обводка + тень меню выходят за его рамку
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const narrow = vw <= 600;
    const left = narrow ? (vw - w) / 2 : Math.min(vw - w - edge, x + 16);
    const top = narrow ? menuTopAwayFromFinger(y, h, vh, edge) : Math.max(edge, Math.min(vh - h - edge, y - h / 2));
    menu.style.left = `${Math.max(edge, left)}px`;
    menu.style.top = `${top}px`;
  }

  /**
   * Опасный пункт (продать): первый тап меняет подпись на вопрос и показывает «Да» справа — не под пальцем.
   * «Да» срабатывает не раньше HOLDOVER_MS: второй тап двойного тапа не подтверждает. Через 3 с — отмена.
   */
  private askConfirm(wrap: HTMLElement, o: MenuOption): void {
    if (wrap.classList.contains('confirming')) return;
    wrap.classList.add('confirming');
    const lbl = wrap.querySelector('.lbl');
    if (lbl) lbl.textContent = o.confirm ?? '';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'opt-yes';
    yes.textContent = 'Да';
    const armedAt = performance.now();
    yes.addEventListener('click', (e) => {
      e.stopPropagation();
      if (performance.now() - armedAt < HOLDOVER_MS) return;
      this.hideMenu();
      o.onPick();
    });
    wrap.appendChild(yes);
    window.setTimeout(() => {
      wrap.classList.remove('confirming');
      yes.remove();
      if (lbl) lbl.textContent = o.label;
    }, 3000);
  }

  /**
   * Обновляет открытое меню на месте: цены, «не хватает», доступность.
   * Кнопки остаются теми же, так что меню не прыгает и нажатие не теряется.
   */
  refreshMenu(title: string, options: MenuOption[]): void {
    const menu = this.el.menu;
    const wraps = menu.querySelectorAll<HTMLElement>('.opt-wrap');
    if (wraps.length !== options.length) return;
    this.menuOpts = options;
    const head = menu.querySelector('.menu-title')!;
    if (head.textContent !== title) head.textContent = title;
    options.forEach((o, i) => {
      const wrap = wraps[i];
      const b = wrap.querySelector<HTMLButtonElement>('button.opt')!;
      if (o.id && b.dataset.opt !== o.id) b.dataset.opt = o.id;
      const cls = `opt${o.poor ? ' poor' : ''}${o.secondary ? ' secondary' : ''}`;
      if (b.className !== cls) b.className = cls;
      // Заперт дверью — кнопка остаётся активной (нажатие подсвечивает дверь), только disabled НЕ ставим.
      if (b.disabled !== !!o.disabled) b.disabled = !!o.disabled;
      wrap.classList.toggle('is-disabled', !!o.disabled);
      wrap.classList.toggle('is-locked', !!o.lockDoor);
      wrap.classList.toggle('is-new', !!o.isNew);

      const setHtml = (sel: string, html: string, root: ParentNode = b) => {
        const el = root.querySelector(sel);
        if (el && el.innerHTML !== html) el.innerHTML = html;
      };
      const setText = (sel: string, text: string, root: ParentNode = b) => {
        const el = root.querySelector(sel);
        if (el && el.textContent !== text) el.textContent = text;
      };

      setHtml('.ico', optionIcon(o));
      if (!wrap.classList.contains('confirming')) setText('.lbl', o.label);
      setText('.opt-desc', o.desc ?? '');

      const showReason = !!o.disabled && !!o.note;
      const costHtml = o.lockDoor
        ? lockPill(o.lockDoor)
        : o.cost && o.poor && o.have
          ? jarPill(o.cost, o.have)
          : o.cost
            ? costPill(o.cost)
            : !showReason && o.note
              ? noteVisual(o.note)
              : '';
      setHtml('.cost', costHtml);

      const reasonText = showReason ? stripEmoji(o.note!) : '';
      setText('.opt-reason', reasonText, wrap);
      wrap.querySelector('.opt-reason')!.classList.toggle('show', showReason);

      const aria = o.cost ? `${o.label}, стоимость ${costText(o.cost)}` : o.label;
      if (b.getAttribute('aria-label') !== aria) b.setAttribute('aria-label', aria);
    });
  }

  get menuOpen(): boolean {
    return this.el.menu.style.display === 'block';
  }

  hideMenu(): void {
    this.el.menu.style.display = 'none';
  }

  /** Конец обучения: одна большая кнопка — сразу в настоящую игру. Подарок — если начислен. */
  showTutorialDone(onPlay: () => void, gift = 0): void {
    this.setInGame(false);
    this.clearMessages();
    this.showScreen(`
      <div class="card done-card">
        ${SPRITES.mascot_cheer ? `<img class="done-mascot" src="${SPRITES.mascot_cheer}" alt="">` : `<span class="done-mascot-fallback">${ICON.trophy}</span>`}
        <h1 class="stroke-title small">Призрак побеждён!</h1>
        <p>Теперь ты умеешь защищаться. Вперёд!</p>
        ${gift > 0 ? `
          <div class="tut-gift-pill">Подарок: +${gift}<span class="tut-gift-ico">${ICON.coin}</span></div>
          <p class="tut-gift-hint">Загляни в магазин!</p>` : ''}
        <button class="btn-big mint wide" id="play" type="button">${ICON.play}Играть</button>
      </div>`);
    this.el.screen.querySelector('#play')!.addEventListener('click', onPlay);
  }

  showStart(p: Progress, onPlay: (d: Difficulty) => void, onTutorial?: () => void, meta?: MenuMeta): void {
    this.setInGame(false);
    const diffIcon: Record<Difficulty, string> = { easy: ICON.star, hard: ICON.bolt, nightmare: ICON.skull };
    const diffBtn = (d: Difficulty) => `
      <button class="diff-btn diff-${d}" data-d="${d}" type="button">
        <span class="win-badge">${ICON.trophy}<b>${p.wins[d] ?? 0}</b></span>
        <span class="diff-ico">${diffIcon[d]}</span>
        <span class="diff-name">${DIFF_LABEL[d]}</span>
        <span class="diff-desc">${DIFF_DESC[d]}</span>
      </button>`;
    this.showScreen(`
      <div class="menu-frame">
        <div class="menu-bg"><div class="menu-stars"></div><div class="menu-moon"></div><div class="menu-floor"></div></div>
        ${meta ? `
        <div class="meta-topbar">
          <span class="chip coin-chip" id="menuCoins"><span class="ico">${ICON.coin}</span><span class="num">${meta.coins}</span></span>
        </div>
        <div class="meta-side">
          <button class="meta-btn" id="metaShop" type="button"><span class="btn-round-sm gold">${ICON.shop}</span><span class="meta-label">Магазин</span></button>
          <button class="meta-btn" id="metaGift" type="button"><span class="btn-round-sm mint">${ICON.gift}${meta.giftReady ? '<span class="ping-dot"></span>' : ''}</span><span class="meta-label">Подарок</span></button>
        </div>` : ''}
        <div class="menu-content">
          <div class="menu-hero">
            <span class="menu-door">${img('door_l1')}</span>
            <div class="menu-title">
              <span class="menu-kicker">Сегодня</span>
              <h1>ПОЛНОЧЬ<br>У ДВЕРИ</h1>
              <span class="menu-pill">Победи призрака!</span>
            </div>
            <span class="menu-ghost">${img('ghost_down_idle')}</span>
          </div>
          <div class="menu-diffs">
            ${diffBtn('easy')}
            ${diffBtn('hard')}
            ${diffBtn('nightmare')}
          </div>
          ${onTutorial ? `<button class="menu-tut" id="tut" type="button">${ICON.book}Обучение</button>` : ''}
        </div>
        <div class="menu-mascot-wrap">
          <span class="menu-mascot">${img('mascot_wave')}</span>
          <div class="menu-bubble">Погнали спасать дом!<span class="tail"></span></div>
        </div>
      </div>`);
    this.el.screen.querySelectorAll<HTMLButtonElement>('button[data-d]').forEach((b) =>
      b.addEventListener('click', () => onPlay(b.dataset.d as Difficulty)),
    );
    if (onTutorial) this.el.screen.querySelector('#tut')!.addEventListener('click', onTutorial);
    if (meta) {
      this.el.screen.querySelector('#metaShop')!.addEventListener('click', meta.onShop);
      this.el.screen.querySelector('#metaGift')!.addEventListener('click', meta.onGift);
    }
  }

  /** Магазин: герои / скины / усилители. Активная вкладка хранится в Hud и переживает перерисовку. */
  showShop(view: ShopView, h: ShopHandlers): void {
    this.shopView = view;
    this.shopHandlers = h;
    this.renderShop();
  }

  private renderShop(): void {
    const view = this.shopView;
    const h = this.shopHandlers;
    if (!view || !h) return;
    const tab = this.shopTab;
    const tabBtn = (id: ShopTab, label: string) => `<button class="shop-tab${tab === id ? ' active' : ''}" data-tab="${id}" type="button">${label}</button>`;
    const body = tab === 'heroes' ? this.heroesGrid(view) : tab === 'skins' ? this.skinsGrid(view) : this.boostersGrid(view);
    this.showScreen(`
      <div class="card shop-card">
        <div class="shop-head">
          <div class="shop-head-row">
            <h1 class="shop-title">Магазин</h1>
            <span class="chip coin-chip" id="shopCoins"><span class="ico">${ICON.coin}</span><span class="num">${view.coins}</span></span>
          </div>
          <button class="menu-close shop-close" aria-label="Закрыть" type="button">${ICON.close}</button>
        </div>
        <div class="shop-tabs">
          ${tabBtn('heroes', 'Герои')}
          ${tabBtn('skins', 'Скины')}
          ${tabBtn('boosters', 'Усилители')}
        </div>
        <div class="shop-body">${body}</div>
      </div>`);
    const root = this.el.screen;
    root.querySelector('.shop-close')!.addEventListener('click', () => h.close());
    root.querySelectorAll<HTMLButtonElement>('.shop-tab').forEach((b) =>
      b.addEventListener('click', () => {
        this.shopTab = b.dataset.tab as ShopTab;
        this.renderShop();
      }),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-buy-hero]').forEach((b) =>
      b.addEventListener('click', () => h.buyHero(Number(b.dataset.buyHero))),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-select-hero]').forEach((b) =>
      b.addEventListener('click', () => h.selectHero(Number(b.dataset.selectHero))),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-buy-skin]').forEach((b) => {
      const [slot, id] = b.dataset.buySkin!.split('|');
      b.addEventListener('click', () => h.buySkin(slot as SkinSlot, id));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-select-skin]').forEach((b) => {
      const [slot, id] = b.dataset.selectSkin!.split('|');
      b.addEventListener('click', () => h.selectSkin(slot as SkinSlot, id));
    });
    root.querySelectorAll<HTMLButtonElement>('[data-buy-booster]').forEach((b) =>
      b.addEventListener('click', () => h.buyBooster(b.dataset.buyBooster as BoosterId)),
    );
  }

  private heroesGrid(view: ShopView): string {
    const cards = view.heroes
      .map((hero) => {
        const key = SPRITES[`char${hero.look}_idle`] ? `char${hero.look}_idle` : `char${hero.look}`;
        const action = hero.selected
          ? `<button class="shop-action selected" type="button" disabled>${ICON.check}<span>Выбран</span></button>`
          : hero.owned
            ? `<button class="shop-action" data-select-hero="${hero.look}" type="button">Выбрать</button>`
            : `<button class="shop-action buy${view.coins < hero.price ? ' poor' : ''}" data-buy-hero="${hero.look}" type="button">${coinAmount(hero.price)}</button>`;
        return `<div class="shop-card-item">${img(key, 'shop-portrait')}<div class="item-name">${hero.name}</div>${action}</div>`;
      })
      .join('');
    return `<div class="shop-grid">${cards}</div>`;
  }

  private skinsGrid(view: ShopView): string {
    const groupLabel: Record<SkinSlot, string> = { door: 'Дверь', cannon: 'Пушка' };
    return view.skins
      .map((g) => {
        const items = g.items
          .map((it) => {
            // Превью скина — его 1-й уровень; картинки ещё нет — обычная.
            const sk = (k: string, classic: string) => (it.id !== 'classic' && SPRITES[k] ? k : classic);
            const preview =
              g.slot === 'door'
                ? img(sk(`door_${it.id}_l1`, 'door_l1'), 'shop-preview')
                : `<div class="cannon-stack">${img(sk(`cannon_base_${it.id}_l1`, 'cannon_base'))}${img(sk(`cannon_barrel_${it.id}_l1`, 'cannon_barrel'))}</div>`;
            if (!it.ready) {
              return `<div class="shop-card-item locked"><span class="soon-ribbon">Скоро</span><span class="lock-badge">${ICON.lock}</span>${preview}<div class="item-name">${it.name}</div></div>`;
            }
            const action = it.selected
              ? `<button class="shop-action selected" type="button" disabled>${ICON.check}<span>Выбран</span></button>`
              : it.owned
                ? `<button class="shop-action" data-select-skin="${g.slot}|${it.id}" type="button">Выбрать</button>`
                : `<button class="shop-action buy${view.coins < it.price ? ' poor' : ''}" data-buy-skin="${g.slot}|${it.id}" type="button">${coinAmount(it.price)}</button>`;
            return `<div class="shop-card-item">${preview}<div class="item-name">${it.name}</div>${action}</div>`;
          })
          .join('');
        return `<div class="shop-group"><h2 class="shop-group-title">${groupLabel[g.slot]}</h2><div class="shop-grid">${items}</div></div>`;
      })
      .join('');
  }

  private boostersGrid(view: ShopView): string {
    const icons: Record<BoosterId, string> = { candy: img('candy_shot'), door: img('door_l2'), wrench: ICON.wrench };
    const cards = view.boosters
      .map((b) => {
        const maxed = b.count >= BOOSTER_MAX;
        const action = maxed
          ? `<button class="shop-action selected" type="button" disabled>Максимум</button>`
          : `<button class="shop-action buy${view.coins < b.price ? ' poor' : ''}" data-buy-booster="${b.id}" type="button">${coinAmount(b.price)}</button>`;
        return `<div class="shop-card-item booster-item">
          <span class="ico-circle">${icons[b.id]}</span>
          <div class="item-name">${b.title}</div>
          <div class="item-desc">${b.desc}</div>
          <div class="booster-count">×${b.count} / ${BOOSTER_MAX}</div>
          ${action}
          <div class="booster-note">сработает в следующем матче</div>
        </div>`;
      })
      .join('');
    return `<div class="shop-grid boosters">${cards}</div>`;
  }

  /** Подарок дня: календарь на 7 дней, «Забрать» с всплывающей анимацией и переходом в «Отлично!». */
  showDaily(view: { days: number[]; step: number; available: boolean }, onClaim: () => number, onClose: () => void): void {
    this.clearMessages();
    const tiles = view.days
      .map((amount, i) => {
        const claimed = i < view.step;
        const today = i === view.step && view.available;
        const cls = ['daily-tile', i === 6 && 'big', claimed && 'claimed', today && 'today', !claimed && !today && 'future'].filter(Boolean).join(' ');
        const inner = claimed ? `<span class="daily-check">${ICON.check}</span>` : `<span class="daily-coin">${ICON.coin}</span><span class="daily-amt">${amount}</span>`;
        return `<div class="${cls}" data-day="${i}"><span class="daily-day">${i + 1}</span>${inner}</div>`;
      })
      .join('');
    this.showScreen(`
      <div class="card daily-card">
        ${img('mascot_cheer', 'daily-mascot')}
        <h1 class="stroke-title small">Подарок дня</h1>
        <div class="daily-grid">${tiles}</div>
        ${
          view.available
            ? `<button class="btn-big mint wide" id="dailyClaim" type="button">${ICON.gift}Забрать</button>`
            : `<p>Приходи завтра!</p><button class="btn-big cream wide" id="dailyClaim" type="button">${ICON.check}Ок</button>`
        }
      </div>`);
    const btn = this.el.screen.querySelector<HTMLButtonElement>('#dailyClaim')!;
    if (view.available) {
      btn.addEventListener(
        'click',
        () => {
          const coins = onClaim();
          const tile = this.el.screen.querySelector<HTMLElement>(`.daily-tile[data-day="${view.step}"]`);
          this.popCoins(tile ?? btn, coins);
          // Та же кнопка станет «Отлично!» → меню: быстрые тапы не должны проскочить в меню и дальше.
          this.armInput(HOLDOVER_MS);
          btn.innerHTML = `${ICON.check}Отлично!`;
          btn.onclick = () => onClose();
        },
        { once: true },
      );
    } else {
      btn.addEventListener('click', onClose);
    }
  }

  /** Короткая всплывающая «+N» над плиткой/кнопкой при получении монет. */
  private popCoins(anchor: HTMLElement, amount: number): void {
    if (amount <= 0) return;
    const pop = document.createElement('span');
    pop.className = 'coin-pop';
    pop.innerHTML = `${ICON.coin}+${amount}`;
    anchor.appendChild(pop);
    window.setTimeout(() => pop.remove(), 900);
  }

  /** Плавный счёт от 0 до target; при «меньше анимации» показывает число сразу. */
  private animateCount(el: HTMLElement, target: number): void {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || target <= 0) {
      el.textContent = String(target);
      return;
    }
    const dur = 800;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) * (1 - t);
      el.textContent = String(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  showResult(m: Match, flameJustUnlocked: boolean, onAgain: () => void, onMenu: () => void, reward?: Reward): void {
    this.setInGame(false);
    this.clearMessages();
    const win = m.result === 'win';
    const title = win ? (m.teamWin ? 'Командная победа!' : 'Призрак побеждён!') : 'Призрак всех пощекотал!';
    // Проигрыш — честно показать, сколько у призрака осталось: «почти победили».
    const ghostPct = m.ghost.maxHp > 0 ? Math.max(1, Math.round((m.ghost.hp / m.ghost.maxHp) * 100)) : 100;
    // Все жильцы вместе с игроком: «5/5» при своей поимке выглядело как ошибка (считались только соседи).
    const survived = m.survivors;
    const total = m.chars.length;
    const mascotKey = win ? 'mascot_cheer' : 'mascot_oh';
    this.showScreen(`
      <div class="card result-card halftone">
        ${img(mascotKey, 'result-mascot')}
        <h1 class="stroke-title">${title}</h1>
        ${flameJustUnlocked ? `<div class="unlock-pill">${img('pumpkin', 'unlock-ico')}Открыты тыквы и пламя ${ICON.flame}</div>` : ''}
        <div class="stat-row">
          <div class="stat"><span class="stat-ico">${ICON.clock}</span><span class="stat-n">${m.clock}</span><span class="stat-k">время</span></div>
          <div class="stat"><span class="stat-ico">${m.player.caught ? ICON.cross : ICON.check}</span><span class="stat-n">${survived}/${total}</span><span class="stat-k">выжило</span></div>
          <div class="stat"><span class="stat-ico">${img('ghost_down_idle')}</span><span class="stat-n">ур. ${m.ghost.level}</span><span class="stat-k">призрак</span></div>
          ${win ? '' : `<div class="stat"><span class="stat-ico">${img('ghost_down_idle')}</span><span class="stat-n">${ghostPct}%</span><span class="stat-k">HP призрака</span></div>`}
        </div>
        ${
          reward
            ? `<div class="reward-block">
                <div class="reward-total"><span class="reward-ico">${ICON.coin}</span><span class="reward-plus">+</span><span class="reward-num" id="rewardNum">0</span></div>
                <div class="reward-parts">${reward.parts.map((p) => `<span class="reward-chip">${p.label} +${p.coins}</span>`).join('')}</div>
              </div>`
            : ''
        }
        <div class="diffs">
          <button class="btn-big straw" id="again" type="button">${ICON.replay}Ещё раз</button>
          <button class="btn-big cream" id="tomenu" type="button">${ICON.menuList}Меню</button>
        </div>
      </div>`);
    this.el.screen.querySelector('#again')!.addEventListener('click', onAgain);
    this.el.screen.querySelector('#tomenu')!.addEventListener('click', onMenu);
    if (reward) this.animateCount(this.el.screen.querySelector<HTMLElement>('#rewardNum')!, reward.coins);
  }

  /** Игрока поймали: игра стоит, пока не выберет — играть духом или выйти в меню (без монет, без рекламы). */
  showCaught(onSpirit: () => void, onMenu: () => void, coins = 0, tip?: CaughtTip): void {
    this.clearMessages();
    this.showScreen(`
      <div class="card caught-card halftone">
        ${img('mascot_oh', 'result-mascot')}
        <h1 class="stroke-title small">Тебя поймали!</h1>
        ${tip ? `<div class="caught-tip tip-${tip.kind}"><span class="caught-tip-ico">${TIP_ICON[tip.kind]()}</span><span class="caught-tip-text">${tip.text}</span></div>` : ''}
        <div class="diffs">
          <button class="btn-big mint" id="spirit" type="button">${ICON.boo}Играть духом</button>
          <button class="btn-big cream" id="tomenu" type="button">${ICON.menuList}Выйти в меню${exitCoinsPill(coins)}</button>
        </div>
      </div>`);
    this.el.screen.querySelector('#spirit')!.addEventListener('click', onSpirit);
    this.el.screen.querySelector('#tomenu')!.addEventListener('click', onMenu);
  }

  showPause(onResume: () => void, onMenu: () => void, onSkipTutorial?: () => void, coins = 0): void {
    this.showScreen(`
      <div class="card pause-card">
        <h1 class="stroke-title small">Пауза</h1>
        <div class="diffs">
          <button class="btn-big mint" id="resume" type="button">${ICON.play}Играть</button>
          <button class="btn-big cream" id="tomenu" type="button">${ICON.menuList}Выйти в меню${exitCoinsPill(coins)}</button>
        </div>
        ${onSkipTutorial ? `<button class="link-btn" id="skiptut" type="button">${ICON.skip}Пропустить обучение</button>` : ''}
      </div>`);
    this.el.screen.querySelector('#resume')!.addEventListener('click', onResume);
    this.el.screen.querySelector('#tomenu')!.addEventListener('click', onMenu);
    if (onSkipTutorial) this.el.screen.querySelector('#skiptut')!.addEventListener('click', onSkipTutorial);
  }

  /** Убрать баннер и сообщение: на экране итогов они висели поверх карточки. */
  private clearMessages(): void {
    this.el.banner.classList.remove('show');
    this.el.toast.classList.remove('show');
  }

  private showScreen(html: string): void {
    this.hideMenu();
    this.armInput();
    this.screenChangedAt = performance.now();
    this.el.screen.innerHTML = html;
    this.el.screen.classList.add('show');
    // Игровой HUD прячется под окном: иначе фантики и портреты лежат поверх карточки (GAME_AUDIT.md, B15).
    this.root.classList.add('screen-open');
  }

  hideScreen(): void {
    // Окно закрылось — второй тап не должен уйти в игру под ним (выбрать комнату, увести духа).
    if (this.el.screen.classList.contains('show')) {
      this.armInput();
      this.screenChangedAt = performance.now();
    }
    this.el.screen.classList.remove('show');
    this.el.screen.innerHTML = '';
    this.root.classList.remove('screen-open');
  }
}
