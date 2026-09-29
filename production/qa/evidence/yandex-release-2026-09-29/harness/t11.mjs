// Progression on a clean profile (prod ZIP): tutorial -> M1..M5, one unlock per match; shop; daily.
import { serve, launch, open, sleep, sc, click, has, waitSel, out, progress, host, ylog, gameInfo, playTutorial, toNight, winNow, loseNow, shot } from './lib.mjs';
const srv = await serve(5199);
const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const { page, ctx, logs } = await open(b, srv.url, { prof: 't11', mock: { advDur: 800, advDelay: 200 } });
const un = async () => { const p = (await progress(page)).progress; return { m: p.matches, u: Object.entries(p.unlocks).map(([k, v]) => k[0] + ':' + v[0]).join(' '), coins: p.meta.coins, wins: p.wins.easy }; };
await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 });
const steps = await playTutorial(page); out('tutorial:', steps.length, 'steps');
await waitSel(page, '#screen.show #play', 60000); await sleep(1300);
out('after tutorial', JSON.stringify(await un()));
const inMatch = () => page.evaluate(() => window.__pgame.scene.isActive('game'));
await click(page, '#play'); // first real match (tutorial done card -> easy)
const expectLocked = [];
for (let n = 1; n <= 5; n++) {
  await page.waitForFunction(() => { const s = window.__pgame.scene.getScene('game'); return window.__pgame.scene.isActive('game') && s.m && s.m.phase === 'pick'; }, null, { timeout: 40000 });
  const locked = await sc(page, 'return [...(m.opts.lockedKinds || [])]');
  const l0 = (await ylog(page)).length;
  await toNight(page); await sleep(500);
  // can the player actually build a locked kind? try through the command layer
  const tryBuild = await sc(page, "const r = m.playerRoom; r.candy = 999; r.flame = 99; const c = m.placeableCells(r, 'cannon')[0]; const res = {}; for (const k of ['pumpkin','trap','workbench','fridge']) res[k] = m.command(m.playerId, { type: 'build', kind: k, x: c.x, y: c.y }) || 'ok'; return res");
  out(`match ${n}: locked at start [${locked}]`, 'build attempts (ok = allowed):', JSON.stringify(tryBuild));
  if (n === 4) await shot(page, 't11-m4-night');
  if (n % 2 === 1) await winNow(page); else await loseNow(page);
  await waitSel(page, '#screen.show #again', 60000); await sleep(1400);
  out(`   after m${n}:`, JSON.stringify(await un()), 'pill:', await has(page, '.unlock-pill'));
  if (n === 2) { await page.reload(); await waitSel(page, '#screen.show', 30000); await sleep(1400); out('   reload on result -> screen:', (await gameInfo(page)).screenCard, JSON.stringify(await un())); if ((await gameInfo(page)).screenCard.includes('unlock-card')) { await click(page, '#try'); await sleep(2500); continue; } else { await click(page, '.diff-btn[data-d="easy"]'); await sleep(2500); continue; } }
  await click(page, '#again'); await sleep(1500);
  if (await has(page, '#try')) { out('   unlock preview:', await page.evaluate(() => document.querySelector('.unlock-name')?.textContent)); if (n === 1) await shot(page, 't11-unlock1'); await click(page, '#try'); await sleep(2500); }
}
out('errors', JSON.stringify(await page.evaluate(() => window.__errors)), JSON.stringify(logs.filter((l) => !/GL Driver|ReadPixels/.test(l))));
await ctx.close(); await b.close(); srv.close();
