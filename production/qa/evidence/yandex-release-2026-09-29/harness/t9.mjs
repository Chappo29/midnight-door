// Performance / sim-rate / leaks on the production bundle.
import { serve, launch, open, sleep, sc, click, has, waitSel, out, SAVE_VET, passMenuIntro, startMatch, toNight, winNow, host } from './lib.mjs';
const srv = await serve(5199);
const b = await launch(['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc']);
const which = process.env.PART || 'all';

// ---- A. initial load: bytes and time-to-menu (no throttle, then fast 3G)
if (which === 'all' || which === 'A') {
  for (const [name, net] of [['unthrottled', null], ['fast3G(1.6Mbps,150ms)', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }], ['slow4G(9Mbps,170ms)', { offline: false, latency: 170, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (9 * 1024 * 1024) / 8 }]]) {
    host.reset();
    const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await ctx.addCookies([{ name: 'prof', value: 't9a' + name.length, url: srv.url }]);
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.__MOCK = {}; window.__errors = []; });
    await page.addInitScript(() => { let v; Object.defineProperty(window, 'Phaser', { configurable: true, get: () => v, set(x) { v = x; if (x && x.Game && !x.Game.__h) { const G = x.Game; x.Game = class extends G { constructor(c) { super(c); window.__pgame = this; } }; x.Game.__h = 1; } } }); });
    await ctx.addInitScript((s) => localStorage.setItem('midnight-door-progress', s), SAVE_VET);
    let bytes = 0, files = 0; const byType = {};
    page.on('response', async (r) => { try { const buf = await r.body(); bytes += buf.length; files++; const t = (r.url().match(/\.(\w+)$/) || [, 'other'])[1]; byType[t] = (byType[t] || 0) + buf.length; } catch (e) {} });
    if (net) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', net); }
    const t0 = Date.now();
    await page.goto(srv.url);
    await page.waitForFunction(() => document.querySelector('#screen.show') && document.getElementById('boot')?.classList.contains('off'), null, { timeout: 180000 });
    const tMenu = Date.now() - t0; const bytesAtMenu = bytes; const filesAtMenu = files;
    await sleep(net ? 30000 : 4000);
    out(`LOAD ${name}`.padEnd(28), `menu interactive after ${(tMenu / 1000).toFixed(1)}s, transferred at that moment ${(bytesAtMenu / 1048576).toFixed(1)} MB / ${filesAtMenu} files; total later ${(bytes / 1048576).toFixed(1)} MB / ${files} files`, JSON.stringify(Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, +(v / 1048576).toFixed(2)]))));
    await ctx.close();
  }
}

// ---- B. simulation rate vs wall clock under CPU throttling (60 s of night target, sampled inside the page)
if (which === 'all' || which === 'B') {
  for (const rate of [1, 4, 6]) {
    const { page, ctx } = await open(b, srv.url, { prof: 't9b' + rate, save: SAVE_VET, w: 844, h: 390, touch: true, mock: { interstitial: 'notshown', advDelay: 50 } });
    if (rate > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate }); }
    await passMenuIntro(page); await startMatch(page); await toNight(page);
    // sample every 500 ms: wall clock vs nightTime + fps
    await page.evaluate(() => { const g = window.__pgame; const s = g.scene.getScene('game'); window.__samples = []; const t0 = performance.now(); const n0 = s.m.nightTime; window.__sampler = setInterval(() => window.__samples.push({ w: (performance.now() - t0) / 1000, n: s.m.nightTime - n0, fps: g.loop.actualFps }), 500); });
    await sleep(45000);
    const r = await page.evaluate(() => { clearInterval(window.__sampler); const S = window.__samples; const last = S[S.length - 1]; const win = 10; const rates = []; for (let i = 0; i + win * 2 < S.length; i += 2) rates.push((S[i + win * 2].n - S[i].n) / (S[i + win * 2].w - S[i].w)); return { wall: last.w, sim: last.n, ratio: last.n / last.w, minWindowRatio: Math.min(...rates), maxWindowRatio: Math.max(...rates), fpsAvg: S.reduce((a, x) => a + x.fps, 0) / S.length }; });
    out(`SIM RATE cpu x${rate}`.padEnd(22), `wall ${r.wall.toFixed(1)}s sim ${r.sim.toFixed(1)}s ratio ${r.ratio.toFixed(3)} (10s windows: min ${r.minWindowRatio.toFixed(3)} max ${r.maxWindowRatio.toFixed(3)}) fps avg ${r.fpsAvg.toFixed(1)}`);
    await ctx.close();
  }
}

// ---- C. 10 matches in a row: leak counters
if (which === 'all' || which === 'C') {
  const { page, ctx } = await open(b, srv.url, { prof: 't9c', save: SAVE_VET, w: 844, h: 390, touch: false, mock: { interstitial: 'notshown', advDelay: 50 } });
  await page.evaluate(() => { window.__lst = { add: {}, rem: {} }; const wrap = (obj, nm) => { const a = obj.addEventListener.bind(obj), r = obj.removeEventListener.bind(obj); obj.addEventListener = (t, f, o) => { window.__lst.add[nm + t] = (window.__lst.add[nm + t] || 0) + 1; return a(t, f, o); }; obj.removeEventListener = (t, f, o) => { window.__lst.rem[nm + t] = (window.__lst.rem[nm + t] || 0) + 1; return r(t, f, o); }; }; wrap(window, 'win:'); wrap(document, 'doc:'); });
  await passMenuIntro(page);
  const snap = () => page.evaluate(() => { window.gc && window.gc(); const g = window.__pgame; const s = g.scene.getScene('game'); const lst = window.__lst; const live = {}; for (const k of Object.keys(lst.add)) { const d = lst.add[k] - (lst.rem[k] || 0); if (d) live[k] = d; } return { heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), dom: document.getElementsByTagName('*').length, sounds: g.sound.sounds.length, textures: g.textures.getTextureKeys().length, sceneChildren: s.children.length, tweens: s.tweens.getTweens().length, timers: s.time._active ? s.time._active.length : -1, liveListeners: live }; });
  const base = await snap(); out('LEAK base', JSON.stringify(base));
  for (let i = 1; i <= 10; i++) {
    if (!(await page.evaluate(() => window.__pgame.scene.isActive('game')))) await startMatch(page);
    await toNight(page);
    // build a bunch of stuff in the player room and let 60 sim-seconds pass with real scene code
    await sc(page, "const r = m.playerRoom; r.candy = 9999; r.flame = 999; const cells = m.placeableCells(r, 'cannon'); for (const c of cells.slice(0, 12)) s.cmd({ type: 'build', kind: 'cannon', x: c.x, y: c.y });");
    await page.evaluate(async () => { const s = window.__pgame.scene.getScene('game'); const m = s.m; for (let k = 0; k < 1200 && m.phase !== 'end'; k++) { m.step(); s.handleEvents(m.events); if (s.caughtPaused) { s.caughtPaused = false; s.hud.hideScreen(); } } });
    await sleep(600);
    await winNow(page); await waitSel(page, '#screen.show #again', 60000); await sleep(1400);
    if (i % 3 === 0) { await click(page, '#tomenu'); await sleep(1500); if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1400); } await sleep(800); } else { await click(page, '#again'); await sleep(1500); for (let k = 0; k < 3; k++) { if (await has(page, '#try')) { await click(page, '#try'); await sleep(300); } } }
    const s2 = await snap(); out(`LEAK after match ${i}`.padEnd(20), JSON.stringify(s2));
  }
  out('errors', JSON.stringify(await page.evaluate(() => window.__errors)));
  await ctx.close();
}
await b.close(); srv.close();
