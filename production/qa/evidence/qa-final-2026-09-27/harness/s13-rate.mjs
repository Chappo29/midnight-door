import { launch, open, click, sleep, until, scene } from './harness.mjs';
const today = new Date().toISOString().slice(0, 10);
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 9, tutorial: 'done', hints: [], meta: { coins: 0, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });
const browser = await launch();
for (const [w, h] of [[1280, 720], [390, 844]]) {
  const { page, ctx } = await open(browser, { w, h, save: VET });
  await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
  await sleep(500);
  await page.evaluate(() => (window.__platform.fake = { show: () => Promise.resolve(true) }));
  await click(page, '#screen.show button[data-d="easy"]');
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await sleep(1000);
  const r = await page.evaluate(async () => {
    const s = window.__game.scene.getScene('game');
    const loop = window.__game.loop;
    const t0 = s.m.time, w0 = performance.now(), f0 = loop.frame;
    await new Promise((r) => setTimeout(r, 4000));
    return { simPerWall: ((s.m.time - t0) / ((performance.now() - w0) / 1000)).toFixed(2), fps: ((loop.frame - f0) / 4).toFixed(1), actualFps: loop.actualFps.toFixed(1), delta: loop.delta.toFixed(1), rawDelta: loop.rawDelta.toFixed(1), smooth: loop.smoothStep, targetFps: loop.targetFps, limit: loop.fpsLimit };
  });
  console.log(`${w}x${h}`, JSON.stringify(r));
  await ctx.close();
}
await browser.close();
