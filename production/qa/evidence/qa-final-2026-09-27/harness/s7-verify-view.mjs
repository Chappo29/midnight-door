// S7: live verification of static VIEW findings (3, 4, 6, 17.2) and SIM-1 broken door.
import { launch, open, state, shot, click, sleep, until, scene, cellXY } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const browser = await launch();

// ---- VIEW-3: tutorial finger/spotlight on ultrawide desktop (clean save → tutorial)
{
  const { page, ctx } = await open(browser, { w: 2560, h: 1000, save: null });
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').tut, null, 20000);
  await page.mouse.click(1280, 500);
  await until(page, () => window.__game.scene.getScene('game').tut?.view()?.step.id === 'pick', null, 10000);
  await sleep(800);
  const r = await page.evaluate(() => {
    const s = window.__game.scene.getScene('game');
    const v = s.tut.view();
    const t = v.target.at;
    const cam = s.cameras.main; const c = window.__game.canvas.getBoundingClientRect();
    const truth = { x: c.x + ((t.x + 0.5) * 48 - cam.worldView.x) * cam.zoom, y: c.y + ((t.y + 0.5) * 48 - cam.worldView.y) * cam.zoom };
    const hand = document.querySelector('.tut-hand, .tut-finger, [class*="hand"], [class*="finger"]');
    const spot = document.querySelector('.tut-spot, .tut-hole, [class*="spot"]');
    const hr = hand?.getBoundingClientRect(); const sr = spot?.getBoundingClientRect();
    return { canvasLeft: Math.round(c.x), target: t, truth: { x: Math.round(truth.x), y: Math.round(truth.y) }, hand: hr && { x: Math.round(hr.x + hr.width / 2), y: Math.round(hr.y + hr.height / 2), cls: hand.className }, spot: sr && { x: Math.round(sr.x + sr.width / 2), y: Math.round(sr.y + sr.height / 2), cls: spot.className } };
  });
  log('VIEW-3 ultrawide tutorial:', r);
  await shot(page, 's7-view3-ultrawide');
  // Tap exactly where the finger/spot points: is it accepted?
  if (r.spot) {
    await page.mouse.click(r.spot.x, r.spot.y);
    await sleep(800);
    log('   tap at spotlight → player room', await scene(page, `return m.player.roomId`), 'step', await scene(page, `return s.tut.view()?.step.id`));
  }
  await ctx.close();
}

// ---- VIEW-6: music track completes during fade
{
  const today = new Date().toISOString().slice(0, 10);
  const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, tutorial: 'done', hints: [], meta: { coins: 10, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: false } } });
  const { page, ctx, logs } = await open(browser, { save: VET });
  await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
  await sleep(3000);
  const r = await page.evaluate(async () => {
    const sfx = window.__sfx;
    sfx.playMusic(['night1', 'night2', 'night3'], 0);
    await new Promise((r) => setTimeout(r, 800));
    const mus = sfx.music ?? Object.values(sfx).find((v) => v && v.key && /night/.test(v.key));
    if (!mus) return { err: 'no music handle', keys: Object.keys(sfx) };
    mus.setSeek(Math.max(0, mus.duration - 0.2));
    sfx.playMusic(null, 400);
    const before = window.__qa.errors.length;
    await new Promise((r) => setTimeout(r, 1500));
    return { key: mus.key, errorsAfter: window.__qa.errors.length - before, sample: window.__qa.errors.slice(-1) };
  });
  log('VIEW-6 music fade vs track end:', r, logs.filter((l) => /TypeError|volume/i.test(l)).length, 'console errors');
  await ctx.close();
}

// ---- VIEW-17.2: Space captured after a match (keyboard activation of menu buttons)
{
  const today = new Date().toISOString().slice(0, 10);
  const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 0, tutorial: 'done', hints: [], meta: { coins: 10, daily: { step: 1, last: today } }, unlocks: {}, settings: { muted: true } } });
  const { page, ctx } = await open(browser, { save: VET });
  await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
  await sleep(600);
  await page.focus('#screen button[data-d="easy"]');
  await page.keyboard.press('Space');
  await sleep(1500);
  const a = await state(page);
  log('VIEW-17.2 before any match: Space on "Лёгкая" → active', a.active);
  await page.keyboard.press('Escape'); await sleep(500); await click(page, '#tomenu'); await sleep(1300);
  await page.focus('#screen button[data-d="easy"]');
  await page.keyboard.press('Space');
  await sleep(1500);
  const b = await state(page);
  log('VIEW-17.2 after a match: Space on "Лёгкая" → active', b.active, b.screen);
  await ctx.close();
}

// ---- VIEW-4: desktop fast click on menu option ~50px from the first click
{
  const today = new Date().toISOString().slice(0, 10);
  const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, tutorial: 'done', hints: [], meta: { coins: 10, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });
  const { page, ctx } = await open(browser, { w: 1280, h: 800, save: VET });
  await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
  await sleep(500);
  await page.evaluate(() => (window.__platform.fake = { show: () => Promise.resolve(true) }));
  await click(page, '#screen.show button[data-d="easy"]');
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep' && !window.__game.scene.getScene('game').m.player.path.length, null, 30000);
  await sleep(1500);
  await scene(page, `m.grant(m.playerRoom, 500)`);
  const cell = await scene(page, `const r = m.playerRoom; return m.placeableCells(r, 'cannon').find(c => Math.abs(c.x+0.5-m.player.x)+Math.abs(c.y+0.5-m.player.y) > 1.5)`);
  const p = await cellXY(page, cell.x, cell.y);
  await page.mouse.click(p.x, p.y);
  await sleep(150);
  const opt = await page.$('#menu button[data-opt="build:cannon"]');
  const ob = await opt.boundingBox();
  // click the option at the point closest to the first click, but inside the button
  const cx = Math.max(ob.x + 4, Math.min(ob.x + ob.width - 4, p.x)), cy = Math.max(ob.y + 4, Math.min(ob.y + ob.height - 4, p.y));
  const dist = Math.hypot(cx - p.x, cy - p.y);
  await sleep(450);
  await page.mouse.click(cx, cy);
  await sleep(400);
  const task = await scene(page, `return { task: m.player.task?.kind ?? null, menuOpen: s.hud.menuOpen }`);
  log(`VIEW-4 click option ${Math.round(dist)}px from first click after 600ms →`, task);
  await ctx.close();
}
await browser.close();
