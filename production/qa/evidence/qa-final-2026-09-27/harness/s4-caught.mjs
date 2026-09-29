// S4: caught card / spirit / revive / end races, pause & visibility.
import { launch, open, state, shot, click, sleep, until, scene } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, wins: { easy: 3, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins: 500, daily: { step: 1, last: new Date().toISOString().slice(0, 10) }, tutorialGift: true }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });

const browser = await launch();
const { page, logs } = await open(browser, { save: VET });
await until(page, () => document.querySelector('#screen.show button[data-d="easy"], #dailyClaim'), null, 20000);
await sleep(500);
while (await page.$('#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1400); }
await page.evaluate(() => {
  window.__qa.ends = 0; window.__qa.menus = 0;
  window.__platform.fake = { show: () => new Promise((r) => setTimeout(() => r(true), 300)) };
});

async function newMatch() {
  let st = await state(page);
  if (st.active && !st.screen) return;
  if (!(await page.$('#screen.show button[data-d="easy"]'))) { await click(page, '#tomenu').catch(() => {}); await sleep(800); }
  await click(page, '#screen.show button[data-d="easy"]');
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await sleep(400);
  // wrap onEnd/onMenu to count
  await scene(page, `const e = s.gd.onEnd, mm = s.gd.onMenu; s.gd.onEnd = () => { window.__qa.ends++; e(); }; s.gd.onMenu = () => { window.__qa.menus++; mm(); };`);
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep', null, 20000);
  await scene(page, `m.phaseLeft = 0.05;`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 20000);
  await scene(page, `s.debugAdvance(30)`);
}
const catchPlayer = () => scene(page, `const c = m.player; const r = m.playerRoom; r.eliminated = true; r.door.hp = 0; r.door.broken = true; c.caught = true; c.task = null; c.path = []; m.events.push({ type: 'caught', roomId: r.id, charId: c.id }); m.onEliminated(c);`);
const counters = () => page.evaluate(() => ({ ends: window.__qa.ends, menus: window.__qa.menus }));
const snap = async (label) => { const st = await state(page); log(label, { screen: st.screen, buttons: st.buttons, phase: st.phase, result: st.result, paused: st.paused, coins: st.coins, matches: st.matches, unlocks: st.unlocks.workbench, ...(await counters()) }); return st; };

const SKIP_TO_F = process.env.F;
// A: caught → card; spirit x2 fast; state
await newMatch();
await catchPlayer();
await until(page, () => document.querySelector('#screen.show .caught-card'), null, 5000);
await sleep(450);
await shot(page, 's4-caught-card');
let st = await snap('A caught card:');
await click(page, '#spirit');
await sleep(90);
await page.mouse.click(640, 360);
await sleep(700);
st = await snap('A after spirit+tap:');
const sp = await scene(page, `return { spirit: m.player.spirit, flyTo: m.player.flyTo, x: m.player.x, y: m.player.y }`);
log('   player:', sp);

// B: spirit → team win → result counts
await scene(page, `m.ghost.hp = 0; m.ghost.state='dead'; m.events.push({type:'ghostDead'}); m.teamWin = m.player.spirit; m.finish('win','ghost');`);
await until(page, () => document.querySelector('#screen.show .result-card'), null, 8000);
await sleep(450);
st = await snap('B team win result:');
await shot(page, 's4-teamwin');
const title = await page.$eval('.result-card h1', (e) => e.textContent);
log('   title:', title);

// C: caught → "Выйти в меню" → coins, unlock progress, no onEnd
const c0 = st.coins, m0 = st.matches;
await click(page, '#tomenu');
await sleep(800);
await newMatch();
st = await state(page);
const c1 = st.coins;
await catchPlayer();
await until(page, () => document.querySelector('#screen.show .caught-card'), null, 5000);
await sleep(450);
const pill = await page.$eval('#screen #tomenu', (e) => e.textContent);
await click(page, '#tomenu');
await sleep(900);
st = await snap('C caught→menu:');
log('   pill:', pill, 'coins delta', st.coins - c1, 'matches delta', st.matches - m0);

// D: caught at the same tick as ghost death (spirit event + ghostDead) → exactly one outcome, no caught card over result
await newMatch();
await scene(page, `const c = m.player; const r = m.playerRoom; r.eliminated = true; c.caught = true; m.events.push({ type: 'caught', roomId: r.id, charId: c.id }); m.onEliminated(c); m.ghost.hp = 0; m.ghost.state='dead'; m.events.push({type:'ghostDead'}); m.teamWin = true; m.finish('win','ghost');`);
await sleep(2500);
st = await snap('D caught+ghostDead same tick:');
await shot(page, 's4-D');

// E: revive button (rewarded) → double tap, and revive when match already ended during the ad
await click(page, '#tomenu').catch(() => {});
await sleep(800);
await newMatch();
await page.evaluate(() => (window.__platform.fake = { show: () => new Promise((r) => setTimeout(() => r(true), 1500)) }));
await catchPlayer();
await until(page, () => document.querySelector('#screen.show .caught-card'), null, 5000);
await sleep(450);
const hasRevive = !!(await page.$('#revive'));
await click(page, '#revive');
await sleep(100);
await click(page, '#revive').catch(() => {});
await click(page, '#tomenu').catch(() => {});
await sleep(2200);
st = await snap('E revive x2 + menu during ad:');
const pv = await scene(page, `return m ? { caught: m.player.caught, spirit: m.player.spirit, eliminated: m.playerRoom?.eliminated, door: m.playerRoom?.door.hp } : null`).catch(() => null);
log('   hasRevive', hasRevive, 'player after revive:', pv);

await page.keyboard.press('Escape'); await sleep(500); await click(page, '#tomenu'); await sleep(900);
// F: revive while the last neighbour gets caught during the ad (match ends mid-ad)
await newMatch();
await catchPlayer();
await until(page, () => document.querySelector('#screen.show .caught-card'), null, 5000);
await sleep(450);
await click(page, '#revive');
await sleep(300);
// during the ad: all neighbours caught → lose
await scene(page, `for (const c of m.chars) { if (c.isPlayer) continue; const r = m.rooms.find(r => r.ownerId === c.id); r.eliminated = true; c.caught = true; } m.finish('lose','allCaught');`);
await sleep(4000);
st = await snap('F revive vs match end:');
await shot(page, 's4-F');

// G: pause with platform pause, then hide/show tab
if (st.screen === 'result-card') { await click(page, '#tomenu'); await sleep(800); }
await newMatch();
await page.keyboard.press('Escape');
await sleep(300);
await page.evaluate(() => { window.__platform.setPause('platform', true); window.__platform.setPause('platform', false); });
await sleep(300);
st = await snap('G user pause survives platform resume:');
await page.keyboard.press('Escape');
await sleep(300);
// hidden tab for 5s then back: sim must not fast-forward
const t0 = await scene(page, `return m.time`);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
await sleep(3000);
const t1 = await scene(page, `return m.time`);
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
await sleep(1000);
const t2 = await scene(page, `return m.time`);
log('G hidden 3s: sim time advanced while hidden =', (t1 - t0).toFixed(2), 's; 1s after return =', (t2 - t1).toFixed(2));
log('errors:', (await state(page)).errors, logs.filter((l) => !l.includes('GL Driver') && !l.includes('404')).slice(0, 10));
await browser.close();
