import { serve, launch, open, ylog, gameInfo, shot, sleep, host, SAVE_MATCH1, SAVE_VET, sc, click, has, waitSel, gp, out, toNight, winNow, progress, startMatch, passMenuIntro } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const { page } = await open(b, srv.url, { prof: 't4', save: SAVE_VET, mock: { advDur: 2000, advDelay: 1500 } });
await passMenuIntro(page);
await page.evaluate(() => { const g = window.__pgame; window.__starts = 0; const o = g.scene.start.bind(g.scene); g.scene.start = (k, d) => { if (k === 'game') window.__starts++; return o(k, d); }; });
const starts = () => page.evaluate(() => window.__starts);
const reset = async () => { await page.evaluate(() => (window.__starts = 0)); };
const inGame = async () => (await gameInfo(page)).active;
const wait = (ms) => sleep(ms);
async function backToMenu() {
  // from anywhere to menu
  const g = await gameInfo(page);
  if (g.active) { await page.keyboard.press('Escape'); await wait(700); await click(page, '#tomenu').catch(() => {}); await wait(1500); }
  for (let i = 0; i < 3; i++) { if (await has(page, '#tomenu')) { await click(page, '#tomenu'); await wait(1500); } }
}
// 1. difficulty x2 quick (same and different)
await reset();
const box = async (sel) => (await (await page.$(sel)).boundingBox());
let e = await box('.diff-btn[data-d="easy"]'), h = await box('.diff-btn[data-d="hard"]');
await page.mouse.click(e.x + e.width / 2, e.y + e.height / 2); await wait(120); await page.mouse.click(h.x + h.width / 2, h.y + h.height / 2);
await wait(6000);
out('1 easy then hard within 120ms -> scene starts:', await starts(), 'active:', await inGame());
// finish match -> result
await toNight(page); await wait(600); await winNow(page); await waitSel(page, '#screen.show #again', 30000); await wait(1400); out('   result state:', JSON.stringify(await gameInfo(page)));
// 2. Ещё раз x2
await reset();
await click(page, '#again'); await wait(150); await click(page, '#again'); await wait(6000);
out('2 again x2 -> starts:', await starts());
await toNight(page); await wait(600); await winNow(page); await waitSel(page, '#screen.show #again', 30000); await wait(1400); out('   result state:', JSON.stringify(await gameInfo(page)));
// 3. Ещё раз -> Меню during ad
await reset();
await click(page, '#again'); await wait(500); await click(page, '#tomenu').catch((e) => out('   tomenu click failed', String(e).slice(0, 60))); await wait(6000);
out('3 again then menu during ad -> starts:', await starts(), 'active:', await inGame(), 'card:', (await gameInfo(page)).screenCard);
// 4. In menu: start then quickly Menu? (menu has no menu button); start -> pause-> home
if (!(await gameInfo(page)).screenShown) { out('   not in menu; skip 4'); }
else {
  await reset(); await wait(1200);
  await startMatch(page); await wait(600);
  out('4 start pressed, immediately Escape/nothing; wait...'); await wait(5500);
  out('  starts:', await starts(), 'active:', await inGame());
  // pause -> Выйти в меню x3
  await page.keyboard.press('Escape'); await wait(1400);
  await reset();
  await click(page, '#tomenu'); await wait(120); await click(page, '#tomenu').catch(() => {}); await wait(120); await click(page, '#tomenu').catch(() => {});
  await wait(5000);
  out('5 pause->home x3 -> starts:', await starts(), 'active:', await inGame(), 'card:', (await gameInfo(page)).screenCard);
}
out('errs', await page.evaluate(() => window.__errors));
await b.close(); srv.close();
