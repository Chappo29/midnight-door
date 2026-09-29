import { serve, launch, open, sleep, sc, click, has, waitSel, out, gp, ylog, catchPlayer, toNight, winNow, passMenuIntro, startMatch, SAVE_MATCH1, gameInfo } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const { page } = await open(b, srv.url, { prof: 't14', save: SAVE_MATCH1, mock: { interstitial: 'notshown', advDelay: 50 } });
await passMenuIntro(page);
await startMatch(page);
await page.waitForFunction(() => { const s = window.__pgame.scene.getScene('game'); return window.__pgame.scene.isActive('game') && s.m && s.m.phase === 'pick'; }, null, { timeout: 30000 }); await sleep(600);
out('pick phase gp=', await gp(page));
await toNight(page); await sleep(500); out('night gp=', await gp(page));
await catchPlayer(page); await sleep(1500); out('caught card gp=', await gp(page), (await gameInfo(page)).screenCard);
await sleep(1200); await click(page, '#spirit'); await sleep(900); out('spirit (Играть духом) gp=', await gp(page), (await gameInfo(page)).screenCard);
await page.evaluate(() => window.__emit('game_api_pause')); await sleep(300); out('spirit + platform pause gp=', await gp(page));
await page.evaluate(() => window.__emit('game_api_resume')); await sleep(300); out('spirit + resume gp=', await gp(page));
await winNow(page); await waitSel(page, '#screen.show #again', 30000); await sleep(1400); out('result gp=', await gp(page));
await click(page, '#again'); await sleep(1500); out('after again (unlock preview expected) card=', (await gameInfo(page)).screenCard, 'gp=', await gp(page));
if (await has(page, '#try')) { await click(page, '#try'); await sleep(1500); out('after Попробовать gp=', await gp(page), 'active=', (await gameInfo(page)).active); }
const L = await ylog(page); out('violations', L.filter((e) => e.ev === 'VIOLATION').length, 'start/stop sequence:', L.filter((e) => /gp_/.test(e.ev)).map((e) => e.ev[3] === 's' && e.ev === 'gp_start' ? 'S' : 'X').join(''));
await b.close(); srv.close();
