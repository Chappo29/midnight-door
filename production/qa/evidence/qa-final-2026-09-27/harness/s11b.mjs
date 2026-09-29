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
const endWin = (page) => scene(page, `m.phaseLeft = 0.05`).then(() => until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 10000)).then(() => scene(page, `s.debugAdvance(90); m.ghost.hp = 0; m.ghost.state='dead'; m.events.push({type:'ghostDead'}); m.finish('win','ghost');`)).then(() => until(page, () => document.querySelector('#screen.show .result-card'), null, 10000));
// result screen with a fresh unlock (matches 0 → 1 unlocks pumpkin)
// unlock preview shown via "Ещё раз"
// caught card
// ×2 coins ad running
// mid-night with a booster → booster already spent (committed at night start)
await closeAt('mid-night with booster', mk({ meta: { boosters: { candy: 2 } } }), async (page) => { await toPrep(page); await until(page, () => !window.__game.scene.getScene('game').m.player.path.length, null, 30000); await scene(page, `m.phaseLeft = 0.05`); await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 30000).catch(async () => console.log('no night', await scene(page, `return { phase: m.phase, left: m.phaseLeft, path: m.player.path.length, room: m.player.roomId, paused: s.userPaused || s.hiddenPaused || s.caughtPaused, plat: window.__platform.paused }`))); await sleep(400); return b(await state(page)); });
await browser.close();
