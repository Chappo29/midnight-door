import { serve, launch, open, ylog, gameInfo, shot, sleep, host, SAVE_MATCH1, sc, click, has, waitSel, gp, audioState, out, toNight, winNow, progress, catchPlayer, startMatch, passMenuIntro } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const coins = async (p) => (await progress(p))?.progress.meta.coins;
// ---- A. interstitial modes
for (const mode of ['ok', 'error', 'notshown', 'silent']) {
  host.reset();
  const { page, ctx } = await open(b, srv.url, { prof: 'a-' + mode, save: SAVE_MATCH1, mock: { interstitial: mode, advDur: 1500, advDelay: 500 } });
  await passMenuIntro(page);
  const t0 = Date.now(); const l0 = (await ylog(page)).length;
  await startMatch(page);
  await page.waitForFunction(() => { const s = window.__pgame.scene.getScene('game'); return window.__pgame.scene.isActive('game') && s.m; }, null, { timeout: 30000 });
  const dt = Date.now() - t0;
  await sleep(400);
  const ev = (await ylog(page)).slice(l0).filter((e) => e.ev !== 'emit').map((e) => `${e.ev}${e.kind ? ':' + e.kind : ''}@${e.t}`);
  out(`INTERSTITIAL ${mode}`.padEnd(24), `match visible after ${dt}ms`, ev.join(' '), 'gp=' + (await gp(page)), 'errs=' + JSON.stringify(await page.evaluate(() => window.__errors)));
  await ctx.close();
}
// ---- B. rewarded x2 modes
for (const mode of ['reward', 'earlyclose', 'error', 'silent']) {
  host.reset();
  const { page, ctx } = await open(b, srv.url, { prof: 'b-' + mode, save: SAVE_MATCH1, mock: { rewarded: mode, advDur: 1500, advDelay: 500 } });
  await passMenuIntro(page); await startMatch(page); await toNight(page); await sleep(800); await winNow(page);
  await waitSel(page, '#screen.show #again', 30000); await sleep(1400);
  const c0 = await coins(page); const t0 = Date.now(); const l0 = (await ylog(page)).length;
  await click(page, '#double');
  await sleep(200);
  const disabledDuring = await page.evaluate(() => [...document.querySelectorAll('#screen button')].map((b) => b.disabled));
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('#screen button')]; return b.length && !b.some((x) => x.disabled); }, null, { timeout: 30000 }).catch(() => {});
  const dt = Date.now() - t0;
  const ev = (await ylog(page)).slice(l0).filter((e) => e.ev !== 'emit').map((e) => `${e.ev}${e.kind ? ':' + e.kind : ''}`);
  out(`REWARDED x2 ${mode}`.padEnd(24), `unlocked after ${dt}ms`, 'buttons disabled during ad:', disabledDuring.join(','), 'coins Δ=' + ((await coins(page)) - c0), 'double btn present=' + (await has(page, '#double')), ev.join(' '));
  await ctx.close();
}
// ---- C. caught -> revive for ad
for (const mode of ['reward', 'earlyclose', 'error']) {
  host.reset();
  const { page, ctx } = await open(b, srv.url, { prof: 'c-' + mode, save: SAVE_MATCH1, mock: { rewarded: mode, advDur: 1500, advDelay: 500 } });
  await passMenuIntro(page); await startMatch(page); await toNight(page); await sleep(800);
  await catchPlayer(page); await sleep(1500);
  const g = await gameInfo(page);
  out(`CAUGHT ${mode}`.padEnd(24), 'card=' + g.screenCard, 'buttons=' + g.buttons.join(','), 'gp=' + (await gp(page)));
  if (mode === 'reward') await shot(page, 't3-caught');
  await sleep(1300);
  if (await has(page, '#revive')) {
    const l0 = (await ylog(page)).length;
    await click(page, '#revive'); await sleep(200); await click(page, '#revive');
    await sleep(5000);
    const st = await sc(page, `return { spirit: m.player.spirit, caught: m.player.caught, reviveUsed: m.reviveUsed, paused: s.caughtPaused }`);
    const ev = (await ylog(page)).slice(l0).filter((e) => e.ev !== 'emit').map((e) => `${e.ev}${e.kind ? ':' + e.kind : ''}`);
    const g2 = await gameInfo(page);
    out('   after revive click:', JSON.stringify(st), 'card=' + g2.screenCard, 'gp=' + (await gp(page)), ev.join(' '));
  }
  await ctx.close();
}
await b.close(); srv.close();
