// S14: live — Yandex SDK answering after 6 s (QA-08); two-finger pinch in tutorial vs normal match (QA-09).
import { launch, open, state, click, sleep, until, scene, playTutorial } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const today = new Date().toISOString().slice(0, 10);
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, tutorial: 'done', hints: [], meta: { coins: 0, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });
const browser = await launch();

// ---- QA-08: late SDK
{
  const { page, ctx } = await (async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => {
      window.__ya = [];
      const log = (x) => window.__ya.push([Math.round(performance.now()), x]);
      const sdk = {
        environment: { i18n: { lang: 'ru' } },
        features: { LoadingAPI: { ready: () => log('ready') }, GameplayAPI: { start: () => log('gp:start'), stop: () => log('gp:stop') } },
        adv: {
          showFullscreenAdv: ({ callbacks }) => { log('fullscreen'); setTimeout(() => { callbacks.onOpen?.(); setTimeout(() => callbacks.onClose?.(true), 300); }, 200); },
          showRewardedVideo: ({ callbacks }) => { log('rewarded'); callbacks.onClose?.(false); },
        },
        getPlayer: async () => ({ isAuthorized: () => false, getData: async () => ({}), setData: async () => {} }),
        getStorage: async () => localStorage,
        auth: { openAuthDialog: async () => {} },
        on: (ev) => log('on:' + ev),
      };
      window.YaGames = { init: () => new Promise((r) => setTimeout(() => { log('init-resolved'); r(sdk); }, 6000)) };
    });
    await ctx.addInitScript((s) => { if (!localStorage.getItem('__qa_seeded')) { localStorage.clear(); localStorage.setItem('__qa_seeded', '1'); localStorage.setItem('midnight-door-progress', s); } }, VET);
    const page = await ctx.newPage();
    await page.goto('http://localhost:5190/');
    return { page, ctx };
  })();
  await page.waitForFunction(() => document.querySelector('#screen.show button[data-d="easy"]'), null, { timeout: 30000 });
  const t0 = await page.evaluate(() => Math.round(performance.now()));
  log('QA-08 menu shown at', t0, 'ms, SDK calls so far:', await page.evaluate(() => window.__ya));
  await sleep(4000);
  log('   after SDK arrived:', await page.evaluate(() => window.__ya));
  await click(page, '#screen.show button[data-d="easy"]');
  await sleep(2500);
  const st = await page.evaluate(() => ({ active: window.__game.scene.isActive("game"), phase: window.__game.scene.getScene("game")?.m?.phase }));
  log('   start match (matches≥1 → interstitial through the late SDK):', await page.evaluate(() => window.__ya.map((x) => x[1])), 'active', st.active, 'phase', st.phase);
  await ctx.close();
}

// ---- QA-09: pinch in tutorial (touch) via CDP
async function pinch(page, cx, cy) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) });
  for (let d = 40; d <= 160; d += 20) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) }); await sleep(30); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
}
{
  const { page, ctx } = await open(browser, { w: 390, h: 844, touch: true, save: null });
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').tut, null, 20000);
  await playTutorial(page, { touch: true, stopAt: 'cannon' });
  await sleep(500);
  const z0 = await scene(page, `return +s.cameras.main.zoom.toFixed(3)`);
  await pinch(page, 195, 500);
  const z1 = await scene(page, `return { zoom: +s.cameras.main.zoom.toFixed(3), step: s.tut?.view()?.step.id, pinch: s.pinch.active }`);
  log('QA-09 tutorial pinch: zoom before', z0, '→ after', z1);
  // Tutorial still completes after the pinch attempt
  const steps = await playTutorial(page, { touch: true });
  await until(page, () => document.querySelector('#screen.show .card'), null, 60000).catch(() => {});
  log('   tutorial finished after pinch:', steps.join('>'), (await state(page)).screen);
  // Normal match: pinch zooms
  await sleep(1300);
  await click(page, '#play', { touch: true });
  await until(page, () => window.__game.scene.isActive('game') && !window.__game.scene.getScene('game').m.opts.tutorial, null, 20000);
  await sleep(1500);
  const n0 = await scene(page, `return +s.cameras.main.zoom.toFixed(3)`);
  await pinch(page, 195, 500);
  log('   normal match pinch: zoom', n0, '→', await scene(page, `return +s.cameras.main.zoom.toFixed(3)`));
  log('   errors', (await state(page)).errors);
  await ctx.close();
}
await browser.close();
