import { launch, open, sleep, until } from './harness.mjs';
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, tutorial: 'done', hints: [], meta: { coins: 900, daily: { step: 1, last: '' } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });
const browser = await launch();
const { page } = await open(browser, { w: 844, h: 390, touch: true, save: VET });
await until(page, () => document.querySelector('#dailyClaim'), null, 20000);
await sleep(800);
console.log(await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { top: Math.round(b.top), h: Math.round(b.height), pad: cs.padding, minH: cs.minHeight, w: cs.width, margin: cs.margin, disp: cs.display }; };
  return { card: r('.daily-card'), mascot: r('.daily-mascot'), title: r('.daily-card h1'), grid: r('.daily-grid'), tile: r('.daily-tile'), btn: r('#dailyClaim'), screen: r('#screen'), mq: matchMedia('(max-height: 500px)').matches };
}));
await page.screenshot({ path: 'shots/dbg4.png' });
await browser.close();
