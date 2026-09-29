import { serve, launch, open, sleep, shot, out } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
for (const [w, h, touch] of [[844, 390, false], [844, 390, true], [1280, 720, false], [2560, 1080, false], [390, 844, true]]) {
  const { page, ctx } = await open(b, srv.url, { prof: 't19', w, h, touch });
  await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 }); await sleep(2500);
  const r = await page.evaluate(() => { const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }; }; return { pause: q('#pause'), sound: q('#sound'), skip: q('.tut-skip') }; });
  out(`${w}x${h} ${touch ? 'touch' : 'mouse'}`, JSON.stringify(r), 'right-edge diff skip vs sound:', r.skip.r - r.sound.r, 'gap sound->skip:', r.skip.t - r.sound.b);
  await shot(page, `t19-${w}x${h}${touch ? 't' : 'm'}`);
  await ctx.close();
}
await b.close(); srv.close();
