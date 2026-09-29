import { serve, launch, open, ylog, gameInfo, shot, sleep, host, sc, click, has, waitSel, gp, out, toNight, winNow, progress, startMatch, playTutorial, passMenuIntro } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const { page, ctx } = await open(b, srv.url, { prof: 't5a' });
await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 });
const t0 = Date.now();
const steps = await playTutorial(page);
out('tutorial steps:', steps.join('>'), (Date.now() - t0) / 1000 + 's');
await waitSel(page, '#screen.show .card', 60000); await sleep(1300);
out('after tutorial:', JSON.stringify(await gameInfo(page)));
await shot(page, 't5a-tutorial-done');
let pr = await progress(page); out('save after tutorial:', JSON.stringify({ rev: pr.rev, tutorial: pr.progress.tutorial, coins: pr.progress.meta.coins, matches: pr.progress.matches }));
// reload right away
await page.reload(); await waitSel(page, '#screen.show', 30000); await sleep(1300);
out('reload after tutorial:', JSON.stringify(await gameInfo(page)));
pr = await progress(page); out('save:', JSON.stringify({ rev: pr.rev, tutorial: pr.progress.tutorial, coins: pr.progress.meta.coins, matches: pr.progress.matches }));
// dismiss daily and play first real match (no ad expected)
await passMenuIntro(page);
const l0 = (await ylog(page)).length;
await startMatch(page); await toNight(page); await sleep(600); await winNow(page);
await waitSel(page, '#screen.show #again', 30000); await sleep(1300);
out('match1 events:', (await ylog(page)).slice(l0).filter((e) => /adv|gp_/.test(e.ev)).map((e) => e.ev + (e.kind ? ':' + e.kind : '')).join(' '));
pr = await progress(page); out('save after match1:', JSON.stringify({ rev: pr.rev, coins: pr.progress.meta.coins, matches: pr.progress.matches, wins: pr.progress.wins, unlocks: pr.progress.unlocks }));
// immediate reload on result screen
await page.reload(); await waitSel(page, '#screen.show', 30000); await sleep(1300);
out('reload on result:', JSON.stringify(await gameInfo(page)));
pr = await progress(page); out('save after reload:', JSON.stringify({ rev: pr.rev, coins: pr.progress.meta.coins, matches: pr.progress.matches, unlocks: pr.progress.unlocks }));
out('cloud setData calls:', (host.setCalls['t5a'] || []).length);
// browser restart: new context with same storage
const state = await ctx.storageState(); await page.close();
const ctx2 = await b.newContext({ viewport: { width: 1280, height: 720 }, storageState: state });
await ctx2.addCookies([{ name: 'prof', value: 't5a', url: srv.url }]);
const p2 = await ctx2.newPage(); await p2.goto(srv.url); await waitSel(p2, '#screen.show', 30000); await sleep(1300);
pr = await progress(p2); out('after browser restart:', JSON.stringify({ rev: pr.rev, coins: pr.progress.meta.coins, matches: pr.progress.matches, tutorial: pr.progress.tutorial }), JSON.stringify(await gameInfo(p2)));
await b.close(); srv.close();
