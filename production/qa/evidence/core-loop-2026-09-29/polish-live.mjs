// Final polish: живые проверки на замороженных часах, тихо, по одной (CORE_LOOP_UX_PASS.md, Final polish).
//   node polish-live.mjs [repair|flame|caught|menu|select|otbilsya|all]   (сервер: конфиг audit, порт 5190)
import { launch, click, scene } from '../qa-final-2026-09-27/harness/harness.mjs';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const OUT = path.dirname(fileURLToPath(import.meta.url)) + '/polish/';
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.QA_URL || 'http://localhost:5190/';
const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const save = (unlocked) =>
  JSON.stringify({
    v: 2,
    rev: 50,
    at: 1,
    progress: {
      matches: unlocked ? 1 : 0,
      wins: { easy: unlocked ? 1 : 0, hard: 0, nightmare: 0 },
      tutorial: 'done',
      hints: ['pan', 'basic-cannon', 'basic-door', 'range', 'level', 'retreat', 'left', 'sell', 'flame', 'repair'],
      meta: { coins: 40, daily: { step: 1, last: new Date().toISOString().slice(0, 10) }, tutorialGift: true },
      unlocks: { pumpkin: unlocked ? 'available' : 'locked', trap: 'locked', workbench: 'locked', fridge: 'locked' },
      settings: { muted: true },
    },
  });

async function openPage(browser, { w = 844, h = 390, touch = true, unlocked = false, toMatch = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => {
    if (localStorage.getItem('__qa_seeded')) return;
    localStorage.clear();
    localStorage.setItem('__qa_seeded', '1');
    localStorage.setItem('midnight-door-progress', s);
  }, save(unlocked));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto(URL);
  const run = async (ms) => {
    for (let left = ms; left > 0; left -= 500) await page.clock.runFor(Math.min(500, left));
  };
  for (let i = 0; i < 60 && !(await page.evaluate(() => !!window.__game && !!window.__save)); i++) await run(500);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 200);
  for (let i = 0; i < 80 && !(await page.$('#screen.show button[data-d="easy"], #dailyClaim')); i++) await run(250);
  await run(600);
  while (await page.$('#dailyClaim')) (await click(page, '#dailyClaim', { touch }), await run(1400));
  await run(1200);
  if (toMatch) {
    await click(page, '#screen.show button[data-d="easy"]', { touch });
    for (let i = 0; i < 80 && !(await page.evaluate(() => window.__game.scene.getScene('game').m?.phase === 'pick')); i++) await run(250);
    await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
    for (let i = 0; i < 80 && (await scene(page, 'return m.phase')) !== 'prep'; i++) await run(250);
    await scene(page, `m.player.x = m.playerRoom.door.inside.x + 0.5; m.player.y = m.playerRoom.door.inside.y + 0.5; m.player.path = []; m.phaseLeft = 0.05; s.fitCamera();`);
    for (let i = 0; i < 40 && (await scene(page, 'return m.phase')) !== 'night'; i++) await run(250);
    await run(3000);
    await scene(page, `const gh = m.ghost; gh.state = 'hidden'; gh.x = gh.y = -50;`);
  }
  return { ctx, page, run, errors };
}
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });
const repairState = (page) =>
  page.evaluate(() => ({
    cls: document.getElementById('repair').className,
    toast: document.querySelector('#toast.show') ? { text: document.getElementById('toast').textContent, info: document.getElementById('toast').classList.contains('info') } : null,
  }));

const which = process.argv[2] || 'all';
const browser = await launch();
try {
  if (which === 'repair' || which === 'all') {
    const { ctx, page, run, errors } = await openPage(browser);
    const steps = {};
    // 1) Дверь побита до 45 %, ключ готов — кнопка зовёт.
    await scene(page, `const d = m.playerRoom.door; d.hp = d.maxHp * 0.45; d.repairCd = 0;`);
    await run(400);
    steps.ready = await repairState(page);
    await shot(page, 'repair-1-door45-key-ready');
    // 2) Нажал ключ — чинит, потом перезарядка; тап по серому ключу — спокойная плашка, не красная.
    await click(page, '#repair', { touch: true });
    await run(2200);
    steps.cooldown = await repairState(page);
    await scene(page, `const d = m.playerRoom.door; d.hp = d.maxHp * 0.3;`);
    await run(200);
    await click(page, '#repair', { touch: true });
    await run(150);
    steps.cooldownTap = await repairState(page);
    await shot(page, 'repair-2-cooldown-tap-info-toast');
    // 3) Перезарядка кончилась, дверь всё ещё побита — кнопка «выпрыгивает» и снова зовёт.
    await scene(page, `m.playerRoom.door.repairCd = 0.3;`);
    await run(700);
    steps.cooldownOver = await repairState(page);
    await shot(page, 'repair-3-cooldown-over-ready-again');
    // 4) Повторная атака на мою дверь: ключ зовёт, дверь видна.
    await scene(
      page,
      `const gh = m.ghost; const r = m.playerRoom; gh.state = 'attacking'; gh.targetRoom = r.id; gh.x = gh.prevX = r.door.front.x; gh.y = gh.prevY = r.door.front.y; gh.waypoints = []; gh.switchTimer = 1e9; gh.hitTimer = 0.2; gh.hp = gh.maxHp; gh.siegeRoom = r.id;`,
    );
    await run(1500);
    steps.attack = { ...(await repairState(page)), door: await scene(page, 'const d = m.playerRoom.door; return Math.round(100 * d.hp / d.maxHp)') };
    await shot(page, 'repair-4-second-attack');
    log('repair:', steps, { errors });
    await ctx.close();
  }
  if (which === 'flame' || which === 'all') {
    const { ctx, page, run, errors } = await openPage(browser, { unlocked: true });
    const c = await scene(page, `const r = m.playerRoom; const c = m.placeableCells(r, 'cannon').filter(q => !(q.x === r.door.inside.x && q.y === r.door.inside.y))[0]; r.buildings.push({ kind: 'cannon', x: c.x, y: c.y, level: 1, cooldown: 0 }); r.candy = 60; r.flame = 8; return c;`);
    await run(300);
    await scene(page, `const cam = s.cameras.main; s.tap({ x: ((arg.x + 0.5) * 48 - cam.worldView.x) * cam.zoom, y: ((arg.y + 0.5) * 48 - cam.worldView.y) * cam.zoom });`, c);
    await run(500);
    await shot(page, 'flame-1-cannon-l2-early-discount');
    const opt = await page.evaluate(() => document.querySelector('#menu .opt-wrap')?.textContent.replace(/\s+/g, ' ').trim());
    log('flame:', { opt, errors });
    await ctx.close();
  }
  if (which === 'caught' || which === 'all') {
    const { ctx, page, run, errors } = await openPage(browser);
    await scene(page, `const c = m.player; const r = m.playerRoom; r.eliminated = true; r.door.hp = 0; r.door.broken = true; c.caught = true; c.task = null; c.path = []; m.events.push({ type: 'caught', roomId: r.id, charId: c.id }); m.onEliminated(c);`);
    await run(800);
    const pause = await page.evaluate(() => getComputedStyle(document.getElementById('pause')).visibility);
    const sound = await page.evaluate(() => getComputedStyle(document.getElementById('sound')).visibility);
    await shot(page, 'caught-card-no-pause');
    log('caught:', { pause, sound, card: !!(await page.$('#screen.show .caught-card')), errors });
    await ctx.close();
  }
  if (which === 'menu' || which === 'all') {
    for (const [w, h] of [
      [844, 390],
      [390, 844],
    ]) {
      const { ctx, page, run, errors } = await openPage(browser, { w, h, toMatch: false });
      const muted0 = await page.evaluate(() => window.__save.store.progress.settings.muted);
      await shot(page, `menu-sound-${w}x${h}`);
      await click(page, '#metaSound', { touch: true });
      await run(300);
      const muted1 = await page.evaluate(() => window.__save.store.progress.settings.muted);
      const overlap = await page.evaluate(() => {
        const a = document.getElementById('metaSound').getBoundingClientRect();
        const others = [...document.querySelectorAll('#screen .meta-btn, #screen .diff-btn, #screen .menu-tut, #screen .coin-chip')].filter((e) => e.id !== 'metaSound');
        return others.some((e) => {
          const b = e.getBoundingClientRect();
          return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        });
      });
      log(`menu ${w}x${h}:`, { muted0, muted1, overlap, errors });
      await ctx.close();
    }
  }
  if (which === 'select' || which === 'all') {
    const { ctx, page, run, errors } = await openPage(browser);
    const c = await scene(page, `const r = m.playerRoom; const c = m.placeableCells(r, 'cannon').filter(q => !(q.x === r.door.inside.x && q.y === r.door.inside.y))[0]; r.buildings.push({ kind: 'cannon', x: c.x, y: c.y, level: 2, cooldown: 0 }); return c;`);
    await run(300);
    await scene(page, `const cam = s.cameras.main; s.tap({ x: ((arg.x + 0.5) * 48 - cam.worldView.x) * cam.zoom, y: ((arg.y + 0.5) * 48 - cam.worldView.y) * cam.zoom });`, c);
    await run(400);
    const open = await scene(page, 'return { menu: s.hud.menuOpen, selected: s.selected }');
    await shot(page, 'select-1-menu-open-radius');
    await click(page, '#menu .menu-close', { touch: true });
    await run(400);
    const closed = await scene(page, 'return { menu: s.hud.menuOpen, selected: s.selected }');
    await shot(page, 'select-2-menu-closed-no-radius');
    log('select:', { open, closed, errors });
    await ctx.close();
  }
  if (which === 'otbilsya' || which === 'all') {
    const { ctx, page, run, errors } = await openPage(browser);
    await scene(page, `const r = m.playerRoom; s.handleEvents([{ type: 'siegeEnd', roomId: r.id, start: 0, duration: 10, hits: 9, dmg: 100, reason: 'patience', meaningful: true }]);`);
    await run(350);
    await shot(page, 'otbilsya');
    log('otbilsya:', { errors });
    await ctx.close();
  }
} finally {
  await browser.close();
}
