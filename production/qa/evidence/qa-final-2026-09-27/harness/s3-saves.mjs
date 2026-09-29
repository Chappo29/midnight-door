// S3: boot with malformed / legacy / hostile saves. Must not crash, must not silently reset a real profile.
import { launch, open, state, sleep, shot } from './harness.mjs';

const good = { matches: 3, wins: { easy: 2, hard: 1, nightmare: 0 }, tutorial: 'done', hints: ['a'], meta: { coins: 123, heroes: ['boy'], hero: 'boy', skins: { door: ['classic'], cannon: ['classic'] }, skin: { door: 'classic', cannon: 'classic' }, boosters: { candy: 2 }, daily: { step: 2, last: '2020-01-01' }, tutorialGift: true }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'justUnlocked', fridge: 'locked' }, settings: { muted: true } };
const cases = {
  empty: '',
  corruptJson: '{"v":2,"rev":5,',
  nullJson: 'null',
  arrayJson: '[1,2,3]',
  number: '42',
  legacyV1: JSON.stringify({ matches: 3, wins: { easy: 2 }, tutorial: 'done', meta: { coins: 77 } }),
  legacyNoUnlocks: JSON.stringify({ matches: 4, wins: { easy: 4, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins: 10 } }),
  futureV: JSON.stringify({ v: 9, rev: 10, at: 5, progress: { ...good, newField: { x: 1 } } }),
  negativeCoins: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, meta: { ...good.meta, coins: -500 } } }),
  nanCoins: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, meta: { ...good.meta, coins: 'NaN' } } }),
  hugeCoins: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, meta: { ...good.meta, coins: 1e308 } } }),
  floatCoins: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, meta: { ...good.meta, coins: 12.7 } } }),
  badTypes: JSON.stringify({ v: 2, rev: 'x', at: null, progress: { matches: '5', wins: 'no', tutorial: 7, hints: 'x', meta: [], unlocks: 5, settings: 'x' } }),
  missingProgress: JSON.stringify({ v: 2, rev: 3 }),
  unknownHero: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, meta: { ...good.meta, hero: 'ghost', heroes: ['ghost'], skin: { door: 'nope', cannon: 'nope' } } } }),
  unlockBeforeMatches: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, matches: 0, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' } } }),
  matchesNoUnlocks: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, matches: 10, unlocks: {} } }),
  tutorialMissingButMatches: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, tutorial: undefined } }),
  boosterNeg: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, meta: { ...good.meta, boosters: { candy: -3, door: 1e9, wrench: 'x' } } } }),
  dailyStepHuge: JSON.stringify({ v: 2, rev: 3, at: 1, progress: { ...good, meta: { ...good.meta, daily: { step: 99, last: 5 } } } }),
  protoPollution: '{"v":2,"rev":3,"at":1,"progress":{"__proto__":{"polluted":1},"matches":1,"meta":{"coins":5}}}',
};

const browser = await launch();
for (const [name, raw] of Object.entries(cases)) {
  const { page, logs, ctx } = await open(browser, { save: raw });
  await sleep(4500);
  const st = await state(page).catch((e) => ({ err: e.message }));
  const stored = await page.evaluate(() => ({ main: localStorage.getItem('midnight-door-progress'), corrupt: localStorage.getItem('midnight-door-progress-corrupt') }));
  const polluted = await page.evaluate(() => ({}).polluted);
  const errs = logs.filter((l) => !l.includes('GL Driver') && !l.includes('404'));
  let storedP = null;
  try { storedP = JSON.parse(stored.main)?.progress; } catch {}
  console.log(name.padEnd(26), JSON.stringify({ active: st.active, tut: st.tut, screen: st.screen, coins: st.coins, matches: st.matches, tutorial: st.tutorial, unlocks: st.unlocks, boosters: st.boosters, rev: st.rev, stored: !!stored.main, corrupt: !!stored.corrupt, storedCoins: storedP?.meta?.coins, polluted, errs: [...(st.errors || []), ...errs] }));
  if (name === 'futureV') console.log('   futureV keeps newField:', storedP?.newField);
  await ctx.close();
}
await browser.close();
