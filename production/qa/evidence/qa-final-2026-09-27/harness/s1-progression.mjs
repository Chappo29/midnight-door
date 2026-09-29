// S1: clean save → tutorial (real clicks) → matches 1..5 with unlock previews, reloads between stages.
import { launch, open, state, shot, click, sleep, until, playTutorial, scene } from './harness.mjs';

const out = [];
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); out.push(s); console.log(s); };

const browser = await launch();
let { page, logs } = await open(browser, { save: null });

async function waitScreen(page, name, t = 15000) {
  await until(page, (n) => document.querySelector('#screen.show .' + n), name, t);
  await sleep(450); // input guard
}

/** Pick a free room via real tap and skip prep. */
async function enterNight(page) {
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await sleep(500);
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep', null, 20000);
  await scene(page, `m.phaseLeft = 0.05;`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 20000);
}

async function forceEnd(page, how) {
  if (how === 'win') await scene(page, `m.ghost.hp = 0; m.ghost.state = 'dead'; m.events.push({type:'ghostDead'}); m.finish('win','ghost');`);
  else await scene(page, `for (const c of m.chars) { const r = m.rooms.find(r => r.ownerId === c.id); r.eliminated = true; c.caught = true; } m.finish('lose','allCaught');`);
}

// ---- tutorial
await until(page, () => window.__game.scene.isActive('game'), null, 20000);
let st = await state(page);
log('boot clean:', { tut: st.tut, step: st.step, coins: st.coins, tutorial: st.tutorial });
const t0 = Date.now();
const steps = await playTutorial(page);
log('tutorial steps passed:', steps.join('>'), 'in', Math.round((Date.now() - t0) / 1000) + 's');
await waitScreen(page, 'card', 60000).catch(() => {});
st = await state(page);
log('after tutorial:', { screen: st.screen, buttons: st.buttons, coins: st.coins, tutorial: st.tutorial, matches: st.matches });
await shot(page, 's1-tutorial-done');

// reload on tutorial-done screen: tutorial must not restart, gift must not repeat
await page.reload();
await until(page, () => window.__save && document.querySelector('#screen.show'), null, 20000);
await sleep(600);
st = await state(page);
log('reload after tutorial:', { screen: st.screen, coins: st.coins, tutorial: st.tutorial, active: st.active });
// close daily if shown
if (st.screen && st.buttons.includes('dailyClaim')) {
  await click(page, '#dailyClaim');
  await sleep(1300);
  st = await state(page);
  log('daily claimed:', { coins: st.coins, screen: st.screen, buttons: st.buttons });
  if (st.buttons.includes('dailyClaim')) { await click(page, '#dailyClaim'); await sleep(600); }
}
st = await state(page);
log('menu:', { screen: st.screen, buttons: st.buttons });
await shot(page, 's1-menu');

const expect = ['pumpkin', 'trap', 'workbench', 'fridge'];
for (let n = 1; n <= 5; n++) {
  st = await state(page);
  const diffBtn = st.buttons.find((b) => /easy|diff-easy|d-easy/.test(b)) || null;
  if (st.buttons.includes('tut') || !st.active) {
    const btn = await page.$('#screen.show button[data-d="easy"], #screen.show [data-diff="easy"], #screen.show #easy');
    if (!btn) { log('cannot find easy button; buttons=', st.buttons); const html = await page.$eval('#screen', (e) => e.innerHTML.slice(0, 1500)); log(html); break; }
    await btn.click();
  }
  await enterNight(page);
  const before = await state(page);
  await forceEnd(page, n === 3 ? 'lose' : 'win');
  await waitScreen(page, 'result-card', 20000);
  st = await state(page);
  const pill = await page.$('.unlock-pill');
  log(`match ${n}:`, { matches: st.matches, wins: st.wins, coinsDelta: st.coins - before.coins, unlocks: st.unlocks, pill: !!pill, buttons: st.buttons });
  await shot(page, `s1-result-${n}`);
  // reload on result screen → preview must still come (and only once)
  if (n === 2) {
    await page.reload();
    await until(page, () => window.__save && document.querySelector('#screen.show'), null, 20000);
    await sleep(600);
    st = await state(page);
    log(' reload on result:', { screen: st.screen, buttons: st.buttons, matches: st.matches, coins: st.coins });
    if (st.screen === 'unlock-card') { await click(page, '#tomenu'); await sleep(600); }
    st = await state(page);
    if (st.buttons.includes('dailyClaim')) { await click(page, '#dailyClaim'); await sleep(600); }
    continue;
  }
  await click(page, '#again');
  await sleep(700);
  st = await state(page);
  log(' after again:', { screen: st.screen, buttons: st.buttons });
  if (st.screen === 'unlock-card') {
    const name = await page.$eval('.unlock-name', (e) => e.textContent);
    log(' preview:', name);
    await shot(page, `s1-unlock-${n}`);
    await click(page, '#try');
    await sleep(500);
  }
  // interstitial (fake) may be up for 2s
  await sleep(2600);
}
st = await state(page);
log('final:', { matches: st.matches, unlocks: st.unlocks, coins: st.coins, errors: st.errors });
log('console:', logs.slice(0, 20));
await browser.close();
