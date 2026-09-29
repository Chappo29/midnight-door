// S16: live recheck of QA-10 (music track ends during fade) and QA-20 (Space in menu after a match). Muted, small window.
import { launch, open, state, click, sleep, until } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const today = new Date().toISOString().slice(0, 10);
const browser = await launch();

// QA-10 — same steps as S7/VIEW-6: game playlist, seek to 0.2 s before the end, fade to silence.
{
  const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, tutorial: 'done', hints: [], meta: { coins: 10, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: false } } });
  const { page, ctx, logs } = await open(browser, { w: 844, h: 390, save: VET });
  await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
  await sleep(3000);
  for (const [label, next] of [['fade to silence', 'null'], ['fade to menu music', "'menu'"]]) {
    const r = await page.evaluate(async (next) => {
      const sfx = window.__sfx;
      sfx.playMusic(['night1', 'night2', 'night3'], 0);
      await new Promise((r) => setTimeout(r, 800));
      const mus = sfx.music;
      mus.setSeek(Math.max(0, mus.duration - 0.2));
      sfx.playMusic(eval(next), 400);
      const before = window.__qa.errors.length;
      await new Promise((r) => setTimeout(r, 1500));
      const playing = window.__game.sound.sounds.filter((s) => s.isPlaying).map((s) => s.key);
      return { track: mus.key, destroyed: mus.pendingRemove, errorsAfter: window.__qa.errors.length - before, playing };
    }, next);
    log(`QA-10 ${label}:`, r);
  }
  log('   console errors:', logs.filter((l) => /TypeError|volume/i.test(l)).length);
  await ctx.close();
}

// QA-20 — Space on a focused menu button, before and after a match.
{
  const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 0, tutorial: 'done', hints: [], meta: { coins: 10, daily: { step: 1, last: today } }, unlocks: {}, settings: { muted: true } } });
  const { page, ctx } = await open(browser, { w: 844, h: 390, save: VET });
  await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
  await sleep(600);
  await page.focus('#screen button[data-d="easy"]');
  await page.keyboard.press('Space');
  await sleep(1500);
  log('QA-20 before any match: Space on «Лёгкая» → match started', (await state(page)).active);
  await page.keyboard.press('Escape'); await sleep(600); await click(page, '#tomenu'); await sleep(1300);
  await page.focus('#screen button[data-d="easy"]');
  await page.keyboard.press('Space');
  await sleep(1500);
  const st = await state(page);
  log('QA-20 after a match:     Space on «Лёгкая» → match started', st.active, st.screen);
  // and the in-game keys still work in the new match: Esc pauses, arrow does not scroll the page
  await page.keyboard.press('Escape'); await sleep(500);
  log('   in-match Esc → pause card:', (await state(page)).screen);
  await ctx.close();
}
await browser.close();
