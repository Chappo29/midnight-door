// S15: UX-16 — build menu on low landscape phones: every option (incl. fridge) fully visible without scrolling.
import { launch, open, click, sleep, until, scene, cellXY, shot } from './harness.mjs';

const today = new Date().toISOString().slice(0, 10);
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 9, tutorial: 'done', hints: [], meta: { coins: 0, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });
const SIZES = process.env.ONLY ? [[844, 390, true], [800, 360, true]] : [[844, 390, true], [800, 360, true], [390, 844, true], [1280, 720, false]];
const browser = await launch();
for (const [w, h, touch] of SIZES) {
  const { page, ctx } = await open(browser, { w, h, touch, save: VET });
  await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
  await sleep(600);
  await shot(page, `s15-${w}x${h}-mainmenu`);
  await page.evaluate(() => (window.__platform.fake = { show: () => Promise.resolve(true) }));
  await click(page, '#screen.show button[data-d="easy"]', { touch });
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep' && !window.__game.scene.getScene('game').m.player.path.length, null, 30000);
  await scene(page, `m.phaseLeft = 9999`);
  await sleep(1200);
  // try up to 4 empty cells: the menu opens next to the tapped cell, so test several positions
  const cells = await scene(page, `const r = m.playerRoom; return m.placeableCells(r, 'cannon').filter(c => Math.abs(c.x+0.5-m.player.x)+Math.abs(c.y+0.5-m.player.y) > 1.5).slice(0, 4)`);
  const results = [];
  for (const c of cells) {
    const p = await cellXY(page, c.x, c.y);
    if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
    if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    await sleep(700);
    const r = await page.evaluate(() => {
      const menu = document.getElementById('menu');
      if (!menu || menu.style.display !== 'block') return { open: false };
      const body = menu.querySelector('.menu-body');
      const mr = menu.getBoundingClientRect();
      const opts = [...menu.querySelectorAll('[data-opt]')].map((o) => {
        const b = o.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        const inWin = b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth;
        return `${o.dataset.opt.replace('build:', '')}${inWin && o.contains(hit) ? '' : '(HIDDEN)'}`;
      });
      return { open: true, menu: [Math.round(mr.top), Math.round(mr.bottom)], scroll: body.scrollHeight > body.clientHeight + 1, opts: opts.join(' ') };
    });
    results.push(`${c.x},${c.y}: ${JSON.stringify(r)}`);
    if (results.length === 1) await shot(page, `s15-${w}x${h}-buildmenu`);
    await page.mouse.click(5, h - 5); // close
    await sleep(1200);
  }
  console.log(`== ${w}x${h}`);
  for (const l of results) console.log('  ' + l);
  await ctx.close();
}
await browser.close();
