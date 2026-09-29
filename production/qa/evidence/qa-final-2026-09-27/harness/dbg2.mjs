import { launch, open, state, shot, click, sleep, until } from './harness.mjs';
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, wins: { easy: 3, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins: 900, daily: { step: 1, last: '' }, tutorialGift: true }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });
const touch = process.argv[2] === 'touch';
const browser = await launch();
const { page } = await open(browser, { w: 390, h: 844, touch, save: VET });
await until(page, () => document.querySelector('#dailyClaim'), null, 20000);
await page.evaluate(() => { window.__clicks = []; document.addEventListener('click', (e) => window.__clicks.push([e.target.id || e.target.tagName, e.detail, Math.round(performance.now())]), true); });
await sleep(600);
for (let i = 0; i < 4; i++) {
  const s = await state(page);
  console.log(i, s.screen, s.buttons, s.coins, await page.evaluate(() => JSON.stringify(window.__clicks)));
  if (!(await page.$('#dailyClaim'))) break;
  await click(page, '#dailyClaim', { touch });
  await sleep(1300);
}
await browser.close();
