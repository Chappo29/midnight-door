import { serve, launch, open, sleep, out, SAVE_VET, SAVE_MATCH1, host } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
for (const [label, save] of [['returning player (menu)', SAVE_VET], ['first run (tutorial)', undefined]]) {
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  await ctx.addCookies([{ name: 'prof', value: 't16' + label.length, url: srv.url }]);
  await ctx.addInitScript(() => { let v; Object.defineProperty(window, 'Phaser', { configurable: true, get: () => v, set(x) { v = x; if (x && x.Game && !x.Game.__h) { const G = x.Game; x.Game = class extends G { constructor(c) { super(c); window.__pgame = this; } }; x.Game.__h = 1; } } }); window.__MOCK = {}; });
  if (save) await ctx.addInitScript((s) => localStorage.setItem('midnight-door-progress', s), save);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: 90000 });
  const t0 = Date.now(); await page.goto(srv.url);
  const tl = [];
  let lastKey = '';
  for (let i = 0; i < 160; i++) {
    const s = await page.evaluate(() => { const g = window.__pgame; const scr = document.getElementById('screen'); return { boot: !document.getElementById('boot')?.classList.contains('off'), menu: !!scr && scr.classList.contains('show'), ready: (window.__ylog || []).some((e) => e.ev === 'ready'), sprites: g ? g.textures.exists('mascot_wave') && g.textures.exists('char0') : false, tut: !!g && g.scene.isActive('game') }; }).catch(() => null);
    if (s) { const key = JSON.stringify(s); if (key !== lastKey) { tl.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${key}`); lastKey = key; } }
    if (s && s.ready && s.sprites) break;
    await sleep(500);
  }
  out(`TIMELINE (1.6 Mbps) ${label}:`); tl.forEach((l) => out('   ' + l));
  await ctx.close();
}
await b.close(); srv.close();
