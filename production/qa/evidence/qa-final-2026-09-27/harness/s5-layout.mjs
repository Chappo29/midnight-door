// S5: every screen on phone/tablet/desktop sizes — buttons on screen and not covered; rotation mid-match; tap hitbox.
import { launch, open, state, shot, click, sleep, until, scene } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const today = new Date().toISOString().slice(0, 10);
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, wins: { easy: 3, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins: 900, daily: { step: 1, last: '' }, tutorialGift: true, boosters: { candy: 1 } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'justUnlocked' }, settings: { muted: true } } });

/** All visible buttons of the current UI: off-screen or covered by something else? */
async function audit(page, label) {
  const r = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    const bad = [];
    const scroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) return p; } return null; };
    for (const b of document.querySelectorAll('#ui button, #ui .chip')) {
      const cs = getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden' || b.closest('.hidden') || b.offsetParent === null) continue;
      const rc = b.getBoundingClientRect();
      if (rc.width < 2 || rc.height < 2) continue;
      const name = b.id || b.dataset.opt || b.dataset.d || b.className.split(' ')[0];
      const off = rc.left < -1 || rc.top < -1 || rc.right > W + 1 || rc.bottom > H + 1;
      if (off) { const sc = scroller(b); bad.push(`${name}: off-screen ${Math.round(rc.left)},${Math.round(rc.top)}-${Math.round(rc.right)},${Math.round(rc.bottom)}${sc ? ' (scrollable parent)' : ' (NO scroll)'}`); continue; }
      const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (b.tagName === 'BUTTON' && hit && !b.contains(hit) && !hit.contains(b)) bad.push(`${name}: covered by ${hit.id || hit.className || hit.tagName}`);
      if (b.tagName === 'BUTTON' && (rc.width < 40 || rc.height < 40) && !b.classList.contains('unlock-dot')) bad.push(`${name}: small ${Math.round(rc.width)}x${Math.round(rc.height)}`);
    }
    const c = window.__game.canvas.getBoundingClientRect();
    return { bad, canvas: [Math.round(c.width), Math.round(c.height)], vp: [W, H], docScroll: [document.documentElement.scrollWidth > W, document.documentElement.scrollHeight > H] };
  });
  log(`  [${label}] canvas ${r.canvas} vp ${r.vp} pageScroll ${r.docScroll}`, r.bad.length ? r.bad : 'OK');
}

const SIZES_ALL = [[390, 844, true], [844, 390, true], [360, 800, true], [800, 360, true], [768, 1024, true], [1280, 720, false], [1366, 768, false], [1920, 1080, false], [2560, 1080, false]];
const SIZES = process.env.SIZES ? SIZES_ALL.filter(([w,h]) => process.env.SIZES.split(",").includes(w+"x"+h)) : SIZES_ALL;
const browser = await launch();
for (const [w, h, touch] of SIZES) {
  log(`== ${w}x${h} ${touch ? 'touch' : 'mouse'}`);
  const { page, ctx } = await open(browser, { w, h, touch, save: VET });
  const tag = `${w}x${h}`;
  const tapSel = (sel) => click(page, sel, { touch });
  await until(page, () => document.querySelector('#screen.show .card, #screen.show .menu-frame'), null, 20000);
  await sleep(700);
  // boot shows unlock preview (fridge) first
  let st = await state(page);
  await audit(page, st.screen); await shot(page, `s5-${tag}-${st.screen}`);
  if (st.screen === 'unlock-card') { await tapSel('#tomenu'); await sleep(1200); st = await state(page); }
  if (st.screen === 'daily-card') { await audit(page, 'daily'); await shot(page, `s5-${tag}-daily`); await tapSel('#dailyClaim'); await sleep(1300); if (await page.$('#dailyClaim')) { await tapSel('#dailyClaim'); await sleep(1200); } }
  await audit(page, 'menu'); await shot(page, `s5-${tag}-menu`);
  await sleep(500); await tapSel('#metaShop'); await sleep(1100);
  await audit(page, 'shop'); await shot(page, `s5-${tag}-shop`);
  // shop tabs
  for (const tab of await page.$$('#screen .shop-tab, #screen [data-tab]')) { await tab.click().catch(() => {}); await sleep(450); }
  await audit(page, 'shop-lasttab');
  await sleep(1100); const close = await page.$('#screen .shop-close');
  if (close) { await close.click(); await sleep(1200); } else { log('  no shop close found'); await page.evaluate(() => document.querySelector('#screen button:last-of-type')?.click()); await sleep(600); }
  await tapSel('#screen.show button[data-d="easy"]');
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await sleep(900);
  await audit(page, 'pick'); await shot(page, `s5-${tag}-pick`);
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep' && !window.__game.scene.getScene('game').m.player.path.length, null, 30000);
  await sleep(1500);
  // hitbox: real tap on an empty buildable cell must select exactly that cell
  const cell = await scene(page, `const r = m.playerRoom; return m.placeableCells(r, 'cannon').find(c => Math.abs(c.x+0.5-m.player.x)+Math.abs(c.y+0.5-m.player.y) > 1.5) || null`);
  const tapCell = async (lbl) => {
    const p = await page.evaluate(([x, y]) => { const s = window.__game.scene.getScene('game'); const cam = s.cameras.main; const c = window.__game.canvas.getBoundingClientRect(); return { x: c.x + ((x + 0.5) * 48 - cam.worldView.x) * cam.zoom, y: c.y + ((y + 0.5) * 48 - cam.worldView.y) * cam.zoom, zoom: cam.zoom }; }, [cell.x, cell.y]);
    const inView = p.x > 0 && p.y > 0 && p.x < w && p.y < h;
    if (!inView) { log(`  [${lbl}] cell off view`, p); return; }
    await sleep(1100);
    if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    await sleep(500);
    const sel = await scene(page, `return s.selected`);
    log(`  [${lbl}] tap cell ${cell.x},${cell.y} at ${Math.round(p.x)},${Math.round(p.y)} zoom ${p.zoom.toFixed(2)} → selected`, sel, sel && sel.x === cell.x && sel.y === cell.y ? 'OK' : 'MISMATCH');
  };
  if (cell) {
    await tapCell('hitbox');
    await audit(page, 'buildmenu'); await shot(page, `s5-${tag}-buildmenu`);
    // rotate mid-match
    await page.setViewportSize({ width: h, height: w });
    await sleep(1200);
    const cv = await page.evaluate(() => { const c = window.__game.canvas.getBoundingClientRect(); return [Math.round(c.width), Math.round(c.height), window.__game.scale.width, window.__game.scale.height]; });
    log(`  rotated to ${h}x${w}: canvas`, cv, 'menuOpen', await scene(page, `return s.hud.menuOpen`));
    await audit(page, 'rotated'); await shot(page, `s5-${tag}-rotated`);
    await page.mouse.click(5, h / 2).catch(() => {});
    await tapCell('hitbox-after-rotate');
    await page.setViewportSize({ width: w, height: h });
    await sleep(1200);
    await tapCell('hitbox-after-rotate-back');
  } else log('  no cell');
  // pause, caught, result
  await scene(page, `s.hud.hideMenu()`);
  await sleep(400);
  await page.keyboard.press('Escape'); await sleep(600);
  await audit(page, 'pause'); await shot(page, `s5-${tag}-pause`);
  await page.keyboard.press('Escape'); await sleep(400);
  await scene(page, `m.phaseLeft = 0.05`); await sleep(600);
  await scene(page, `const c = m.player; const r = m.playerRoom; r.eliminated = true; c.caught = true; m.events.push({ type: 'caught', roomId: r.id, charId: c.id }); m.onEliminated(c);`);
  await sleep(900);
  await audit(page, 'caught'); await shot(page, `s5-${tag}-caught`);
  await tapSel('#spirit'); await sleep(900);
  await audit(page, 'spirit'); await shot(page, `s5-${tag}-spirit`);
  await scene(page, `m.ghost.hp = 0; m.ghost.state='dead'; m.events.push({type:'ghostDead'}); m.teamWin = true; m.finish('win','ghost');`);
  await until(page, () => document.querySelector('#screen.show .result-card'), null, 8000);
  await sleep(900);
  await audit(page, 'result'); await shot(page, `s5-${tag}-result`);
  st = await state(page);
  if (st.errors.length) log('  errors', st.errors);
  await ctx.close();
}
await browser.close();
