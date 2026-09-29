// Browser gestures / selection / context menu / keyboard / offline & cloud failure on the production bundle.
import { serve, launch, open, sleep, sc, click, has, waitSel, out, SAVE_VET, passMenuIntro, startMatch, toNight, winNow, progress, host, ylog, gameInfo } from './lib.mjs';
const srv = await serve(5199);
const b = await launch(['--autoplay-policy=no-user-gesture-required']);

if (!process.env.SKIP1) // ---------- 1. mouse: context menu, selection, drag, wheel scroll (desktop 1280x720)
{
  const { page, ctx, logs } = await open(b, srv.url, { prof: 't10a', save: SAVE_VET, mock: { interstitial: 'notshown', advDelay: 50 } });
  await passMenuIntro(page);
  await page.evaluate(() => { window.__cm = []; window.addEventListener('contextmenu', (e) => window.__cm.push({ prevented: e.defaultPrevented, t: e.target.id || e.target.tagName + '.' + String(e.target.className).slice(0, 20) })); window.__ds = []; document.addEventListener('dragstart', (e) => window.__ds.push({ prevented: e.defaultPrevented, t: e.target.tagName })); });
  const menuTargets = [[640, 200], [640, 430], [140, 610], [1230, 40]];
  for (const [x, y] of menuTargets) await page.mouse.click(x, y, { button: 'right' });
  out('MENU right-clicks (title, diff btn, mascot, top icon):', JSON.stringify(await page.evaluate(() => window.__cm)));
  // text selection by triple click + drag over title and card texts
  await page.mouse.click(640, 190, { clickCount: 3 }); await page.mouse.move(300, 100); await page.mouse.down(); await page.mouse.move(1000, 600, { steps: 8 }); await page.mouse.up();
  await page.keyboard.press('Control+A');
  out('MENU selection after triple-click/drag/Ctrl+A:', JSON.stringify(await page.evaluate(() => getSelection().toString().slice(0, 40))));
  // image drag
  out('imgs draggable / user-drag:', JSON.stringify(await page.evaluate(() => { const imgs = [...document.querySelectorAll('img')]; const bad = imgs.filter((i) => i.draggable && getComputedStyle(i).getPropertyValue('-webkit-user-drag') !== 'none'); return { total: imgs.length, draggableWithoutBlock: bad.length, sample: bad.slice(0, 3).map((i) => i.className) }; })));
  const c0 = await page.evaluate(() => { const i = document.querySelector('#screen img'); return i ? (() => { const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })() : null; });
  if (c0) { await page.mouse.move(c0.x, c0.y); await page.mouse.down(); await page.mouse.move(c0.x + 200, c0.y + 100, { steps: 6 }); await page.mouse.up(); }
  out('dragstart events after dragging an image in menu:', JSON.stringify(await page.evaluate(() => window.__ds)));
  // page scroll via wheel
  await page.mouse.wheel(0, 900); await sleep(300);
  out('wheel scroll -> scrollY', await page.evaluate(() => [scrollY, document.documentElement.scrollTop, document.body.scrollTop]), 'overscroll', await page.evaluate(() => [getComputedStyle(document.documentElement).overscrollBehavior, getComputedStyle(document.body).overscrollBehavior, getComputedStyle(document.body).userSelect, getComputedStyle(document.body).touchAction]));
  // in match
  await startMatch(page); await toNight(page); await sleep(500);
  await page.evaluate(() => { window.__cm.length = 0; });
  for (const [x, y] of [[640, 360], [300, 300], [60, 60], [1230, 40], [70, 660]]) await page.mouse.click(x, y, { button: 'right' });
  out('MATCH right-clicks (field, field, hud, sound btn, home btn):', JSON.stringify(await page.evaluate(() => window.__cm)));
  await page.mouse.click(640, 360, { clickCount: 3 }); await page.mouse.move(100, 100); await page.mouse.down(); await page.mouse.move(1100, 600, { steps: 8 }); await page.mouse.up();
  out('MATCH selection:', JSON.stringify(await page.evaluate(() => getSelection().toString().slice(0, 40))));
  // keyboard: Escape pause, Space, arrows; Cyrillic-layout WASD via CDP (keyCode 87 with key 'ц')
  await page.keyboard.press('Escape'); await sleep(500);
  const paused1 = await sc(page, 'return s.userPaused'); await page.keyboard.press('Escape'); await sleep(500);
  out('Escape toggles pause:', paused1, '->', await sc(page, 'return s.userPaused'));
  const cdp = await ctx.newCDPSession(page);
  const px0 = await sc(page, 'return [m.player.x, m.player.y]');
  const target = await sc(page, 'const r = m.playerRoom; const p = m.player; return { x: Math.floor(p.x), y: Math.floor(p.y), room: [r.x, r.y] }');
  for (const [keyName, code, vk, txt] of [['ц', 'KeyW', 87, 'ц'], ['ы', 'KeyS', 83, 'ы'], ['ф', 'KeyA', 65, 'ф'], ['в', 'KeyD', 68, 'в']]) {
    const before = await sc(page, 'return [m.player.x, m.player.y, m.player.path.length]');
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', key: keyName, code, text: txt, windowsVirtualKeyCode: vk });
    await sleep(500);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(700);
    const after = await sc(page, 'return [m.player.x, m.player.y, m.player.path.length]');
    out(`  Russian layout key '${keyName}' (${code}): player ${JSON.stringify(before.map((n) => +n.toFixed(2)))} -> ${JSON.stringify(after.map((n) => +n.toFixed(2)))}`);
  }
  out('console/page errors:', JSON.stringify(logs.filter((l) => !/GL Driver|ReadPixels/.test(l))), JSON.stringify(await page.evaluate(() => window.__errors)));
  await ctx.close();
}

// ---------- 2. touch (390x844): long-press, double-tap zoom, swipe, multi-touch
{
  const { page, ctx } = await open(b, srv.url, { w: 390, h: 844, touch: true, prof: 't10b', save: SAVE_VET, mock: { interstitial: 'notshown', advDelay: 50 } });
  await passMenuIntro(page);
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => { window.__cm = []; window.addEventListener('contextmenu', (e) => window.__cm.push({ prevented: e.defaultPrevented, t: e.target.id || e.target.tagName })); });
  const hold = async (x, y, ms) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(ms); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const spots = await page.evaluate(() => { const c = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }; return [c('.menu-title'), c('.menu-mascot, .mascot, #screen img')].filter(Boolean); });
  for (const sp of spots) await hold(sp.x, sp.y, 1100);
  out('TOUCH long-press in menu (title/mascot area): contextmenu events', JSON.stringify(await page.evaluate(() => window.__cm)), 'selection:', JSON.stringify(await page.evaluate(() => getSelection().toString())));
  const sw = async (x, y, dy) => cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: dy, gestureSourceType: 'touch', speed: 800 });
  await sw(195, 200, 400); await sw(195, 600, -400); await sleep(300);
  out('swipe down/up in menu -> scrollY', await page.evaluate(() => scrollY), 'visualViewport.scale', await page.evaluate(() => visualViewport.scale), 'reloaded?', await page.evaluate(() => performance.getEntriesByType('navigation').length));
  await startMatch(page); await toNight(page); await sleep(800);
  await page.evaluate(() => (window.__cm.length = 0));
  await hold(195, 420, 1100);
  out('TOUCH long-press on field in match: contextmenu events', JSON.stringify(await page.evaluate(() => window.__cm)), 'selection', JSON.stringify(await page.evaluate(() => getSelection().toString())));
  await page.touchscreen.tap(195, 420); await sleep(90); await page.touchscreen.tap(195, 420); await sleep(400);
  out('double-tap on field: visualViewport.scale', await page.evaluate(() => visualViewport.scale), 'zoom of camera', await sc(page, 'return s.cameras.main.zoom'));
  await sw(195, 300, 300); await sleep(300);
  out('swipe in match -> scrollY', await page.evaluate(() => scrollY), 'page reload marker ok', await page.evaluate(() => !!window.__pgame));
  await ctx.close();
}

// ---------- 3. offline after load & cloud failures
{
  host.reset();
  const { page, ctx, logs } = await open(b, srv.url, { prof: 't10c', save: SAVE_VET, authState: true, mock: { interstitial: 'notshown', advDelay: 50, setDataFail: true } });
  await passMenuIntro(page);
  await ctx.setOffline(true);
  out('OFFLINE: menu ok?', (await gameInfo(page)).screenShown);
  await startMatch(page); await toNight(page); await sleep(500); await winNow(page); await waitSel(page, '#screen.show #again', 30000); await sleep(1400);
  const pr = await progress(page);
  out('OFFLINE + cloud setData failing: match completed, local save rev', pr.rev, 'matches', pr.progress.matches, 'coins', pr.progress.meta.coins);
  const L = await ylog(page);
  out('  setData attempts', L.filter((e) => e.ev === 'setData').length, '(retry with backoff, no UI error). toast:', await page.evaluate(() => document.querySelector('#toastScreen')?.textContent || ''));
  await sleep(500); await click(page, '#again'); await sleep(2500);
  out('  next match starts offline:', (await gameInfo(page)).active);
  await ctx.setOffline(false);
  await page.evaluate(() => { window.__MOCK.setDataFail = false; });
  await sleep(24000);
  const L2 = await ylog(page);
  out('  after recovery: setData attempts', L2.filter((e) => e.ev === 'setData').length, 'cloud rev now', host.cloud.t10c?.save?.rev, 'local rev', (await progress(page)).rev);
  out('  errors', JSON.stringify(await page.evaluate(() => window.__errors)), JSON.stringify(logs.filter((l) => !/GL Driver|ReadPixels/.test(l))));
  await ctx.close();
}
await b.close(); srv.close();
