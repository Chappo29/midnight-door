import Phaser from 'phaser';
import './fonts.css';
import './style.css';
import {
  BOOSTERS,
  DAILY,
  HEROES,
  SKINS,
  buyBooster,
  buyHero,
  buySkin,
  claimDaily,
  dailyAvailable,
  dayKey,
  matchReward,
  selectHero,
  planBoosters,
  spendBoosters,
  exitReward,
  type BoosterId,
} from './meta/economy';
import { HERO_NAMES } from './sim/match';
import {
  UNLOCK_KINDS,
  badgeKinds,
  isUnlockKind,
  markBadgeSeen,
  previewButtons,
  matchUnlocks,
  nextPreview,
  recordMatchOutcome,
  type UnlockKind,
} from './meta/unlocks';
import { track } from './platform/analytics';
import { bootSave, signInAndSync, type ProgressStore } from './platform/save';
import { finishTutorial, resolveTutorialOnBoot, type Progress } from './platform/storage';
import { initYandexSdk } from './platform/yandex';
import { Match } from './sim/match';
import type { Difficulty } from './sim/types';
import { Hud } from './ui/hud';
import { GameScene, type GameData } from './view/GameScene';
import { prefetchSkin, preloadSprites } from './view/sprites';
import { SFX_GROUPS, Sfx, loadMusic, preloadSfx } from './audio/sfx';

document.addEventListener('contextmenu', (e) => e.preventDefault());

const hud = new Hud(document.getElementById('ui')!);
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#140f22',
  // Если вкладка грузится в фоне или iframe Яндекса ещё 0×0, родитель нулевой — WebGL на нулевом canvas
  // падает («Framebuffer: Incomplete Attachment»), сцена загрузки не стартует, полоска стоит вечно.
  // В RESIZE размер берётся от родителя, а не из width/height, поэтому нужен именно min.
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: Math.max(320, window.innerWidth),
    height: Math.max(240, window.innerHeight),
    min: { width: 1, height: 1 },
  },
  render: { antialias: true },
  banner: false,
});
/**
 * Поворот телефона: Phaser 3.90 в режиме RESIZE берёт размер родителя до того, как браузер его
 * пересчитал (баг #7213), и поле остаётся в размере прошлой ориентации — полэкрана чёрное.
 * Когда раскладка устоялась (два кадра + 150 мс), перечитываем размер сами (как upstream #7222).
 */
let resyncRaf = 0;
let resyncTimer = 0;
function scheduleScaleResync(): void {
  cancelAnimationFrame(resyncRaf);
  window.clearTimeout(resyncTimer);
  resyncRaf = requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      resyncTimer = window.setTimeout(() => {
        game.scale.getParentBounds();
        game.scale.refresh();
      }, 150);
    }),
  );
}
window.addEventListener('resize', scheduleScaleResync);
window.addEventListener('orientationchange', scheduleScaleResync);
window.visualViewport?.addEventListener('resize', scheduleScaleResync);
screen.orientation?.addEventListener?.('change', scheduleScaleResync);

/** Грузит все спрайты один раз при запуске, чтобы матч стартовал без ожидания. */
let spritesLoaded: () => void = () => {};
let spritesAreReady = false;
const spritesReady = new Promise<void>((resolve) => (spritesLoaded = resolve)).then(() => {
  spritesAreReady = true;
});
/** Заставка из index.html: вместо чёрного экрана, пока грузятся картинки и звуки (GAME_AUDIT.md, Top-10). */
const bootScreen = document.getElementById('boot');
const hideBoot = () => bootScreen?.classList.add('off');
/** Дождаться ассетов; если их ещё нет — всё это время видна заставка с полоской. */
async function whenLoaded(): Promise<void> {
  if (!spritesAreReady) {
    bootScreen?.classList.remove('off');
    await spritesReady;
  }
  hideBoot();
}
class BootScene extends Phaser.Scene {
  preload(): void {
    // Полоска считает файлы, а не байты — зато двигается, и видно, что игра не зависла.
    const onProgress = (v: number) => bootScreen?.style.setProperty('--p', v.toFixed(3));
    this.load.on('progress', onProgress);
    // Phaser берёт из очереди следующие файлы только в кадре игрового цикла, а в фоновой вкладке или
    // скрытом iframe кадров нет — загрузка вставала после первых 32 файлов. Всё сразу в очередь —
    // дальше загрузка идёт на событиях сети, без кадров (очередь соединений держит сам браузер).
    this.load.maxParallelDownloads = Infinity;
    preloadSprites(this);
    preloadSfx(this);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.load.off('progress', onProgress));
  }
  create(): void {
    spritesLoaded();
    loadMusic(this, () => sfx.musicLoaded());
  }
}
const sfx = new Sfx(game);
hud.onSound = (k) => sfx.play(k, { pitch: 0.02 });
hud.onToggleMute = () => {
  const muted = !sfx.muted;
  sfx.setMuted(muted);
  // Нажали до конца загрузки прогресса — запомним и сохраним в boot().
  if (store) store.update((p) => (p.settings.muted = muted));
  else mutedBeforeBoot = muted;
  return muted;
};
game.scene.add('game', GameScene, false);
game.scene.add('boot', BootScene, true);
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

/** Игровой плейлист: треки идут друг за другом по кругу. */
const GAME_MUSIC = ['night1', 'night2', 'night3'];

/**
 * Прогресс между матчами. Появляется в boot() до первого экрана (platform/save.ts) и дальше не
 * подменяется: меняем только через store.update/commit — они сразу пишут снимок локально и в облако.
 */
let store: ProgressStore;
let progress: Progress;
/** Звук переключили на заставке, пока прогресс ещё грузился. */
let mutedBeforeBoot: boolean | null = null;

function showMenu(): void {
  hideBoot();
  game.scene.stop('game');
  // Музыка грузится вместе со спрайтами — включаем, как только она есть.
  spritesReady.then(() => sfx.playMusic('menu'));
  hud.showStart(progress, start, startTutorial, {
    coins: progress.meta.coins,
    giftReady: dailyAvailable(progress.meta, dayKey(new Date())),
    onShop: openShop,
    onGift: openDaily,
  });
  // Открылась постройка, а экран «Новое!» ещё не видели (вышли после поимки, перезагрузили) — сначала он.
  // «Попробовать!» — сразу в матч (той же сложности, что в прошлый раз), как и после итогов; «В меню» — остаться.
  const unlock = nextPreview(progress.unlocks);
  if (unlock) return openUnlock(unlock, () => start(lastDifficulty), showMenu);
  // Подарок дня ещё не забран — показываем сразу при входе в меню (причина зайти завтра).
  if (dailyAvailable(progress.meta, dayKey(new Date()))) openDaily();
}

/**
 * Экран «Новое!» (BUILDING_PROGRESSION.md). Пройденным он считается только после нажатия «Попробовать!» или
 * «В меню» (previewButtons): закрыли вкладку прямо на экране — при следующем входе он покажется снова.
 * Дальше в меню ждёт метка «Новое!».
 */
function openUnlock(kind: UnlockKind, onTry: () => void, onMenu?: () => void): void {
  hideBoot();
  track('unlock_preview', { kind });
  const buttons = previewButtons(progress.unlocks, kind, () => store.commit(), onTry, onMenu);
  hud.showUnlock(kind, buttons.onTry, buttons.onMenu);
}

/** Магазин: герои, скины, усилители. После каждой покупки перерисовываем. */
function openShop(): void {
  const m = progress.meta;
  const done = (err: string | null) => {
    if (err) hud.toastScreen(err);
    else store.commit({ critical: true });
    openShop();
  };
  // Выбор героя или скина — не покупка: облаку хватит обычной пачки.
  const picked = (err: string | null) => {
    if (err) hud.toastScreen(err);
    else store.commit();
    openShop();
  };
  hud.showShop(
    {
      coins: m.coins,
      heroes: HEROES.map((h) => ({ look: h.look, name: HERO_NAMES[h.look], price: h.price, owned: m.heroes.includes(h.look), selected: m.hero === h.look })),
      skins: (['door', 'cannon'] as const).map((slot) => ({
        slot,
        items: SKINS[slot].map((s) => ({ id: s.id, name: s.name, price: s.price, ready: s.ready, owned: m.skins[slot].includes(s.id), selected: m.skin[slot] === s.id })),
      })),
      boosters: (Object.keys(BOOSTERS) as BoosterId[]).map((id) => ({ id, ...BOOSTERS[id], count: m.boosters[id] })),
    },
    {
      buyHero: (look) => done(buyHero(m, look)),
      selectHero: (look) => picked(selectHero(m, look) ? null : 'Сначала купи'),
      buySkin: (slot, id) => done(buySkin(m, slot, id)),
      selectSkin: (slot, id) => {
        if (m.skins[slot].includes(id)) m.skin[slot] = id;
        picked(null);
      },
      buyBooster: (id) => done(buyBooster(m, id)),
      close: showMenu,
    },
  );
}

/** Ежедневный подарок: календарь на 7 дней. */
function openDaily(): void {
  const m = progress.meta;
  hud.showDaily(
    { days: [...DAILY], step: m.daily.step, available: dailyAvailable(m, dayKey(new Date())) },
    () => {
      const coins = claimDaily(m, dayKey(new Date()));
      store.commit({ critical: true });
      track('daily_claim', { coins, step: m.daily.step });
      return coins;
    },
    showMenu,
  );
}

/** Карта обучения всегда одна и та же — сценарий проверен на ней. */
const TUTORIAL_SEED = 20260924;

/** «Ночь 0»: настоящий матч с подсказками, проиграть нельзя. Не считается в матчи и победы. */
async function startTutorial(): Promise<void> {
  hud.hideScreen();
  await whenLoaded();
  sfx.playMusic(GAME_MUSIC);
  const match = new Match({ seed: TUTORIAL_SEED, difficulty: 'easy', flameUnlocked: false, tutorial: true });
  // Пройдено или пропущено — больше само не запустится. Повтор из меню не трогает матчи, монеты и открытия.
  let gift = 0;
  const finish = (how: 'done' | 'skipped') => store.update((p) => (gift = finishTutorial(p, how)), { critical: true });
  const data: GameData = {
    match,
    hud,
    sfx,
    onEnd: () => {
      // Подарок за обучение — один раз: сразу хватает на первую покупку в магазине.
      finish('done');
      sfx.playMusic(null, 400);
      sfx.play('win', { pitch: 0 });
      hud.showTutorialDone(() => start('easy'), gift);
    },
    // Вышел из обучения в меню — тоже «пропустил»: иначе оно запускалось бы снова при каждом входе.
    onMenu: () => {
      finish('skipped');
      showMenu();
    },
    tutorial: {
      onSkip: () => {
        finish('skipped');
        start('easy');
      },
      track,
    },
  };
  game.scene.stop('game');
  game.scene.start('game', data);
}

/** Сложность последнего матча: с неё «Попробовать!» на экране «Новое!» в меню (после перезагрузки — лёгкая). */
let lastDifficulty: Difficulty = 'easy';

async function start(difficulty: Difficulty): Promise<void> {
  lastDifficulty = difficulty;
  hud.hideScreen();
  await whenLoaded();
  // Музыка меню — только в меню; с начала матча играет игровой плейлист.
  sfx.playMusic(GAME_MUSIC);
  // Купленные усилители срабатывают в этом матче (по одному каждого), а списываются, когда началась ночь:
  // вышел раньше — покупки остаются (GAME_AUDIT.md, Top-4).
  const boosters = planBoosters(progress.meta);
  let boostersSpent = false;
  // Какие постройки уже открыты между матчами (meta/unlocks.ts). Пламя в матче есть всегда (соседи играют как раньше);
  // пока игроку не открыта тыква, его цены в пламени переводятся в конфеты (Match.flameOpen) — тупика нет.
  const { lockedKinds } = matchUnlocks(progress.unlocks);
  const match = new Match({
    seed: Math.floor(Math.random() * 2 ** 31),
    difficulty,
    flameUnlocked: true,
    lockedKinds,
    hero: progress.meta.hero,
    skin: { ...progress.meta.skin },
    boosters,
  });
  const exitRewardNow = () =>
    match.nightTime > 0 ? exitReward(match.player.caught, difficulty, match.nightTime, match.survivors - (match.player.caught ? 0 : 1)) : null;
  if (progress.matches === 0) track('first_match_start', { difficulty, tutorial: progress.tutorial ?? 'none' });
  const data: GameData = {
    match,
    hud,
    sfx,
    hints: {
      seen: new Set(progress.hints),
      firstMatches: progress.matches < 2,
      onSeen: (id) => {
        // Сохраняем сразу (правило Яндекса 1.9): перезагрузка не покажет подсказку повторно.
        store.update((p) => p.hints.push(id));
        track('hint_shown', { id });
      },
    },
    onNightStart: () => {
      if (boostersSpent) return;
      boostersSpent = true;
      store.update((p) => spendBoosters(p.meta, boosters));
    },
    exitCoins: () => exitRewardNow()?.coins ?? 0,
    unlocks: {
      badges: badgeKinds(progress.unlocks),
      onBadgeSeen: (kind) => {
        if (!isUnlockKind(kind)) return;
        store.update((p) => markBadgeSeen(p.unlocks, kind));
      },
    },
    onEnd: () => {
      // Завершённый матч (победа, командная победа, поражение) двигает открытия — победа не нужна.
      const fresh = recordMatchOutcome(progress, match.result === 'win' ? (match.teamWin ? 'teamWin' : 'win') : 'lose');
      for (const kind of fresh) track('building_unlock', { kind, matches: progress.matches });
      // Командная победа (игрок был духом) — тоже победа: для ребёнка это общий успех.
      if (match.result === 'win') progress.wins[difficulty]++;
      const neighbors = match.survivors - (match.player.caught ? 0 : 1);
      const reward = matchReward(match.result === 'win', difficulty, match.nightTime, neighbors, match.teamWin);
      progress.meta.coins += reward.coins;
      store.commit({ critical: true });
      track('match_end', { difficulty, result: match.result, team: match.teamWin, coins: reward.coins, night: Math.round(match.nightTime) });
      sfx.playMusic(null, 400);
      sfx.play(match.result === 'win' ? 'win' : 'lose', { pitch: 0 });
      // Открылось новое — по любой кнопке итогов сначала экран «Новое!»: «Попробовать!» — сразу в матч.
      const afterResult = (next: () => void) => {
        const kind = nextPreview(progress.unlocks);
        if (!kind) return next();
        openUnlock(kind, () => afterResult(() => start(difficulty)), showMenu);
      };
      hud.showResult(match, fresh[0] ?? null, () => afterResult(() => start(difficulty)), () => afterResult(showMenu), reward);
    },
    onMenu: () => {
      // Сам вышел в меню: поймали — как за поражение, живым посреди ночи — за продержанные минуты.
      // Поймали — матч для игрока закончен (как поражение): двигает открытия, экран «Новое!» покажет меню.
      // Живым через паузу — не завершение: открытия не двигает (иначе фарм входом-выходом).
      const reward = exitRewardNow();
      const fresh = recordMatchOutcome(progress, match.player.caught ? 'caughtExit' : 'quit');
      for (const kind of fresh) track('building_unlock', { kind, matches: progress.matches });
      if (match.player.caught) track('match_exit', { difficulty, caught: true, coins: reward?.coins ?? 0, night: Math.round(match.nightTime) });
      if (reward) progress.meta.coins += reward.coins;
      // Живым через паузу до начала ночи — ничего не изменилось, записывать нечего.
      if (reward || match.player.caught) store.commit({ critical: true });
      // Открылось новое — меню сразу покажет экран «Новое!»: надпись о монетах поверх него не кладём.
      const unlockNext = nextPreview(progress.unlocks) !== null;
      showMenu();
      if (reward && !unlockNext) hud.toastScreen(`+${reward.coins} монет за ночь`);
    },
    onRevive: () => track('spirit_revive', { difficulty, night: Math.round(match.nightTime) }),
  };
  game.scene.stop('game');
  game.scene.start('game', data);
}

// Страница прослушивания звуков: localhost:5173/?sounds (только в разработке).
// Строка = событие, кнопки = варианты. Выбор: npm run sfx -- pick click=2 shot=1 …
// Просмотр экранов итогов без матча: localhost:5173/?result=win, ?result=team или ?result=lose (только в разработке).
const previewResult = import.meta.env.DEV ? new URLSearchParams(location.search).get('result') : null;
if (previewResult === 'win' || previewResult === 'lose' || previewResult === 'team') {
  const m = new Match({ seed: 1, difficulty: 'easy', flameUnlocked: true });
  m.result = previewResult === 'lose' ? 'lose' : 'win';
  m.teamWin = previewResult === 'team';
  m.nightTime = 9 * 60 + 12;
  m.ghost.level = 7;
  m.ghost.maxHp = 1000;
  m.ghost.hp = 120;
  for (let i = 0; i < 6; i++) m.rooms[i].ownerId = i;
  if (previewResult !== 'win') {
    m.player.caught = true;
    m.player.spirit = previewResult === 'team';
    m.rooms[0].eliminated = true;
  }
  const again = () => (location.search = '');
  hideBoot();
  hud.showResult(m, null, again, again, matchReward(m.result === 'win', 'easy', m.nightTime, 4, m.teamWin));
} else if (import.meta.env.DEV && isUnlockKind(new URLSearchParams(location.search).get('unlock') ?? '')) {
  // Просмотр экрана «Новое!» без матчей: localhost:5173/?unlock=pumpkin (trap, workbench, fridge) — только в разработке.
  const kind = new URLSearchParams(location.search).get('unlock') as UnlockKind;
  const next = UNLOCK_KINDS[(UNLOCK_KINDS.indexOf(kind) + 1) % UNLOCK_KINDS.length];
  hideBoot();
  hud.showUnlock(kind, () => (location.search = `?unlock=${next}`), () => (location.search = ''));
} else if (import.meta.env.DEV && new URLSearchParams(location.search).has('sounds')) {
  spritesReady.then(() => {
    hideBoot();
    const box = document.getElementById('screen')!;
    box.classList.add('show');
    box.style.overflow = 'auto';
    const rows = Object.entries(SFX_GROUPS)
      .map(
        ([ev, keys]) =>
          `<div style="display:flex;gap:8px;align-items:center;margin:6px 0"><b style="width:120px;text-align:right">${ev}</b>${keys
            .map((k) => `<button class="btn-big alt" data-k="${k}" style="min-width:56px;min-height:40px;font-size:16px">${k.match(/_c(\d+)$/)?.[1] ?? '▶'}</button>`)
            .join('')}</div>`,
      )
      .join('');
    box.innerHTML = `<div class="card" style="max-height:92vh;overflow:auto"><h1>Музыка</h1><div id="music-list"></div><h1>Звуки</h1><p>Нажимай цифры, чтобы послушать варианты.</p>${rows}</div>`;
    // Кандидаты музыки грузятся лениво — в сборку игры не попадают.
    const tracks = import.meta.glob('./assets/music/*.mp3', { query: '?url', import: 'default' });
    const list = box.querySelector('#music-list')!;
    for (const [path, load] of Object.entries(tracks).sort()) {
      load().then((url) => {
        const name = path.split('/').pop()!.replace('.mp3', '');
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0';
        row.innerHTML = `<b style="width:90px;text-align:right">${name}</b><audio controls preload="none" src="${url}" style="height:36px"></audio>`;
        list.appendChild(row);
        [...list.children].sort((a, b) => a.textContent!.localeCompare(b.textContent!)).forEach((c) => list.appendChild(c));
      });
    }
    box.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach((b) => b.addEventListener('click', () => sfx.play(b.dataset.k!, { pitch: 0 })));
  });
} else void boot();

/**
 * Запуск игры: сначала прогресс (SDK → safeStorage → локальный снимок → облако, если игрок вошёл),
 * и только потом первый экран — иначе мелькнуло бы обучение, а через секунду пришло облако.
 * Пока грузится, видна заставка. Окно входа в Яндекс само не открывается.
 */
async function boot(): Promise<void> {
  let booted = false;
  const saved = await bootSave({
    sdk: initYandexSdk,
    // Облако ответило позже или игрок вошёл в аккаунт — прогресс заменён облачным.
    onReplaced: () => {
      if (!booted) return;
      sfx.setMuted(progress.settings.muted);
      hud.setMuteIcon(progress.settings.muted);
      if (!game.scene.isActive('game')) showMenu();
    },
  });
  store = saved.store;
  progress = store.progress;
  booted = true;
  // Скины на заставке не грузим — выбранный подтягиваем в кэш после основных спрайтов, пока игрок в меню
  // (не отнимая канал у заставки).
  void spritesReady.then(() => prefetchSkin(progress.meta.skin));
  if (mutedBeforeBoot !== null && mutedBeforeBoot !== progress.settings.muted) store.update((p) => (p.settings.muted = mutedBeforeBoot!));
  sfx.setMuted(progress.settings.muted);
  hud.setMuteIcon(progress.settings.muted);
  // Уходят со страницы — дослать в облако то, что ещё ждёт в очереди. Вернулись — перечитать облако:
  // пока вкладка висела, могли играть на другом устройстве.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flushCloud();
    else void store.refreshCloud();
  });
  window.addEventListener('pagehide', () => store.flushCloud());
  // Проверка входа до появления кнопки «Сохранить в облаке»: __save.signIn() в консоли.
  if (import.meta.env.DEV) {
    (window as unknown as { __save: unknown }).__save = { store, signIn: () => saved.sdk && signInAndSync(saved.sdk, store) };
  }
  const { start: first, changed } = resolveTutorialOnBoot(progress);
  if (changed) store.commit();
  if (first === 'menu') showMenu();
  else startTutorial(); // Самый первый запуск: сразу в «Ночь 0», без меню.
}
