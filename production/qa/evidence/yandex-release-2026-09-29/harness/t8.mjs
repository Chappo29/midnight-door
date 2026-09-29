// Full-gameplay smoke on the PRODUCTION bundle: real scene code (handleEvents, HUD, sounds), sim driven in fast-forward with the AI playing for the player.
import { serve, launch, open, sleep, sc, click, has, waitSel, out, SAVE_VET, passMenuIntro, startMatch, gameInfo, shot } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const plan = (process.env.PLAN || 'easy,easy,easy,hard,hard,nightmare,nightmare').split(',');
const auto = process.env.MODE || 'ai'; // ai: player AI plays; idle: player does nothing (gets caught -> spirit)
const { page, ctx, logs } = await open(b, srv.url, { prof: 't8', save: SAVE_VET, mock: { interstitial: 'notshown', advDelay: 100 } });
await passMenuIntro(page);
const results = [];
for (let i = 0; i < plan.length; i++) {
  const d = plan[i];
  await page.waitForFunction(() => !!document.querySelector('.diff-btn[data-d="easy"]') || window.__pgame.scene.isActive('game'), null, { timeout: 30000 });
  if (!(await page.evaluate(() => window.__pgame.scene.isActive('game')))) { await sleep(1300); await startMatch(page, d); }
  await page.waitForFunction(() => { const s = window.__pgame.scene.getScene('game'); return window.__pgame.scene.isActive('game') && s.m && s.m.phase === 'pick'; }, null, { timeout: 30000 });
  await sleep(500);
  await sc(page, "const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id }); if (arg) m.opts.autoPlayer = true;", auto === 'ai');
  const t0 = Date.now();
  const rep = await page.evaluate(async () => {
    const s = window.__pgame.scene.getScene('game'); const m = s.m; const ev = { retreat: 0, desperate: 0, healed: 0, caughtMe: 0, spirit: 0, revived: 0, doorBroken: 0, trapped: 0, siege: 0, ghostLevel: 0 };
    const errs = []; let steps = 0; let firstCaughtAt = null;
    const orig = s.handleEvents.bind(s);
    while (m.phase !== 'end' && steps < 60000) {
      try {
        m.step();
        for (const e of m.events) { if (e.type === 'ghostRetreat') ev.retreat++; else if (e.type === 'ghostDesperate') ev.desperate++; else if (e.type === 'ghostHealed') ev.healed++; else if (e.type === 'caught' && e.charId === m.playerId) { ev.caughtMe++; firstCaughtAt ??= m.nightTime; } else if (e.type === 'spirit' && e.charId === m.playerId) ev.spirit++; else if (e.type === 'revived') ev.revived++; else if (e.type === 'doorBroken') ev.doorBroken++; else if (e.type === 'trapped') ev.trapped++; else if (e.type === 'siegeEnd') ev.siege++; else if (e.type === 'ghostLevel') ev.ghostLevel = e.level; }
        orig(m.events);
      } catch (e) { errs.push(String(e && e.message || e)); break; }
      steps++;
      // if the caught card paused the scene: choose spirit (play as a ghost helper) as a real player would
      if (s.caughtPaused && !m.result) { s.caughtPaused = false; s.hud.hideScreen(); }
    }
    return { phase: m.phase, result: m.result, reason: m.resultReason, teamWin: m.teamWin, night: Math.round(m.nightTime), ghostLevel: m.ghost.level, survivors: m.survivors, steps, ev, errs, firstCaughtAt };
  });
  out(`match ${i + 1} ${d}`.padEnd(16), 'sim in', ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(rep));
  results.push({ d, ...rep });
  // wait for finale + result screen (real frames)
  await waitSel(page, '#screen.show #again', 60000).catch(() => out('   !! result screen did not appear', JSON.stringify(rep)));
  await sleep(1300);
  if (i === 0) await shot(page, 't8-result-first');
  out('   result card:', (await gameInfo(page)).screenCard, (await gameInfo(page)).buttons.join(','));
  // back to next: 'again' would start next of same diff; use menu
  await click(page, '#tomenu'); await sleep(1600);
  for (let k = 0; k < 4; k++) { if (await has(page, '#try')) { await click(page, '#try').catch(()=>{}); await sleep(200); } }
  await sleep(500);
  if (!(await page.evaluate(() => window.__pgame.scene.isActive('game')))) { if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1400); if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1300); } } }
}
out('\nSUMMARY', results.map((r) => `${r.d}:${r.result}${r.teamWin ? '(team)' : ''}/${r.reason} night ${r.night}s retreats ${r.ev.retreat} caughtMe ${r.ev.caughtMe}`).join(' | '));
out('page errors:', JSON.stringify(await page.evaluate(() => window.__errors)), 'console:', JSON.stringify(logs.filter((l) => !/GL Driver|ReadPixels/.test(l))));
await b.close(); srv.close();
