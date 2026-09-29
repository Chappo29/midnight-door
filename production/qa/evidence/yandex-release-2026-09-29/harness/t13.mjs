// Tutorial robustness on the production ZIP (moderator-style first run).
import { serve, launch, open, sleep, sc, click, has, waitSel, out, progress, host, ylog, gameInfo, playTutorial, shot } from './lib.mjs';
const srv = await serve(5199);
const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const stepNow = (page) => page.evaluate(() => { const s = window.__pgame.scene.getScene('game'); return window.__pgame.scene.isActive('game') && s.tut ? (s.tut.view()?.step.id ?? 'done') : null; });
const summary = async (page) => { const p = await progress(page); return p ? { tutorial: p.progress.tutorial, matches: p.progress.matches, coins: p.progress.meta.coins, rev: p.rev } : 'no save'; };

// a. reload mid tutorial
{
  const { page, ctx } = await open(b, srv.url, { prof: 't13a' });
  await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 });
  await playTutorial(page, { stopAt: 'cannon' }); out('a. reached step', await stepNow(page), 'save:', JSON.stringify(await summary(page)));
  await page.reload(); await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 }); await sleep(800);
  out('a. after reload: step', await stepNow(page), 'save:', JSON.stringify(await summary(page)));
  await ctx.close();
}
// b. rotation + fast taps + pause during tutorial, then finish
{
  const { page, ctx } = await open(b, srv.url, { w: 844, h: 390, touch: true, prof: 't13b' });
  await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 }); await sleep(600);
  for (let i = 0; i < 12; i++) { await page.touchscreen.tap(422, 195); await sleep(60); }
  out('b. after 12 rapid taps at start: step', await stepNow(page));
  await playTutorial(page, { touch: true, stopAt: 'sofa' });
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(1500);
  out('b. rotated to portrait at step', await stepNow(page)); await shot(page, 't13b-rotated');
  await page.keyboard.press('Escape'); await sleep(1400);
  out('b. paused: card', (await gameInfo(page)).screenCard, 'buttons', (await gameInfo(page)).buttons.join(','));
  await page.keyboard.press('Escape'); await sleep(800);
  const steps = await playTutorial(page, { touch: true }); out('b. finished remaining steps:', steps.join('>'));
  await waitSel(page, '#screen.show #play', 60000).catch(async () => out('b. NO done screen', JSON.stringify(await gameInfo(page))));
  await sleep(1300); out('b. done screen; save:', JSON.stringify(await summary(page)));
  await ctx.close();
}
// c. skip from pause card
{
  const { page, ctx } = await open(b, srv.url, { prof: 't13c' });
  await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 }); await sleep(1500);
  await page.keyboard.press('Escape'); await sleep(1400);
  out('c. pause card buttons', (await gameInfo(page)).buttons.join(','));
  await click(page, '#skiptut'); await sleep(2500);
  const g = await gameInfo(page);
  out('c. after skip: match active', g.active, 'tutorial flag', await sc(page, 'return !!m.opts.tutorial'), 'save:', JSON.stringify(await summary(page)));
  await ctx.close();
}
// d. finish, then replay from menu: no second gift, no match count change
{
  const { page, ctx } = await open(b, srv.url, { prof: 't13d' });
  await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 });
  await playTutorial(page); await waitSel(page, '#screen.show #play', 60000); await sleep(1400);
  const s1 = await summary(page); out('d. first completion:', JSON.stringify(s1));
  await page.reload(); await waitSel(page, '#screen.show'); await sleep(1400);
  if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1400); if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1300); } }
  const s2 = await summary(page); out('d. after reload + daily:', JSON.stringify(s2));
  await click(page, '#tut'); await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 });
  await playTutorial(page); await waitSel(page, '#screen.show #play', 60000); await sleep(1400);
  const s3 = await summary(page); out('d. after replay:', JSON.stringify(s3), 'coins delta vs before replay:', s3.coins - s2.coins, 'matches delta', s3.matches - s2.matches, 'tutorial', s3.tutorial);
  await ctx.close();
}
await b.close(); srv.close();
