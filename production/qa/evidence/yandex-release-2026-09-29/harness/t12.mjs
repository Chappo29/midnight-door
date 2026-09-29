// Shop / coins / daily reward on the production ZIP.
import { serve, launch, open, sleep, sc, click, has, waitSel, out, progress, host, ylog, gameInfo, snap, passMenuIntro } from './lib.mjs';
const srv = await serve(5199);
const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const P = (coins, extra = {}) => ({ matches: 9, wins: { easy: 5, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins, ...extra }, unlocks: { pumpkin: 'available', trap: 'available', workbench: 'available', fridge: 'available' }, settings: { muted: true } });
const coinsOf = async (p) => (await progress(p)).progress.meta.coins;
const coinsUi = (p) => p.evaluate(() => document.querySelector('#shopCoins')?.textContent);

// ---------- SHOP
{
  host.reset();
  const { page, ctx } = await open(b, srv.url, { prof: 't12a', save: snap(P(100, { daily: { step: 0, last: '9999-01-01' } }), 30, 3000), authState: true });
  await passMenuIntro(page);
  await click(page, '#metaShop'); await sleep(1300);
  const tabs = await page.$$('#screen .shop-tab');
  const listing = [];
  for (let i = 0; i < tabs.length; i++) { await (await page.$$('#screen .shop-tab'))[i].click(); await sleep(400); listing.push(await page.evaluate(() => [...document.querySelectorAll('#screen .shop-action')].map((a) => (a.className.replace('shop-action', '').trim() + ':' + a.textContent.trim().replace(/\s+/g, ' ')).slice(0, 30)))); }
  out('SHOP tabs actions:', JSON.stringify(listing));
  await (await page.$$('#screen .shop-tab'))[tabs.length - 1].click(); await sleep(500);
  const before = await coinsOf(page); const ui0 = await coinsUi(page);
  const buyBtns = await page.$$('#screen .shop-action.buy:not(.poor)');
  out('affordable buy buttons on booster tab:', buyBtns.length, 'coins', before, 'ui', ui0);
  if (buyBtns.length) { const bx = await buyBtns[0].boundingBox(); await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); }
  await sleep(1500);
  const after = await coinsOf(page); out('after 3 rapid clicks on one buy button: coins', before, '->', after, 'spent', before - after, 'ui', await coinsUi(page), 'boosters', JSON.stringify((await progress(page)).progress.meta.boosters));
  const poor = await page.$$('#screen .shop-action.buy.poor');
  if (poor.length) { const bx = await poor[0].boundingBox(); const c0 = await coinsOf(page); await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await sleep(600); out('click on "poor" (not enough coins) button: coins delta', (await coinsOf(page)) - c0, 'toast:', await page.evaluate(() => document.querySelector('#toastScreen')?.textContent || '')); }
  await sleep(2500);
  out('cloud after purchase: rev', host.cloud.t12a?.save?.rev, 'coins', host.cloud.t12a?.save?.progress.meta.coins, 'setData calls', (host.setCalls.t12a || []).length, 'bytes', (host.setCalls.t12a || []).map((c) => c.bytes).join(','));
  const localCoins = await coinsOf(page); await page.reload(); await waitSel(page, '#screen.show'); await sleep(1500);
  out('reload after purchase: coins', await coinsOf(page), '(was', localCoins + ')');
  await ctx.close();
}

// ---------- DAILY (Date mocked through init script offset)
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Europe/Moscow' });
  await ctx.addCookies([{ name: 'prof', value: 't12b', url: srv.url }]);
  await ctx.addInitScript(() => { const R = Date; const off = Number(sessionStorage.getItem('__off') || 0); if (off) { const N = function (...a) { return a.length ? new R(...a) : new R(R.now() + off); }; N.now = () => R.now() + off; N.prototype = R.prototype; N.UTC = R.UTC; N.parse = R.parse; window.Date = N; } });
  const page0 = await ctx.newPage();
  await page0.goto(srv.url); await page0.evaluate((s) => { localStorage.setItem('midnight-door-progress', s); sessionStorage.removeItem('__off'); }, snap(P(100, { daily: { step: 0, last: '' } }), 30, 3000)); await page0.reload();
  const claimNow = async (p) => { await waitSel(p, '#screen.show'); await sleep(1300); const av = await has(p, '#dailyClaim'); if (!av) return { available: false }; const c0 = await coinsOf(p); await click(p, '#dailyClaim'); await sleep(1400); if (await has(p, '#dailyClaim')) { await click(p, '#dailyClaim'); await sleep(1300); } return { available: true, delta: (await coinsOf(p)) - c0, step: (await progress(p)).progress.meta.daily }; };
  out('DAILY day0 first open:', JSON.stringify(await claimNow(page0)));
  await page0.reload(); out('DAILY day0 reload (must NOT be available):', JSON.stringify(await claimNow(page0)));
  await page0.evaluate(() => sessionStorage.setItem('__off', String(24 * 3600 * 1000))); await page0.reload();
  out('DAILY +1 day:', JSON.stringify(await claimNow(page0)));
  await page0.evaluate(() => sessionStorage.setItem('__off', String(48 * 3600 * 1000))); await page0.reload();
  out('DAILY +2 days:', JSON.stringify(await claimNow(page0)));
  await page0.evaluate(() => sessionStorage.setItem('__off', String(24 * 3600 * 1000))); await page0.reload();
  out('DAILY clock moved BACK to +1 day after claiming +2 (QA-17):', JSON.stringify(await claimNow(page0)));
  await ctx.close();
}
{
  const ctxE = await b.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Tokyo' });
  const pg = await ctxE.newPage(); await pg.goto(srv.url); await pg.evaluate((s) => localStorage.setItem('midnight-door-progress', s), snap(P(100, { daily: { step: 0, last: '' } }), 30, 3000)); await pg.reload();
  await waitSel(pg, '#screen.show'); await sleep(1300); const a1 = await has(pg, '#dailyClaim'); if (a1) { await click(pg, '#dailyClaim'); await sleep(1400); if (await has(pg, '#dailyClaim')) { await click(pg, '#dailyClaim'); await sleep(1300); } }
  const st = await ctxE.storageState(); await ctxE.close();
  const ctxW = await b.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Pacific/Honolulu', storageState: st });
  const pw = await ctxW.newPage(); await pw.goto(srv.url); await waitSel(pw, '#screen.show'); await sleep(1400);
  out('DAILY claimed in Tokyo, then opened in Honolulu (previous local date):', 'available again =', await has(pw, '#dailyClaim'));
  await ctxW.close();
}
await b.close(); srv.close();
