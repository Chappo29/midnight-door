import { serve, launch, open, ylog, gameInfo, shot, sleep, host, sc, click, has, waitSel, gp, out, progress, snap, passMenuIntro } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const allOpen = { pumpkin: 'available', trap: 'available', workbench: 'available', fridge: 'available' };
const P = (coins, matches) => ({ matches, wins: { easy: matches, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins }, unlocks: allOpen, settings: { muted: false } });
const cases = [
  { name: 'A guest -> auth, cloud empty', cloud: null, authResult: 'ok' },
  { name: 'B guest(rev12) -> auth, cloud older(rev5)', cloud: snap(P(50, 1), 5, 500), authResult: 'ok' },
  { name: 'C guest(rev12) -> auth, cloud newer(rev40)', cloud: snap(P(900, 8), 40, 4000), authResult: 'ok' },
  { name: 'D guest -> auth cancelled', cloud: null, authResult: 'cancel' },
];
for (const c of cases) {
  host.reset();
  const prof = 't5c' + c.name[0];
  if (c.cloud) host.cloud[prof] = { save: JSON.parse(c.cloud) };
  const { page, ctx } = await open(b, srv.url, { prof, save: snap(P(300, 4), 12, 1200), authState: false, mock: { authResult: c.authResult, authDelay: 800 } });
  await passMenuIntro(page);
  const L0 = await ylog(page);
  out(c.name, '| boot: openAuthDialog=' + L0.filter((e) => e.ev === 'openAuthDialog').length, 'cloudBtn=' + (await has(page, '#metaCloud')), 'setData=' + (host.setCalls[prof] || []).length);
  if (c === cases[0]) await shot(page, 't5c-menu-guest');
  await click(page, '#metaCloud'); await sleep(150); await click(page, '#metaCloud').catch(() => {}); await sleep(200); await click(page, '#metaCloud').catch(() => {});
  await sleep(4000);
  const L = await ylog(page); const pr = await progress(page); const cl = host.cloud[prof]?.save;
  out('   dialogs=' + L.filter((e) => e.ev === 'openAuthDialog').length, `local rev ${pr.rev} coins ${pr.progress.meta.coins}`, `cloud: ${cl ? 'rev ' + cl.rev + ' coins ' + cl.progress.meta.coins : 'empty'}`, 'cloudBtn now=' + (await has(page, '#metaCloud')), 'ui=' + (await gameInfo(page)).screenCard, 'toast=' + (await page.evaluate(() => document.querySelector('#toastScreen')?.textContent)), 'keys=' + (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('midnight')).join(','))));
  await ctx.close();
}
// two devices
host.reset();
{
  const prof = 't5cE';
  const A = await open(b, srv.url, { prof, save: snap(P(100, 2), 10, 1000), authState: true });
  await sleep(3000);
  out('E dev A booted: cloud rev', host.cloud[prof]?.save?.rev);
  const ctxB = await b.newContext({ viewport: { width: 1280, height: 720 } }); await ctxB.addCookies([{ name: 'prof', value: prof, url: srv.url }]);
  const B = await open(b, srv.url, { prof, ctx: ctxB, authState: true });
  await sleep(3000);
  let prB = await progress(B.page); out('E dev B (fresh) after boot: rev', prB?.rev, 'coins', prB?.progress.meta.coins, 'tutorial', prB?.progress.tutorial);
  // B plays a match
  await passMenuIntro(B.page);
  await click(B.page, '.diff-btn[data-d="easy"]'); await B.page.waitForFunction(() => window.__pgame.scene.isActive('game'), null, { timeout: 30000 });
  const { toNight, winNow } = await import('./lib.mjs');
  await toNight(B.page); await sleep(500); await winNow(B.page); await waitSel(B.page, '#screen.show #again', 30000); await sleep(6500);
  prB = await progress(B.page); out('E dev B after match: rev', prB.rev, 'coins', prB.progress.meta.coins, 'cloud rev', host.cloud[prof]?.save?.rev, 'coins', host.cloud[prof]?.save?.progress.meta.coins, 'setData B', (host.setCalls[prof] || []).length);
  // A comes back: emulate hidden -> visible after >60s? refresh throttled to 60s; wait it out via clock is heavy; just do visibility cycle now and then again later
  await A.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(2000);
  let prA = await progress(A.page); out('E dev A returns (<60s since boot, throttled): rev', prA.rev, 'coins', prA.progress.meta.coins);
  await sleep(60000);
  await A.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(2500);
  prA = await progress(A.page); out('E dev A returns (>60s): rev', prA.rev, 'coins', prA.progress.meta.coins, 'ui', (await gameInfo(A.page)).screenCard);
}
await b.close(); srv.close();
