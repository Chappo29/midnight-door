import { serve, launch, open, ylog, gameInfo, shot, sleep, host, SAVE_MATCH1, sc, click, has, waitSel, gp, out, progress } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const cases = [
  ['fast', { }, false], ['2s', { initDelay: 2000 }, false], ['5s', { initDelay: 5000 }, false], ['10s', { initDelay: 10000 }, false], ['14s', { initDelay: 14000 }, false],
  ['initFail', { initFail: true }, false], ['noSdk(404)', {}, true],
];
for (const saveKind of ['menu', 'firstrun']) {
  for (const [name, mock, noSdk] of cases) {
    host.reset();
    const t0 = Date.now();
    const { page, logs, ctx } = await open(b, srv.url, { prof: `t2-${name}-${saveKind}`, save: saveKind === 'menu' ? SAVE_MATCH1 : undefined, mock, noSdk });
    const seen = [];
    // sample UI at 0.5,1.5,3,6
    for (const at of [500, 1500, 3000, 6000]) {
      await sleep(Math.max(0, at - (Date.now() - t0)));
      const g = await gameInfo(page); seen.push(`${at}ms:${g.active ? 'match/tutorial' : g.screenShown ? g.screenCard : 'boot'}`);
    }
    // wait until SDK-related stuff has settled
    await sleep(Math.max(0, 16000 - (Date.now() - t0)));
    const L = await ylog(page);
    const cnt = (ev, name) => L.filter((e) => e.ev === ev && (name === undefined || e.name === name)).length;
    out(`[${saveKind}] ${name}`.padEnd(22), 'ui:', seen.join(' '), '| ready=' + cnt('ready'), 'init_call=' + cnt('init_call'), 'on(pause)=' + cnt('on', 'game_api_pause'), 'on(resume)=' + cnt('on', 'game_api_resume'), 'getPlayer=' + cnt('getPlayer'), 'gp_start=' + cnt('gp_start'), 'gp_stop=' + cnt('gp_stop'), 'VIOL=' + cnt('VIOLATION'), 'readyAt=' + (L.find((e) => e.ev === 'ready')?.t ?? '-'), 'errs=' + JSON.stringify(await page.evaluate(() => window.__errors)), 'logs=' + JSON.stringify(logs.filter(l=>!/GL Driver|ReadPixels/.test(l))));
    await ctx.close();
  }
}
await b.close(); srv.close();
