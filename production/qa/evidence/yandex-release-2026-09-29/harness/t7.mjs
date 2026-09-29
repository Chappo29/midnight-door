import { serve, launch, open, sleep, sc, click, has, catchPlayer } from './lib.mjs';
import fs from 'fs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const SAVE = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, wins: { easy: 3, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins: 900, daily: { step: 1, last: '' }, tutorialGift: true, boosters: { candy: 1 } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'justUnlocked' }, settings: { muted: true } } });
const SHOTS = process.env.RC_SHOTS2 || 'C:/Users/bitse/AppData/Local/Temp/claude/C--Users-bitse-Desktop-projects-ghost-on-door/1c342518-5275-477e-b2c1-ec5cfa2a0782/scratchpad/shots7/';
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, n) => page.screenshot({ path: SHOTS + n + '.png' });
const summary = [];

async function audit(page, label, tag) {
  const r = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight; const bad = [];
    const vis = (b) => { const cs = getComputedStyle(b); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const rc = b.getBoundingClientRect(); return rc.width >= 2 && rc.height >= 2; };
    const scroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) return p; } return null; };
    const btns = [...document.querySelectorAll('#ui button, #ui .chip')].filter(vis);
    for (const b of btns) {
      const rc = b.getBoundingClientRect(); const name = b.id || b.dataset.opt || b.dataset.d || b.className.split(' ')[0];
      if (rc.left < -1 || rc.top < -1 || rc.right > W + 1 || rc.bottom > H + 1) { const sc = scroller(b); bad.push(name + ': OFF-SCREEN ' + Math.round(rc.left) + ',' + Math.round(rc.top) + '-' + Math.round(rc.right) + ',' + Math.round(rc.bottom) + (sc ? ' (scrollable parent)' : ' (NO scroll)')); continue; }
      const hit = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2);
      if (b.tagName === 'BUTTON' && hit && !b.contains(hit) && !hit.contains(b)) bad.push(name + ': COVERED by ' + (hit.id || hit.className || hit.tagName));
      const tx = b.querySelector('.meta-label, .cost') || b;
      if (tx.scrollWidth > tx.clientWidth + 2 && getComputedStyle(tx).overflow !== 'visible') bad.push(name + ': TEXT-CLIP ' + tx.scrollWidth + '>' + tx.clientWidth);
    }
    const screen = document.getElementById('screen');
    if (screen && screen.classList.contains('show')) {
      const sb = [...screen.querySelectorAll('button')].filter(vis);
      for (let i = 0; i < sb.length; i++) for (let j = i + 1; j < sb.length; j++) { if (sb[i].contains(sb[j]) || sb[j].contains(sb[i])) continue; const a = sb[i].getBoundingClientRect(), c = sb[j].getBoundingClientRect(); const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top); if (ox > 3 && oy > 3) bad.push('OVERLAP ' + (sb[i].id || sb[i].className.split(' ')[0]) + ' x ' + (sb[j].id || sb[j].className.split(' ')[0]) + ' (' + Math.round(ox) + 'x' + Math.round(oy) + ')'); }
      const card = screen.querySelector('.card, .menu-frame');
      if (card) { const sc2 = [card, ...card.querySelectorAll('*')].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2); if (sc2) bad.push('SCROLL inside ' + (sc2.className.split(' ')[0] || sc2.tagName) + ' (' + sc2.scrollHeight + '>' + sc2.clientHeight + ')'); }
    }
    const c = window.__pgame.canvas.getBoundingClientRect();
    const de = document.documentElement, bd = document.body;
    return { bad, canvas: [Math.round(c.width), Math.round(c.height)], pageScroll: [Math.max(de.scrollWidth, bd.scrollWidth) > W, Math.max(de.scrollHeight, bd.scrollHeight) > H] };
  });
  console.log('  [' + label + '] canvas ' + r.canvas + ' pageScroll ' + r.pageScroll + ' ' + (r.bad.length ? 'ISSUES: ' + JSON.stringify(r.bad) : 'OK'));
  summary.push({ tag, label, bad: r.bad, pageScroll: r.pageScroll });
}

const SIZES = [[844, 390, true], [800, 360, true], [740, 360, true], [667, 375, true], [390, 844, true], [360, 800, true], [768, 1024, true], [1024, 768, true], [1280, 720, false], [1366, 768, false], [1920, 1080, false], [2560, 1080, false], [2560, 1000, false]];
const only = process.env.SIZES ? process.env.SIZES.split(',') : null;
const cardOf = (page) => page.evaluate(() => { const e = document.querySelector('#screen .card, #screen .menu-frame'); return e ? e.className.split(' ').filter((c) => /card|frame/.test(c)).pop() : null; });
for (const [w, h, touch] of SIZES) {
  const tag = w + 'x' + h;
  if (only && !only.includes(tag)) continue;
  console.log('== ' + tag + ' ' + (touch ? 'touch' : 'mouse'));
  const { page, ctx } = await open(b, srv.url, { w, h, touch, save: SAVE, prof: 't7' + tag, mock: { advDelay: 300, advDur: 500 } });
  const tapSel = async (sel) => { const el = await page.$(sel); const bx = await el.boundingBox(); if (touch) await page.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); else await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); };
  await page.waitForFunction(() => document.querySelector('#screen.show .card, #screen.show .menu-frame'), null, { timeout: 30000 }); await sleep(900);
  let card = await cardOf(page);
  await audit(page, card, tag); await shot(page, tag + '-' + card);
  if (card === 'unlock-card') { await tapSel('#tomenu'); await sleep(1300); card = await cardOf(page); }
  if (card === 'daily-card') { await audit(page, 'daily', tag); await shot(page, tag + '-daily'); await tapSel('#dailyClaim'); await sleep(1400); if (await has(page, '#dailyClaim')) { await tapSel('#dailyClaim'); await sleep(1300); } }
  await audit(page, 'menu', tag); await shot(page, tag + '-menu');
  await tapSel('#metaShop'); await sleep(1300);
  await audit(page, 'shop', tag); await shot(page, tag + '-shop');
  const ntabs = (await page.$$('#screen .shop-tab')).length;
  for (let i = 1; i < ntabs; i++) { const tb = await (await page.$$('#screen .shop-tab'))[i].boundingBox(); if (touch) await page.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2); else await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2); await sleep(600); await audit(page, 'shop-tab' + i, tag); await shot(page, tag + '-shop-tab' + i); }
  await sleep(1100); await tapSel('#screen .shop-close'); await sleep(1400);
  await tapSel('#screen.show button[data-d="easy"]');
  await page.waitForFunction(() => window.__pgame.scene.isActive('game') && window.__pgame.scene.getScene('game').m && window.__pgame.scene.getScene('game').m.phase === 'pick', null, { timeout: 30000 }); await sleep(1000);
  await audit(page, 'pick', tag); await shot(page, tag + '-pick');
  await sc(page, "const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });");
  await page.waitForFunction(() => { const m = window.__pgame.scene.getScene('game').m; return m.phase === 'prep' && !m.player.path.length; }, null, { timeout: 40000 }); await sleep(1500);
  await audit(page, 'prep-HUD', tag); await shot(page, tag + '-prep');
  const cell = await sc(page, "const r = m.playerRoom; return m.placeableCells(r, 'cannon').find(c => Math.abs(c.x+0.5-m.player.x)+Math.abs(c.y+0.5-m.player.y) > 1.5) || null");
  const tapCell = async (lbl) => {
    const p = await page.evaluate(([x, y]) => { const s = window.__pgame.scene.getScene('game'); const cam = s.cameras.main; const c = window.__pgame.canvas.getBoundingClientRect(); return { x: c.x + ((x + 0.5) * 48 - cam.worldView.x) * cam.zoom, y: c.y + ((y + 0.5) * 48 - cam.worldView.y) * cam.zoom, zoom: cam.zoom }; }, [cell.x, cell.y]);
    const vp = page.viewportSize(); if (!(p.x > 0 && p.y > 0 && p.x < vp.width && p.y < vp.height)) { console.log('  [' + lbl + '] cell OFF VIEW ' + JSON.stringify(p)); summary.push({ tag, label: lbl, bad: ['cell off view'] }); return; }
    await sleep(1100); if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); await sleep(500);
    const sel = await sc(page, 'return s.selected'); const ok = sel && sel.x === cell.x && sel.y === cell.y;
    console.log('  [' + lbl + '] tap cell ' + cell.x + ',' + cell.y + ' zoom ' + p.zoom.toFixed(2) + ' -> selected ' + JSON.stringify(sel) + ' ' + (ok ? 'OK' : 'MISMATCH')); if (!ok) summary.push({ tag, label: lbl, bad: ['tap mismatch'] });
  };
  if (cell) {
    await tapCell('hitbox'); await audit(page, 'buildmenu', tag); await shot(page, tag + '-buildmenu');
    await page.setViewportSize({ width: h, height: w }); await sleep(1300);
    await audit(page, 'rotated (menu should close)', tag); await shot(page, tag + '-rotated');
    await tapCell('hitbox-after-rotate');
    await sc(page, 's.hud.hideMenu()');
    await page.setViewportSize({ width: w, height: h }); await sleep(1300);
    await tapCell('hitbox-after-rotate-back');
  }
  await sc(page, 's.hud.hideMenu()'); await sleep(400);
  await page.keyboard.press('Escape'); await sleep(700); await audit(page, 'pause', tag); await shot(page, tag + '-pause');
  await page.keyboard.press('Escape'); await sleep(500);
  await sc(page, 'm.phaseLeft = 0.05'); await page.waitForFunction(() => window.__pgame.scene.getScene('game').m.phase === 'night', null, { timeout: 40000 }); await sleep(500);
  await audit(page, 'night-HUD', tag); await shot(page, tag + '-night');
  await catchPlayer(page); await sleep(1200);
  await audit(page, 'caught', tag); await shot(page, tag + '-caught');
  await sleep(1000); await tapSel('#spirit'); await sleep(1200);
  await audit(page, 'spirit', tag); await shot(page, tag + '-spirit');
  await sc(page, "m.ghost.hp = 0; m.ghost.state='dead'; m.events.push({type:'ghostDead'}); m.teamWin = true; m.finish('win','ghost');");
  await page.waitForSelector('#screen.show .result-card', { timeout: 20000 }); await sleep(1200);
  await audit(page, 'result(team win)', tag); await shot(page, tag + '-result');
  const errs = await page.evaluate(() => window.__errors); if (errs.length) console.log('  errors', errs);
  await ctx.close();
}
fs.writeFileSync(SHOTS + 'summary.json', JSON.stringify(summary, null, 1));
const issues = summary.filter((s) => s.bad && s.bad.length);
console.log('\nTOTAL audits ' + summary.length + ', with issues ' + issues.length);
issues.forEach((s) => console.log(' ', s.tag, s.label, JSON.stringify(s.bad)));
await b.close(); srv.close();
