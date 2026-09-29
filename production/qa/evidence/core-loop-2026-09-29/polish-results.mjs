// Final polish (CORE_LOOP_UX_PASS.md): итоги на низких экранах — до и после «×2 монеты», без прокрутки.
//   node polish-results.mjs [префикс=results]   (сервер: конфиг audit, порт 5190). Тихо, по одному размеру.
import { launch, click, sleep, scene } from '../qa-final-2026-09-27/harness/harness.mjs';
import { fileURLToPath } from 'url';
import path from 'path';

const OUT = path.dirname(fileURLToPath(import.meta.url)) + '/polish/';
const URL = process.env.QA_URL || 'http://localhost:5190/';
const PREFIX = process.argv[2] || 'results';
const SAVE = JSON.stringify({
  v: 2,
  rev: 50,
  at: 1,
  progress: {
    matches: 3,
    wins: { easy: 2, hard: 0, nightmare: 0 },
    tutorial: 'done',
    hints: ['pan', 'basic-cannon', 'basic-door'],
    meta: { coins: 40, daily: { step: 1, last: new Date().toISOString().slice(0, 10) }, tutorialGift: true },
    unlocks: { pumpkin: 'available', trap: 'available', workbench: 'available', fridge: 'locked' },
    settings: { muted: true },
  },
});
const SIZES = [
  [844, 390, true],
  [800, 360, true],
  [740, 360, true],
  [667, 375, true],
  [390, 844, true],
  [1280, 720, false],
];

import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const report = [];
try {
  for (const [w, h, touch] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    await ctx.addInitScript((s) => {
      if (localStorage.getItem('__qa_seeded')) return;
      localStorage.clear();
      localStorage.setItem('__qa_seeded', '1');
      localStorage.setItem('midnight-door-progress', s);
    }, SAVE);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    await page.waitForFunction(() => window.__game && window.__save, null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#screen.show button[data-d="easy"], #dailyClaim'), null, { timeout: 30000 });
    await sleep(600);
    while (await page.$('#dailyClaim')) (await click(page, '#dailyClaim', { touch }), await sleep(1400));
    // Реклама-заглушка без оверлея: досмотрел через 300 мс.
    await page.evaluate(() => (window.__platform.fake = { show: () => new Promise((r) => setTimeout(() => r(true), 300)) }));
    await sleep(1100);
    await click(page, '#screen.show button[data-d="easy"]', { touch });
    await page.waitForFunction(() => window.__game.scene.getScene('game').m?.phase === 'pick', null, { timeout: 30000 });
    await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
    await page.waitForFunction(() => window.__game.scene.getScene('game').m.phase === 'prep', null, { timeout: 30000 });
    await scene(page, `m.phaseLeft = 0.05;`);
    await page.waitForFunction(() => window.__game.scene.getScene('game').m.phase === 'night', null, { timeout: 30000 });
    await sleep(8000);
    // Победа по-настоящему: призрак у моей двери с 1 HP, пушка добивает.
    await scene(
      page,
      `const gh = m.ghost; const r = m.playerRoom; gh.state = 'attacking'; gh.targetRoom = r.id; gh.x = gh.prevX = r.door.front.x; gh.y = gh.prevY = r.door.front.y;
       gh.waypoints = []; gh.switchTimer = 1e9; gh.desperate = true; gh.hp = 1;
       r.buildings.push({ kind: 'cannon', x: r.door.inside.x, y: r.door.inside.y, level: 6, cooldown: 0.2 });`,
    );
    await page.waitForSelector('#screen.show .result-card', { timeout: 20000 });
    await sleep(1500);
    const measure = () =>
      page.evaluate(() => {
        const card = document.querySelector('#screen.show .result-card');
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const cr = card.getBoundingClientRect();
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          // Видна целиком: внутри окна и внутри видимой части карточки (без прокрутки).
          const full = r.top >= Math.max(0, cr.top) - 1 && r.bottom <= Math.min(vh, cr.bottom) + 1 && r.left >= 0 && r.right <= vw;
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width), full };
        };
        return {
          scroll: card.scrollHeight - card.clientHeight,
          again: box('#again'),
          menu: box('#tomenu'),
          double: box('#double'),
          num: document.getElementById('rewardNum')?.textContent,
        };
      });
    const before = await measure();
    await page.screenshot({ path: `${OUT}${PREFIX}-${w}x${h}-1-before-ad.png` });
    let after = null;
    let immediate = null;
    if (await page.$('#double')) {
      await click(page, '#double', { touch });
      await sleep(420); // реклама 300 мс + кадр
      immediate = await page.evaluate(() => document.getElementById('rewardNum')?.textContent);
      await sleep(1200);
      after = await measure();
      await page.screenshot({ path: `${OUT}${PREFIX}-${w}x${h}-2-after-x2.png` });
    }
    const row = { size: `${w}x${h}`, before, immediateAfterX2: immediate, after, errors };
    report.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(`${OUT}${PREFIX}.json`, JSON.stringify(report, null, 2));
