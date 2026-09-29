import { serve, launch, open, ylog, gameInfo, shot, sleep, host, SAVE_MATCH1, sc, click, has, waitSel, gp, out, toNight, winNow, progress, startMatch, passMenuIntro } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const { page } = await open(b, srv.url, { prof: 't4d', save: SAVE_MATCH1, mock: { advDur: 2000, advDelay: 1500 } });
await passMenuIntro(page);
await startMatch(page); await sleep(4500);
await toNight(page); await sleep(600); await winNow(page);
for (let i=0;i<8;i++){ await sleep(500); out(i, JSON.stringify(await gameInfo(page))); }
await shot(page,'t4d');
await b.close(); srv.close();
