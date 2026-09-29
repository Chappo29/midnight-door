// Verification of the minor-fix pass (RA-01..RA-08) on the rebuilt ZIP.
import { serve, launch, open, sleep, sc, click, has, waitSel, out, progress, host, ylog, gameInfo, snap, passMenuIntro, startMatch, toNight, playTutorial, shot, SAVE_MATCH1, SAVE_VET } from './lib.mjs';
const srv = await serve(5199);
const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{23E9}-\u{23F3}\u{FE0F}]/u;
const scan = (page) => page.evaluate((src) => {
  const re = new RegExp(src, 'u'); const found = [];
  for (const n of document.querySelectorAll('#ui *, body > .tut-dim *, .tut-hand, .tut-bubble, .tut-guide *')) { const t = [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(''); if (re.test(t)) found.push('DOM:' + t.slice(0, 40)); }
  const g = window.__pgame; for (const s of g.scene.getScenes(false)) { for (const c of s.children.list) if (c.type === 'Text' && re.test(c.text)) found.push('PHASER:' + c.text); }
  return found;
}, EMOJI.source);

// 1. tutorial: pointer svg, bubble text without emoji
{
  const { page, ctx } = await open(b, srv.url, { prof: 't17a' });
  await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 });
  const found = new Set(); let handKinds = new Set();
  // play the tutorial and scan every 2 s
  const t = (async () => { const steps = await playTutorial(page); return steps; })();
  const scanner = (async () => { for (let i = 0; i < 45; i++) { await sleep(2000); try { (await scan(page)).forEach((f) => found.add(f)); handKinds.add(await page.evaluate(() => { const h = document.querySelector('.tut-hand'); return h ? (h.querySelector('svg') ? 'svg' : 'text:' + h.textContent) : 'none'; })); } catch (e) {} } })();
  const steps = await t; out('tutorial steps', steps.length, 'emoji found during tutorial:', JSON.stringify([...found]), 'hand kinds:', JSON.stringify([...handKinds]));
  await shot(page, 't17-tutorial-done');
  await ctx.close();
}
// 2. matches: emoji in Phaser texts / DOM during a match with builds, sells, upgrades
{
  const { page, ctx } = await open(b, srv.url, { prof: 't17b', save: SAVE_VET, mock: { interstitial: 'notshown', advDelay: 50 } });
  await passMenuIntro(page); await startMatch(page); await toNight(page); await sleep(500);
  const found = new Set();
  await sc(page, "const r = m.playerRoom; r.candy = 9999; r.flame = 999; for (const c of m.placeableCells(r, 'cannon').slice(0, 3)) s.cmd({ type: 'build', kind: 'cannon', x: c.x, y: c.y });");
  await sc(page, "for (let k = 0; k < 200; k++) { m.step(); s.handleEvents(m.events); } s.cmd({ type: 'upgradeDoor' }); s.cmd({ type: 'upgradeSofa' });");
  for (let i = 0; i < 6; i++) { await sleep(300); (await scan(page)).forEach((f) => found.add(f)); }
  // open the build menu on a cannon and on the sofa/floor, sell
  const menuTexts = [];
  const cells = await sc(page, "const r = m.playerRoom; return { cannon: r.buildings.find(b => b.kind==='cannon'), sofa: { x: r.sofa.x, y: r.sofa.y } }");
  const { cellXY } = await import('./lib.mjs');
  for (const c of [cells.cannon, cells.sofa]) { if (!c) continue; const p = await cellXY(page, c.x, c.y); await sleep(1200); await page.mouse.click(p.x, p.y); await sleep(600); menuTexts.push(await page.evaluate(() => document.querySelector('#menu')?.innerText.replace(/\s+/g, ' ').slice(0, 160))); (await scan(page)).forEach((f) => found.add(f)); await page.keyboard.press('Escape'); await sleep(300); await sc(page, 's.hud.hideMenu(); s.userPaused = false; s.hud.hideScreen();'); }
  out('MATCH emoji found:', JSON.stringify([...found]), '| menu texts:', JSON.stringify(menuTexts));
  await shot(page, 't17-match');
  await ctx.close();
}
// 3. drag + cloud card + auth flow
{
  host.reset();
  const { page, ctx } = await open(b, srv.url, { prof: 't17c', save: SAVE_VET, authState: false, mock: { authDelay: 500 } });
  await passMenuIntro(page);
  const bad = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.draggable && getComputedStyle(i).getPropertyValue('-webkit-user-drag') !== 'none').length);
  const c0 = await page.evaluate(() => { const i = document.querySelector('.menu-mascot img'); const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.evaluate(() => { window.__ds = []; document.addEventListener('dragstart', (e) => window.__ds.push(e.defaultPrevented)); });
  await page.mouse.move(c0.x, c0.y); await page.mouse.down(); await page.mouse.move(c0.x + 200, c0.y - 100, { steps: 8 }); await page.mouse.up();
  out('DRAG: draggable imgs without user-drag none =', bad, '| dragstart events (prevented?)', JSON.stringify(await page.evaluate(() => window.__ds)));
  await click(page, '#metaCloud'); await sleep(700);
  out('CLOUD tap 1 -> card:', (await gameInfo(page)).screenCard, 'buttons', (await gameInfo(page)).buttons.join(','), 'openAuthDialog calls', (await ylog(page)).filter((e) => e.ev === 'openAuthDialog').length);
  await shot(page, 't17-cloud-card');
  await sleep(1200); await click(page, '#cloudNo'); await sleep(1200);
  out('  after "Не сейчас": screen', (await gameInfo(page)).screenCard, 'dialogs', (await ylog(page)).filter((e) => e.ev === 'openAuthDialog').length, 'btn present', await has(page, '#metaCloud'));
  await click(page, '#metaCloud'); await sleep(1300); await click(page, '#cloudYes'); await sleep(100); await page.mouse.click(5, 5).catch(() => {}); await sleep(3500);
  out('  after "Войти": dialogs', (await ylog(page)).filter((e) => e.ev === 'openAuthDialog').length, 'cloud rev', host.cloud.t17c?.save?.rev, 'btn present', await has(page, '#metaCloud'), 'screen', (await gameInfo(page)).screenCard);
  await ctx.close();
}
await b.close(); srv.close();
