import { serve, launch, open, ylog, gameInfo, shot, sleep, host, SAVE_VET, sc, click, has, waitSel, gp, out, progress, toNight, winNow, startMatch, passMenuIntro, setHidden, audioState } from './lib.mjs';
const srv = await serve(5199);
const music = (page) => page.evaluate(() => { const g = window.__pgame; return g.sound.sounds.filter((s) => s.key.startsWith('bgm_')).map((s) => `${s.key}:${s.isPlaying ? 'play' : s.isPaused ? 'paused' : 'stop'}`); });
// ---- 1. locked audio (no autoplay flag): no gesture until click
{
  const b = await launch([]); // autoplay policy default -> audio locked until gesture
  const { page, ctx, logs } = await open(b, srv.url, { prof: 't6a', save: SAVE_VET });
  await waitSel(page, '#screen.show'); await sleep(2500);
  out('LOCKED before gesture: ctx', JSON.stringify((await audioState(page)).ctx), 'locked=', await page.evaluate(() => window.__pgame.sound.locked), 'music', JSON.stringify(await music(page)));
  await click(page, '#dailyClaim'); await sleep(1500);
  out('LOCKED after 1st click: ctx', JSON.stringify((await audioState(page)).ctx), 'locked=', await page.evaluate(() => window.__pgame.sound.locked), 'music', JSON.stringify(await music(page)), 'rms', (await audioState(page)).rms.toFixed(4));
  out('  errs', JSON.stringify(await page.evaluate(() => window.__errors)), logs.filter(l=>!/GL Driver|ReadPixels|AudioContext was not allowed/.test(l)));
  await b.close();
}
const b = await launch(['--autoplay-policy=no-user-gesture-required']);
// ---- 2. blur-only (other window in front) and mute persistence
{
  const { page, ctx } = await open(b, srv.url, { prof: 't6b', save: SAVE_VET, mock: { advDur: 1500, advDelay: 400 } });
  await passMenuIntro(page); await sleep(1000);
  out('MENU  rms', (await audioState(page)).rms.toFixed(4), 'music', JSON.stringify(await music(page)));
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await sleep(1500);
  const a1 = await audioState(page); await sleep(500); const a2 = await audioState(page);
  out('window blur only (tab still visible): ctx', JSON.stringify(a1.ctx), 'rms', a1.rms.toFixed(4), '->', a2.rms.toFixed(4), 'gp', await gp(page));
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1500);
  out('focus back: ctx', JSON.stringify((await audioState(page)).ctx), 'rms', (await audioState(page)).rms.toFixed(4), 'music', JSON.stringify(await music(page)));
  // mute toggle in menu
  out('mute button in menu present:', await has(page, '#metaSound'));
  await click(page, '#metaSound'); await sleep(1200);
  out('after mute click: rms', (await audioState(page)).rms.toFixed(4), 'saved muted=', (await progress(page)).progress.settings.muted);
  // ad while muted
  await startMatch(page); await sleep(1500); // ad opens ~400ms after call
  await page.waitForFunction(() => window.__pgame.scene.isActive('game'), null, { timeout: 20000 }); await sleep(2000);
  out('match started while muted: rms', (await audioState(page)).rms.toFixed(4), 'music', JSON.stringify(await music(page)));
  await page.reload(); await waitSel(page, '#screen.show'); await sleep(2500);
  out('reload (muted persisted): rms', (await audioState(page)).rms.toFixed(4), 'saved muted=', (await progress(page)).progress.settings.muted, 'music', JSON.stringify(await music(page)));
  await ctx.close();
}
// ---- 3. music duplicates after many transitions (unmuted)
{
  const { page, ctx } = await open(b, srv.url, { prof: 't6c', save: SAVE_VET, mock: { advDur: 1200, advDelay: 300 } });
  await passMenuIntro(page);
  for (let i = 0; i < 3; i++) {
    await startMatch(page); await page.waitForFunction(() => window.__pgame.scene.isActive('game'), null, { timeout: 30000 });
    await toNight(page); await sleep(500);
    await page.evaluate(() => window.__emit('game_api_pause')); await sleep(300); await page.evaluate(() => window.__emit('game_api_resume'));
    await setHidden(page, true); await sleep(300); await setHidden(page, false); await sleep(500);
    await winNow(page); await waitSel(page, '#screen.show #again', 30000); await sleep(1400);
    await click(page, '#tomenu'); await sleep(1800);
    if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1400); }
    out(`cycle ${i}: music`, JSON.stringify(await music(page)), 'rms', (await audioState(page)).rms.toFixed(4), 'ctx', JSON.stringify((await audioState(page)).ctx));
  }
  out('  errs', JSON.stringify(await page.evaluate(() => window.__errors)));
  await ctx.close();
}
await b.close(); srv.close();
