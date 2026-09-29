import { launch, open, sleep, until } from './harness.mjs';
const today = new Date().toISOString().slice(0, 10);
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 9, tutorial: 'done', hints: [], meta: { coins: 0, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: false } } });
const browser = await launch();
const { page } = await open(browser, { save: VET });
await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
await sleep(1000);
console.log(await page.evaluate(() => { const b = document.getElementById('sound'); const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { r: [r.x, r.y, r.width, r.height], vis: cs.visibility, disp: cs.display, hit: hit?.id || hit?.className, parentVis: getComputedStyle(b.parentElement).visibility }; }));
await browser.close();
