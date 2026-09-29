// S2: destructive double taps on end/exit buttons, ad-latency window, ESC after rematches, listener leaks.
import { launch, open, state, shot, click, sleep, until, scene } from './harness.mjs';

const out = [];
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); out.push(s); console.log(s); };

// A veteran save: tutorial done, 5 matches, everything unlocked, some coins & boosters.
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, wins: { easy: 3, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins: 500, heroes: ['boy'], hero: 'boy', skins: { door: ['classic'], cannon: ['classic'] }, skin: { door: 'classic', cannon: 'classic' }, boosters: {}, daily: { step: 1, last: '2099-01-01' }, tutorialGift: true }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });

const browser = await launch();
const { page, logs } = await open(browser, { save: VET });
await until(page, () => document.querySelector('#screen.show button[data-d="easy"], #dailyClaim'), null, 20000);
await sleep(500);
while (await page.$('#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1400); }
await sleep(500);

// Instrument: count scene starts, match objects, onEnd/onMenu calls, coin changes.
await page.evaluate(() => {
  const g = window.__game;
  window.__qa.starts = 0;
  const orig = g.scene.start.bind(g.scene);
  g.scene.start = (k, d) => { if (k === 'game') window.__qa.starts++; return orig(k, d); };
  // Simulate real SDK latency: ad overlay does not cover the page for 1.5 s (no DOM overlay at all).
  window.__platform.fake = { show: () => new Promise((r) => setTimeout(() => r(true), 1500)) };
});
const starts = () => page.evaluate(() => window.__qa.starts);

async function toNight() {
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await sleep(400);
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep', null, 20000);
  await scene(page, `m.phaseLeft = 0.05;`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 20000);
  await scene(page, `s.debugAdvance(20)`); // some night time so exit reward > 0
}
const win = () => scene(page, `m.ghost.hp = 0; m.ghost.state = 'dead'; m.events.push({type:'ghostDead'}); m.finish('win','ghost');`);

// ---- A: menu difficulty double click (ad latency window)
let s0 = await starts();
const easy = await page.$('#screen.show button[data-d="easy"]');
const b = await easy.boundingBox();
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
await sleep(120);
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
await sleep(2500);
log('A menu easy x2 (120ms): scene starts =', (await starts()) - s0, (await state(page)).phase);

// ---- B: result "Ещё раз" double click during ad latency
await toNight();
await win();
await until(page, () => document.querySelector('#screen.show .result-card'), null, 10000);
await sleep(500);
let st = await state(page);
s0 = await starts();
const coins0 = st.coins;
await click(page, '#again');
await sleep(500); // > guard 350 ms, ad not visible yet
await click(page, '#again').catch((e) => log('B second click failed:', e.message));
await sleep(3500);
st = await state(page);
log('B result again x2 (500ms): scene starts =', (await starts()) - s0, 'coins delta', st.coins - coins0, 'phase', st.phase, 'screen', st.screen);

// ---- C: result "Ещё раз" then "Меню" during ad latency
await toNight();
await win();
await until(page, () => document.querySelector('#screen.show .result-card'), null, 10000);
await sleep(500);
s0 = await starts();
await click(page, '#again');
await sleep(400);
await click(page, '#tomenu').catch((e) => log('C menu click failed:', e.message));
await sleep(600);
let mid = await state(page);
await sleep(2500);
st = await state(page);
log('C again→menu (400ms): mid screen', mid.screen, '| final: active', st.active, 'screen', st.screen, 'phase', st.phase, 'starts', (await starts()) - s0);
await shot(page, 's2-C-final');

// ---- D: pause → "Выйти в меню" double click (exit coins twice?)
if (!st.active || st.screen) {
  if (st.screen === 'menu-frame') await click(page, '#screen.show button[data-d="easy"]');
  await sleep(2000);
}
await toNight();
await page.keyboard.press('Escape');
await sleep(500);
st = await state(page);
const exitPill = await page.$eval('#screen #tomenu', (e) => e.textContent).catch(() => '?');
const c0 = st.coins;
const bx = await (await page.$('#screen #tomenu')).boundingBox();
await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2);
await sleep(80);
await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2);
await sleep(600);
await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2);
await sleep(1500);
st = await state(page);
log('D pause→menu x3:', { pill: exitPill, coinsDelta: st.coins - c0, active: st.active, screen: st.screen, phase: st.phase });

// ---- E: ESC toggles after N rematches (listener duplication)
const counts0 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__qa.add)));
for (let i = 0; i < 6; i++) {
  st = await state(page);
  if (st.screen === 'menu-frame') await click(page, '#screen.show button[data-d="easy"]');
  await toNight();
  await win();
  await until(page, () => document.querySelector('#screen.show .result-card'), null, 10000);
  await sleep(450);
  await click(page, '#tomenu');
  await sleep(700);
}
await click(page, '#screen.show button[data-d="easy"]');
await toNight();
await page.keyboard.press('Escape');
await sleep(300);
st = await state(page);
log('E after 7 matches ESC once → userPaused =', st.paused?.user, 'screen', st.screen);
await page.keyboard.press('Escape');
await sleep(300);
st = await state(page);
log('E ESC twice → userPaused =', st.paused?.user, 'screen', st.screen);
const counts1 = await page.evaluate(() => ({ add: window.__qa.add, remove: window.__qa.remove }));
const diff = {};
for (const [k, v] of Object.entries(counts1.add)) diff[k] = `${v - (counts0[k] || 0)} added / ${counts1.remove[k] || 0} removed(total)`;
log('E listener deltas over 7 matches:', diff);
const objs = await scene(page, `return { children: s.children.list.length, tweens: s.tweens.getTweens().length, timers: s.time._active?.length ?? null, sounds: g.sound.sounds.length, kbEvents: s.input.keyboard.eventNames().map(n => n + ':' + s.input.keyboard.listenerCount(n)), inputEvents: s.input.eventNames().map(n => n + ':' + s.input.listenerCount(n)), scaleResize: s.scale.listenerCount('resize'), gameEvents: g.events.eventNames().map(n => n + ':' + g.events.listenerCount(n)).join(',') }`);
log('E scene objects:', objs);
log('errors:', (await state(page)).errors, logs.filter((l) => !l.includes('GL Driver')).slice(0, 10));
await browser.close();
