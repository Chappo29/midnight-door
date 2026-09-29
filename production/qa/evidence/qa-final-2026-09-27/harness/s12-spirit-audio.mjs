// S12: spirit spam/end-right-after-spirit; audio mute spam, music after hide/show & rematch; blur/focus.
import { launch, open, state, click, sleep, until, scene, cellXY } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const today = new Date().toISOString().slice(0, 10);
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 9, tutorial: 'done', hints: [], meta: { coins: 0, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: false } } });
const browser = await launch();
const { page, logs } = await open(browser, { save: VET });
await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
await sleep(2500);
await page.evaluate(() => (window.__platform.fake = { show: () => Promise.resolve(true) }));
const audio = () => page.evaluate(() => {
  const snd = window.__game.sound.sounds;
  const mgr = window.__game.sound;
  return { playing: snd.filter((x) => x.isPlaying).map((x) => x.key), total: snd.length, masterGain: mgr.masterMuteNode?.gain.value, muted: window.__sfx.muted, saved: window.__save.store.progress.settings.muted, icon: document.querySelector('#sound')?.innerHTML.includes('off') ? 'off' : 'on' };
});
log('menu audio:', await audio());

async function toNight() {
  await click(page, '#screen.show button[data-d="easy"]');
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep' && !window.__game.scene.getScene('game').m.player.path.length, null, 30000);
  await scene(page, `m.phaseLeft = 0.05`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 20000);
}
await toNight();
await sleep(1500);
log('in match audio:', await audio());
// mute spam x11 (odd → muted)
for (let i = 0; i < 11; i++) { await click(page, '#sound').catch(() => {}); await sleep(40); }
await sleep(400);
log('mute x11 (odd):', await audio());
for (let i = 0; i < 11; i++) { await click(page, '#sound').catch(() => {}); await sleep(40); }
await sleep(400);
log('mute x22 (even):', await audio());


// hide/show tab 3 times
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(600);
  if (i === 0) log('  hidden: audio', await audio(), 'platform paused', await page.evaluate(() => window.__platform.paused));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(600);
}
log('after 3x hide/show:', await audio());
// blur/focus
await page.evaluate(() => { window.dispatchEvent(new Event('blur')); });
await sleep(1000);
const t0 = await scene(page, `return m.time`);
await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
await sleep(1000);
const t1 = await scene(page, `return m.time`);
log('blur/focus: sim advanced in 1s after focus =', (t1 - t0).toFixed(2), 'audio', await audio());

// spirit: catch, go spirit, spam boo/spark and field taps, then end right away
await scene(page, `s.debugAdvance(20); const c = m.player; const r = m.playerRoom; r.eliminated = true; c.caught = true; m.events.push({ type: 'caught', roomId: r.id, charId: c.id }); m.onEliminated(c);`);
await until(page, () => document.querySelector('#screen.show .caught-card'), null, 5000);
await sleep(450);
await click(page, '#spirit');
await sleep(500);
// fly near the ghost so boo is available
await scene(page, `const gh = m.ghost; if (gh.state === 'hidden') { gh.state = 'moving'; } m.player.x = gh.x; m.player.y = gh.y;`);
await sleep(300);
const booBtn = await page.$('#boo');
const bb = await booBtn.boundingBox();
for (let i = 0; i < 8; i++) { await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(60); }
const afterBoo = await scene(page, `return { booCd: +m.player.booCd.toFixed(1), held: +m.ghost.held.toFixed(1), toast: document.querySelector('#toast')?.textContent }`);
log('spirit boo x8:', afterBoo);
const sp = await page.$('#spark'); const sb = await sp.boundingBox();
for (let i = 0; i < 6; i++) { await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); await sleep(60); }
log('spirit spark x6:', await scene(page, `return { sparkCd: +m.player.sparkCd.toFixed(1), toast: document.querySelector('#toast')?.textContent }`));
// field taps as spirit: 10 random, position stays finite and in map
for (let i = 0; i < 10; i++) { await page.mouse.click(100 + i * 100, 150 + (i % 4) * 120); await sleep(80); }
await sleep(1500);
log('spirit taps:', await scene(page, `return { x: +m.player.x.toFixed(2), y: +m.player.y.toFixed(2), flyTo: m.player.flyTo }`));
// all neighbours caught while spirit → lose → result, one end
await scene(page, `window.__ends = 0; const e = s.gd.onEnd; s.gd.onEnd = () => { window.__ends++; e(); }; for (const c of m.chars) { if (c.isPlayer || c.caught) continue; const r = m.rooms.find(r => r.ownerId === c.id); r.eliminated = true; c.caught = true; m.events.push({ type: 'caught', roomId: r.id, charId: c.id }); m.onEliminated(c); }`);
await until(page, () => document.querySelector('#screen.show .result-card'), null, 8000);
await sleep(1500);
const st = await state(page);
log('spirit → all caught:', { screen: st.screen, result: st.result, ends: await page.evaluate(() => window.__ends), title: await page.$eval('.result-card h1', (e) => e.textContent) });
log('audio on result:', await audio());
// rematch x3 → music instances
for (let i = 0; i < 3; i++) {
  await click(page, '#tomenu'); await sleep(1300);
  await toNight(); await sleep(800);
  await scene(page, `m.ghost.hp = 0; m.ghost.state='dead'; m.events.push({type:'ghostDead'}); m.finish('win','ghost');`);
  await until(page, () => document.querySelector('#screen.show .result-card'), null, 8000); await sleep(1200);
}
log('after 3 more matches, on result:', await audio());
await click(page, '#tomenu'); await sleep(2000);
log('menu again:', await audio());
log('errors', (await state(page)).errors, logs.filter((l) => !l.includes('GL Driver') && !l.includes('404')).slice(0, 5));
await browser.close();
