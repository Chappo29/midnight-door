import { serve, launch, open, ylog, gameInfo, shot, sleep, host, SAVE_MATCH1, sc, click, has, waitSel, gp, setHidden, audioState } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const out = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const { page, logs } = await open(b, srv.url, { prof: 't1', save: SAVE_MATCH1, mock: { advDur: 2500, advDelay: 600 } });
const st = async (label) => {
  const g = await gameInfo(page); const paused = await page.evaluate(() => { const s = window.__pgame.scene.getScene('game'); return s && window.__pgame.scene.isActive('game') ? { user: s.userPaused, hidden: s.hiddenPaused, caught: s.caughtPaused, ended: s.ended, t: s.m.nightTime, phase: s.m.phase } : null; });
  out(label.padEnd(34), 'gp=' + (await gp(page)), 'card=' + g.screenCard, 'phase=' + g.phase, paused ? JSON.stringify(paused) : '', 'audio=', JSON.stringify(await audioState(page)));
};
await waitSel(page, '#screen.show'); await sleep(1200);
await st('1 menu (daily card)');
await click(page, '#dailyClaim'); await sleep(1500);
await st('2 after daily claim');
if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1300); await st('2b claim again'); }
await click(page, '#metaShop'); await sleep(1200); await st('3 shop');
await shot(page, 't1-shop');
await page.keyboard.press('Escape'); await sleep(300);
const closeSel = await page.evaluate(() => [...document.querySelectorAll('#screen button')].map(b=>b.id||b.className));
out('shop buttons', closeSel);
await b.close(); srv.close();
