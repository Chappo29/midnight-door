import { serve, launch, open, ylog, gameInfo, shot, sleep, host, SAVE_MATCH1, sc, click, has, waitSel, gp, setHidden, audioState, out, toNight, winNow, progress } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const { page, logs } = await open(b, srv.url, { prof: 't1c', save: SAVE_MATCH1, mock: { advDur: 2500, advDelay: 600 } });
const st = async (label) => {
  const g = await gameInfo(page); const s = await page.evaluate(() => { const s = window.__pgame.scene.getScene('game'); return s && window.__pgame.scene.isActive('game') ? { t: +s.m.nightTime.toFixed(2), phase: s.m.phase, gT: +s.m.time.toFixed(1), ghostHp: Math.round(s.m.ghost.hp), candy: Math.round(s.m.player.candy ?? 0) } : null; });
  const a = await audioState(page);
  out(label.padEnd(34), 'gp=' + (await gp(page)), 'card=' + g.screenCard, s ? JSON.stringify(s) : '', 'rms=' + a.rms?.toFixed(4), 'ctx=' + a.ctx);
};
await waitSel(page, '#screen.show'); await sleep(1200);
await click(page, '#dailyClaim'); await sleep(1400); if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1300); }
await click(page, '.diff-btn[data-d="easy"]'); await toNight(page); await sleep(1500);
await st('night');
await sleep(3000); await st('night +3s (sim rate check)');
await page.evaluate(() => window.__emit('game_api_pause')); await sleep(300); await st('platform pause t0');
await sleep(3000); await st('platform pause +3s (must be same sim time)');
await page.evaluate(() => window.__emit('game_api_resume')); await sleep(200); await st('resume +0.2s');
await sleep(1000); await st('resume +1.2s (no fast-forward)');
await setHidden(page, true); await sleep(300); await st('hidden t0');
await sleep(3000); await st('hidden +3s (same sim time, ctx suspended)');
await setHidden(page, false); await sleep(200); await st('visible +0.2');
await sleep(1000); await st('visible +1.2 (no ff)');
// win → result screen
await winNow(page);
await waitSel(page, '#screen.show .result-card, #screen.show #again', 30000); await sleep(1300);
await st('result screen'); await shot(page, 't1c-result');
const pr0 = (await progress(page)).progress; out('coins after result', pr0.meta.coins, 'matches', pr0.matches);
out('result buttons', (await gameInfo(page)).buttons);
// rewarded x2
const l0 = (await ylog(page)).length;
await click(page, '#double'); await sleep(300); await click(page, '#double'); // double tap
await sleep(6000);
out('after ×2', (await ylog(page)).slice(l0));
const pr1 = (await progress(page)).progress; out('coins after x2', pr1.meta.coins, 'delta', pr1.meta.coins - pr0.meta.coins);
out('has #double now', await has(page, '#double'));
out('logs', logs.filter(l=>!/GL Driver|ReadPixels/.test(l)), await page.evaluate(() => window.__errors));
await b.close(); srv.close();
