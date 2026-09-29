import { launch, open, click, sleep, until, scene, cellXY, shot } from './harness.mjs';
const today = new Date().toISOString().slice(0, 10);
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 9, tutorial: 'done', hints: [], meta: { coins: 10, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });
const browser = await launch();
for (const [w, h, touch] of [[1280, 720, false], [844, 390, true], [390, 844, true], [1920, 1080, false]]) {
  const { page, ctx } = await open(browser, { w, h, touch, save: VET });
  await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
  await sleep(500);
  await click(page, '#screen.show button[data-d="easy"]', { touch });
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  let covered = [];
  let rooms = 0;
  // try every free room: pick it, walk in, then check each floor cell of the room for DOM covering it
  const ids = await scene(page, `return m.rooms.filter(r => r.ownerId === null).map(r => r.id)`);
  const rid = ids[0];
  // choose the top-most free room to maximise the chance
  const top = await scene(page, `const free = m.rooms.filter(r => r.ownerId === null); free.sort((a,b) => a.y0 - b.y0); return free[0].id`).catch(() => rid);
  await scene(page, `s.cmd({ type: 'pickRoom', roomId: arg })`, top);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep' && !window.__game.scene.getScene('game').m.player.path.length, null, 30000);
  await scene(page, `m.phaseLeft = 9999`);
  await sleep(1500);
  const res = await page.evaluate(() => {
    const s = window.__game.scene.getScene('game'); const m = s.m; const r = m.playerRoom; const cam = s.cameras.main; const c = window.__game.canvas.getBoundingClientRect();
    const out = [];
    const xs = [], ys = [];
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) {
      if (x < r.x0 || y < r.y0 || x >= r.x0 + r.w || y >= r.y0 + r.h || !r.mask[(y - r.y0) * r.w + (x - r.x0)]) continue;
      const px = c.x + ((x + 0.5) * 48 - cam.worldView.x) * cam.zoom, py = c.y + ((y + 0.5) * 48 - cam.worldView.y) * cam.zoom;
      if (px < 0 || py < 0 || px > innerWidth || py > innerHeight) { out.push(`${x},${y}:offscreen`); continue; }
      const el = document.elementFromPoint(px, py);
      if (el !== window.__game.canvas) out.push(`${x},${y}:${el?.id || el?.className || el?.tagName}`);
    }
    return { y0: r.y0, zoom: cam.zoom.toFixed(2), out };
  });
  console.log(`${w}x${h} room ${top}:`, JSON.stringify(res));
  await shot(page, `s9c-${w}x${h}`);
  await ctx.close();
}
await browser.close();
