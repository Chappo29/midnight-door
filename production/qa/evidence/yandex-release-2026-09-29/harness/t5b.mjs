import { serve, launch, open, ylog, gameInfo, shot, sleep, host, sc, click, has, waitSel, gp, out, progress, snap } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const allOpen = { pumpkin: 'available', trap: 'available', workbench: 'available', fridge: 'available' };
const P = (coins, matches, extra = {}) => ({ matches, wins: { easy: matches, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins }, unlocks: allOpen, settings: { muted: false }, ...extra });
const cases = [
  { name: '1 local newer than cloud', local: snap(P(500, 5), 20, 2000), cloud: snap(P(50, 1), 5, 500), wait: 9000 },
  { name: '2 cloud newer than local', local: snap(P(50, 1), 5, 500), cloud: snap(P(900, 8), 30, 3000), wait: 9000 },
  { name: '3 cloud empty', local: snap(P(500, 5), 20, 2000), cloud: null, wait: 9000 },
  { name: '4 local empty (new device)', local: undefined, cloud: snap(P(900, 8), 30, 3000), wait: 9000 },
  { name: '5 corrupt local + good cloud', local: '{bad json', cloud: snap(P(900, 8), 30, 3000), wait: 9000 },
  { name: '6a slow cloud 6s (cloud newer)', local: snap(P(500, 5), 20, 2000), cloud: snap(P(900, 8), 30, 3000), mock: { getDataDelay: 6000 }, wait: 14000 },
  { name: '6b slow cloud 6s (cloud older)', local: snap(P(500, 5), 20, 2000), cloud: snap(P(50, 1), 5, 500), mock: { getDataDelay: 6000 }, wait: 14000 },
  { name: '7 hanging cloud 25s', local: snap(P(500, 5), 20, 2000), cloud: snap(P(900, 8), 30, 3000), mock: { getDataDelay: 25000 }, wait: 16000 },
  { name: '8 getPlayer slow 6s', local: snap(P(500, 5), 20, 2000), cloud: snap(P(900, 8), 30, 3000), mock: { playerDelay: 6000 }, wait: 14000 },
];
for (const c of cases) {
  host.reset();
  const prof = 't5b' + c.name.slice(0, 2).trim();
  if (c.cloud) host.cloud[prof] = { save: JSON.parse(c.cloud) };
  const t0 = Date.now();
  const { page, ctx, logs } = await open(b, srv.url, { prof, save: c.local, authState: true, mock: c.mock || {} });
  await sleep(c.wait);
  const pr = await progress(page); const g = await gameInfo(page);
  const cl = host.cloud[prof]?.save; const rawKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('midnight')));
  out(c.name.padEnd(34), `local now: rev ${pr?.rev} coins ${pr?.progress.meta.coins} matches ${pr?.progress.matches}`, `| cloud now: ${cl ? 'rev ' + cl.rev + ' coins ' + cl.progress.meta.coins : 'empty'}`, `| ui: ${g.active ? 'match/tutorial' : g.screenCard}`, `| setData=${(host.setCalls[prof] || []).length} getData=${(host.getCalls[prof] || []).length}`, `| keys=${rawKeys.join(',')}`, 'errs=' + JSON.stringify(await page.evaluate(() => window.__errors)));
  await ctx.close();
}
await b.close(); srv.close();
