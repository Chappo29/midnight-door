// S10: boosters (buy spam, exact coins, max, plan/spend, exit before night, rematch). S11: close tab at key screens.
import { launch, open, reopen, state, shot, click, sleep, until, scene } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const today = new Date().toISOString().slice(0, 10);
const mk = (o) => JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 9, wins: { easy: 3, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true }, ...o, meta: { coins: 0, daily: { step: 1, last: today }, ...(o.meta || {}) } } });
const browser = await launch();
const b = (s) => ({ coins: s.coins, boosters: s.boosters, matches: s.matches, screen: s.screen, active: s.active, phase: s.phase, unlocks: s.unlocks, rev: s.rev });
const menuReady = (page) => until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
async function toPrep(page) {
  await click(page, '#screen.show button[data-d="easy"]');
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep', null, 20000);
}

// ---- S10 boosters
{
  const { page, ctx } = await open(browser, { save: mk({ meta: { coins: 0 } }) });
  await menuReady(page); await sleep(500);
  await page.evaluate(() => (window.__platform.fake = { show: () => Promise.resolve(true) }));
  const price = await page.evaluate(() => 0);
  await click(page, '#metaShop'); await sleep(1100);
  await click(page, '#screen [data-tab="boosters"]'); await sleep(1100);
  const prices = await page.$$eval('#screen [data-buy-booster]', (a) => a.map((e) => [e.dataset.buyBooster, e.textContent.trim(), e.className]));
  log('S10 booster buttons with 0 coins:', prices);
  const candyPrice = Number(prices.find((p) => p[0] === 'candy')[1].replace(/\D/g, ''));
  await scene(page, `p.meta.coins = ${candyPrice}`); // exactly enough for one
  // re-render shop to pick up coins
  await click(page, '#screen .shop-close'); await sleep(1100); await click(page, '#metaShop'); await sleep(1100);
  await click(page, '#screen [data-tab="boosters"]').catch(() => {}); await sleep(1100);
  const btn = await page.$('#screen [data-buy-booster="candy"]');
  const bb = await btn.boundingBox();
  for (let i = 0; i < 4; i++) { await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(90); }
  await sleep(600);
  let st = await state(page);
  log('S10 exact coins, buy x4 fast →', b(st), 'toast:', await page.$eval('#toastScreen', (e) => e.textContent).catch(() => ''));
  // max 3: give coins, buy many
  await scene(page, `p.meta.coins = 100000`);
  await click(page, '#screen .shop-close'); await sleep(1100); await click(page, '#metaShop'); await sleep(1100);
  await click(page, '#screen [data-tab="boosters"]').catch(() => {}); await sleep(1100);
  for (let i = 0; i < 6; i++) { const e = await page.$('#screen [data-buy-booster="candy"]'); if (!e) break; await e.click(); await sleep(1150); }
  st = await state(page);
  log('S10 buy candy x6 slow →', b(st), 'button:', await page.$eval('#screen .booster-item', (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => ''));
  await click(page, '#screen .shop-close'); await sleep(1100);
  // start → exit in prep → boosters kept
  await toPrep(page);
  const planned = await scene(page, `return { plan: m.opts.boosters, candy: Math.round(m.playerRoom.candy) }`);
  await page.keyboard.press('Escape'); await sleep(600); await click(page, '#tomenu'); await sleep(1300);
  st = await state(page);
  log('S10 exit in prep: planned', planned, '→', b(st));
  // start → night → exit → spent once
  await toPrep(page);
  await scene(page, `m.phaseLeft = 0.05`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 30000);
  await sleep(300);
  st = await state(page);
  log('S10 night started →', b(st));
  await page.keyboard.press('Escape'); await sleep(600); await click(page, '#tomenu'); await sleep(1300);
  // rematch x2 through result "again": each match spends one at night start
  for (let i = 0; i < 2; i++) {
    await toPrep(page);
    await scene(page, `m.phaseLeft = 0.05`);
    await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 30000);
    await scene(page, `m.ghost.hp = 0; m.ghost.state='dead'; m.events.push({type:'ghostDead'}); m.finish('win','ghost');`);
    await until(page, () => document.querySelector('#screen.show .result-card'), null, 10000); await sleep(500);
    await click(page, '#tomenu'); await sleep(1300);
    if (await page.$('#screen .unlock-card')) { await click(page, '#tomenu'); await sleep(1300); }
    st = await state(page);
    log(`S10 match ${i + 1} done →`, b(st));
  }
  await ctx.close();
}

// ---- S11 close tab at key screens
async function closeAt(label, save, setup) {
  const { page, ctx } = await open(browser, { save });
  await until(page, () => document.querySelector('#screen.show .card, #screen.show .menu-frame'), null, 20000);
  await sleep(600);
  await page.evaluate(() => (window.__platform.fake = { show: () => new Promise((r) => setTimeout(() => r(true), 3000)) }));
  const before = await setup(page);
  const { page: p2 } = await reopen(ctx, page);
  await until(p2, () => document.querySelector('#screen.show .card, #screen.show .menu-frame') || window.__game.scene.isActive('game'), null, 20000);
  await sleep(1200);
  const after = await state(p2);
  log(`S11 close at ${label}: before`, before, '→ reopen', b(after));
  if (after.screen === 'unlock-card') {
    await click(p2, '#tomenu'); await sleep(1200);
    const { page: p3 } = await reopen(ctx, p2);
    await until(p3, () => document.querySelector('#screen.show .card, #screen.show .menu-frame'), null, 20000); await sleep(1200);
    log('   after "В меню" + reopen →', b(await state(p3)));
  }
  await ctx.close();
}
const endWin = (page) => until(page, () => !window.__game.scene.getScene('game').m.player.path.length, null, 30000).then(() => scene(page, `m.phaseLeft = 0.05`)).then(() => until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 30000)).then(() => scene(page, `s.debugAdvance(90); m.ghost.hp = 0; m.ghost.state='dead'; m.events.push({type:'ghostDead'}); m.finish('win','ghost');`)).then(() => until(page, () => document.querySelector('#screen.show .result-card'), null, 10000));
// result screen with a fresh unlock (matches 0 → 1 unlocks pumpkin)
await closeAt('result (fresh unlock)', mk({ matches: 0, unlocks: {} }), async (page) => { await toPrep(page); await endWin(page); return b(await state(page)); });
// unlock preview shown via "Ещё раз"
await closeAt('unlock preview', mk({ matches: 0, unlocks: {} }), async (page) => { await toPrep(page); await endWin(page); await sleep(500); await click(page, '#again'); await sleep(900); return b(await state(page)); });
// caught card
await closeAt('caught card', mk({}), async (page) => { await toPrep(page); await scene(page, `m.phaseLeft = 0.05`); await sleep(500); await scene(page, `s.debugAdvance(60); const c = m.player; const r = m.playerRoom; r.eliminated = true; c.caught = true; m.events.push({ type: 'caught', roomId: r.id, charId: c.id }); m.onEliminated(c);`); await sleep(800); return b(await state(page)); });
// ×2 coins ad running
await closeAt('x2 coins during ad', mk({}), async (page) => { await toPrep(page); await endWin(page); await sleep(500); const s0 = b(await state(page)); await click(page, '#double'); await sleep(800); return s0; });
// mid-night with a booster → booster already spent (committed at night start)
await closeAt('mid-night with booster', mk({ meta: { boosters: { candy: 2 } } }), async (page) => { await toPrep(page); await scene(page, `m.phaseLeft = 0.05`); await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 30000); await sleep(400); return b(await state(page)); });
await browser.close();
