// Видео финала победы (CORE_LOOP_UX_PASS.md, п. 2): реальное время, без звука, телефон 844×390.
//   node cl-video.mjs   (сервер: конфиг audit, порт 5190)
import { launch, click, sleep, scene } from '../qa-final-2026-09-27/harness/harness.mjs';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const OUT = path.dirname(fileURLToPath(import.meta.url)) + '/';
const URL = process.env.QA_URL || 'http://localhost:5190/';
const SAVE = JSON.stringify({
  v: 2,
  rev: 50,
  at: 1,
  progress: {
    matches: 0,
    wins: { easy: 0, hard: 0, nightmare: 0 },
    tutorial: 'done',
    hints: ['pan', 'basic-cannon', 'basic-door', 'range', 'level', 'retreat', 'left', 'sell', 'flame'],
    meta: { coins: 0, daily: { step: 1, last: new Date().toISOString().slice(0, 10) }, tutorialGift: true },
    unlocks: { pumpkin: 'locked', trap: 'locked', workbench: 'locked', fridge: 'locked' },
    settings: { muted: true },
  },
});

// Какую комнату бьёт призрак: дальняя от игрока (вне экрана) или своя.
const FAR = `const me = m.playerRoom; const d = (r) => Math.hypot(r.door.x - me.door.x, r.door.y - me.door.y); return [...m.rooms].filter(r => r.ownerId !== null && r.id !== me.id).sort((a, b) => d(b) - d(a))[0].id`;
const MINE = `return m.player.roomId`;

async function record(browser, name, pick) {
  const dir = OUT + 'video-tmp/';
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, recordVideo: { dir, size: { width: 844, height: 390 } } });
  await ctx.addInitScript((s) => {
    if (localStorage.getItem('__qa_seeded')) return;
    localStorage.clear();
    localStorage.setItem('__qa_seeded', '1');
    localStorage.setItem('midnight-door-progress', s);
  }, SAVE);
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.__game && window.__save, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#screen.show button[data-d="easy"], #dailyClaim'), null, { timeout: 30000 });
  await sleep(600);
  while (await page.$('#dailyClaim')) (await click(page, '#dailyClaim', { touch: true }), await sleep(1400));
  await page.waitForSelector('#screen.show button[data-d="easy"]', { timeout: 30000 });
  await sleep(1200);
  await click(page, '#screen.show button[data-d="easy"]', { touch: true });
  await page.waitForFunction(() => window.__game.scene.getScene('game').m?.phase === 'pick', null, { timeout: 30000 });
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await page.waitForFunction(() => window.__game.scene.getScene('game').m.phase === 'prep', null, { timeout: 30000 });
  await scene(page, `m.player.x = m.playerRoom.door.inside.x + 0.5; m.player.y = m.playerRoom.door.inside.y + 0.5; m.player.path = []; m.phaseLeft = 0.05; s.fitCamera();`);
  await page.waitForFunction(() => window.__game.scene.getScene('game').m.phase === 'night', null, { timeout: 30000 });
  await sleep(3500);
  const roomId = await scene(page, pick);
  // Призрак ломает эту дверь, 1 HP, больше не убегает; мощная пушка у двери добьёт его через ~1,5 с.
  await scene(
    page,
    `const gh = m.ghost; const r = m.rooms[arg]; gh.state = 'attacking'; gh.targetRoom = r.id; gh.x = gh.prevX = r.door.front.x; gh.y = gh.prevY = r.door.front.y;
     gh.waypoints = []; gh.switchTimer = 1e9; gh.desperate = true; gh.hp = 1;
     r.buildings = r.buildings.filter((b) => !(b.x === r.door.inside.x && b.y === r.door.inside.y));
     r.buildings.push({ kind: 'cannon', x: r.door.inside.x, y: r.door.inside.y, level: 6, cooldown: 1.5 });`,
    roomId,
  );
  await page.waitForSelector('#screen.show .result-card', { timeout: 20000 });
  await sleep(2000);
  const video = page.video();
  await ctx.close();
  const src = await video.path();
  const dst = OUT + name + '.webm';
  fs.renameSync(src, dst);
  console.log('saved', dst);
}

const browser = await launch();
try {
  await record(browser, 'video-victory-ghost-offscreen', FAR);
  await record(browser, 'video-victory-ghost-at-my-door', MINE);
} finally {
  await browser.close();
}
