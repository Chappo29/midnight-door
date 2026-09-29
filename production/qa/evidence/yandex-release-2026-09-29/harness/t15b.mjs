import { serve, launch, open, sleep, out, gameInfo, ylog, host } from './lib.mjs';
const srv = await serve(5199); const b = await launch([]);
const url = srv.url + 'games/s3-bucket-abc123/v2/index.html';
const { page, logs } = await open(b, url, { prof: 't15' });
await sleep(6000);
out(JSON.stringify(host.reqLog.slice(0, 12)), JSON.stringify(logs.slice(0, 8)), JSON.stringify(await page.evaluate(() => document.body.innerHTML.slice(0, 200))));
await b.close(); srv.close();
