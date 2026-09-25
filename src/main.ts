import Phaser from 'phaser';
import './style.css';
import {
  BOOSTERS,
  DAILY,
  HEROES,
  SKINS,
  TUTORIAL_GIFT,
  buyBooster,
  buyHero,
  buySkin,
  claimDaily,
  dailyAvailable,
  dayKey,
  matchReward,
  selectHero,
  takeBoosters,
  type BoosterId,
} from './meta/economy';
import { HERO_NAMES } from './sim/match';
import { track } from './platform/analytics';
import { loadProgress, saveProgress } from './platform/storage';
import { Match } from './sim/match';
import type { Difficulty } from './sim/types';
import { Hud } from './ui/hud';
import { GameScene, type GameData } from './view/GameScene';
import { preloadSprites } from './view/sprites';
import { SFX_GROUPS, Sfx, preloadSfx } from './audio/sfx';

document.addEventListener('contextmenu', (e) => e.preventDefault());

const hud = new Hud(document.getElementById('ui')!);
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#140f22',
  // Если вкладка грузится в фоне, размер окна бывает 0 — WebGL на нулевом canvas падает.
  scale: { mode: Phaser.Scale.RESIZE, width: Math.max(320, window.innerWidth), height: Math.max(240, window.innerHeight) },
  render: { antialias: true },
  banner: false,
});
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
    this.load.on('progress', (v: number) => bootScreen?.style.setProperty('--p', v.toFixed(3)));
    preloadSprites(this);
    preloadSfx(this);
  }
  create(): void {
    spritesLoaded();
  }
}
const sfx = new Sfx(game);
hud.onSound = (k) => sfx.play(k, { pitch: 0.02 });
hud.onToggleMute = () => {
  sfx.setMuted(!sfx.muted);
  return sfx.muted;
};
hud.setMuteIcon(sfx.muted);
game.scene.add('game', GameScene, false);
game.scene.add('boot', BootScene, true);
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

/** Игровой плейлист: треки идут друг за другом по кругу. */
const GAME_MUSIC = ['night1', 'night2', 'night3'];

const progress = loadProgress();

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
  // Подарок дня ещё не забран — показываем сразу при входе в меню (причина зайти завтра).
  if (dailyAvailable(progress.meta, dayKey(new Date()))) openDaily();
}

/** Магазин: герои, скины, усилители. После каждой покупки перерисовываем. */
function openShop(): void {
  const m = progress.meta;
  const done = (err: string | null) => {
    if (err) hud.toastScreen(err);
    else saveProgress(progress);
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
      selectHero: (look) => done(selectHero(m, look) ? null : 'Сначала купи'),
      buySkin: (slot, id) => done(buySkin(m, slot, id)),
      selectSkin: (slot, id) => {
        if (m.skins[slot].includes(id)) m.skin[slot] = id;
        done(null);
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
      saveProgress(progress);
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
  const finish = (how: 'done' | 'skipped') => {
    progress.tutorial = how;
    saveProgress(progress);
  };
  const data: GameData = {
    match,
    hud,
    sfx,
    onEnd: () => {
      finish('done');
      // Подарок за обучение — один раз: сразу хватает на первую покупку в магазине.
      let gift = 0;
      if (!progress.meta.tutorialGift) {
        progress.meta.tutorialGift = true;
        progress.meta.coins += TUTORIAL_GIFT;
        gift = TUTORIAL_GIFT;
        saveProgress(progress);
      }
      sfx.playMusic(null, 400);
      sfx.play('win', { pitch: 0 });
      hud.showTutorialDone(() => start('easy'), gift);
    },
    onMenu: showMenu,
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

async function start(difficulty: Difficulty): Promise<void> {
  hud.hideScreen();
  await whenLoaded();
  // Музыка меню — только в меню; с начала матча играет игровой плейлист.
  sfx.playMusic(GAME_MUSIC);
  // Купленные усилители срабатывают в этом матче (по одному каждого).
  const boosters = takeBoosters(progress.meta);
  saveProgress(progress);
  const match = new Match({
    seed: Math.floor(Math.random() * 2 ** 31),
    difficulty,
    // Тыквы и пламя — сразу, с первого матча («со 2-го матча» было непонятным запретом, 2026-09-25).
    flameUnlocked: true,
    hero: progress.meta.hero,
    skin: { ...progress.meta.skin },
    boosters,
  });
  if (progress.matches === 0) track('first_match_start', { difficulty, tutorial: progress.tutorial ?? 'none' });
  const data: GameData = {
    match,
    hud,
    sfx,
    hints: {
      seen: new Set(progress.hints),
      onSeen: (id) => {
        // Сохраняем сразу (правило Яндекса 1.9): перезагрузка не покажет подсказку повторно.
        progress.hints.push(id);
        saveProgress(progress);
        track('hint_shown', { id });
      },
    },
    onEnd: () => {
      progress.matches++;
      // Командная победа (игрок был духом) — тоже победа: для ребёнка это общий успех.
      if (match.result === 'win') progress.wins[difficulty]++;
      const neighbors = match.survivors - (match.player.caught ? 0 : 1);
      const reward = matchReward(match.result === 'win', difficulty, match.nightTime, neighbors, match.teamWin);
      progress.meta.coins += reward.coins;
      saveProgress(progress);
      track('match_end', { difficulty, result: match.result, team: match.teamWin, coins: reward.coins, night: Math.round(match.nightTime) });
      sfx.playMusic(null, 400);
      sfx.play(match.result === 'win' ? 'win' : 'lose', { pitch: 0 });
      hud.showResult(match, false, () => start(difficulty), showMenu, reward);
    },
    onMenu: showMenu,
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
  hud.showResult(m, false, again, again, matchReward(m.result === 'win', 'easy', m.nightTime, 4, m.teamWin));
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
} else if (progress.tutorial) showMenu();
else if (progress.matches > 0) {
  // Играл до появления обучения — не заставляем проходить.
  progress.tutorial = 'done';
  saveProgress(progress);
  showMenu();
} else startTutorial(); // Самый первый запуск: сразу в «Ночь 0», без меню.
