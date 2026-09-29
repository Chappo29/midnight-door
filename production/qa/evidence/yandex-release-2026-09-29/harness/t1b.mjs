import { serve, launch, open, ylog, gameInfo, shot, sleep, host, SAVE_MATCH1, sc, click, has, waitSel, gp, setHidden, audioState } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const out = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const { page, logs } = await open(b, srv.url, { prof: 't1b', save: SAVE_MATCH1, mock: { advDur: 2500, advDelay: 600 } });
const st = async (label) => {
  const g = await gameInfo(page); const paused = await page.evaluate(() => { const s = window.__pgame.scene.getScene('game'); return s && window.__pgame.scene.isActive('game') ? { user: s.userPaused, hidden: s.hiddenPaused, caught: s.caughtPaused, ended: s.ended, t: +s.m.nightTime.toFixed(2), phase: s.m.phase, ghostHp: Math.round(s.m.ghost.hp) } : null; });
  out(label.padEnd(30), 'gp=' + (await gp(page)), 'card=' + g.screenCard, paused ? JSON.stringify(paused) : '', 'rms=' + (await audioState(page)).rms?.toFixed(4));
};
await waitSel(page, '#screen.show'); await sleep(1200);
await click(page, '#dailyClaim'); await sleep(1400); if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1300); }
await st('menu');
// ---- start easy with interstitial
const before = (await ylog(page)).length;
await click(page, '.diff-btn[data-d="easy"]');
await sleep(300); await st('300ms after tap (ad requested)');
await sleep(600); await st('ad open (900ms)');
await sleep(2600); await st('ad closed');
const evs = (await ylog(page)).slice(before); out('EVENTS', evs);
await sleep(800);
// ---- enter night
await sc(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`); await sleep(700);
await sc(page, `m.phaseLeft = 0.05;`); await sleep(1200);
await st('night running');
const t0 = await sc(page, 'return m.nightTime');
// ---- platform pause
await page.evaluate(() => window.__emit('game_api_pause')); await sleep(2500);
await st('platform pause +2.5s');
await page.evaluate(() => window.__emit('game_api_resume')); await sleep(1000);
await st('platform resume +1s');
// ---- user pause then platform pause/resume
await click(page, '#pause'); await sleep(600); await st('user pause');
await page.evaluate(() => window.__emit('game_api_pause')); await sleep(600); await st('user+platform pause');
await page.evaluate(() => window.__emit('game_api_resume')); await sleep(1500); await st('after platform resume (must stay paused)');
await shot(page, 't1b-userpause');
await click(page, '#resume'); await sleep(1000); await st('user resume');
// ---- hidden tab
await setHidden(page, true); await sleep(2500); await st('tab hidden +2.5s');
await setHidden(page, false); await sleep(1000); await st('tab visible +1s');
out('EVENTS2', (await ylog(page)).slice(before + evs.length));
out('logs', logs.filter(l=>!/GL Driver|ReadPixels/.test(l)), await page.evaluate(() => window.__errors));
await b.close(); srv.close();
