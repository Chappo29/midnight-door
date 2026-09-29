import { serve, launch, open, sleep, SAVE_VET, passMenuIntro, out } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const { page } = await open(b, srv.url, { prof: 't10d', save: SAVE_VET });
await passMenuIntro(page);
out(await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.draggable && getComputedStyle(i).getPropertyValue('-webkit-user-drag') !== 'none').map((i) => i.outerHTML.slice(0, 120) + ' parent=' + i.parentElement.className)));
await b.close(); srv.close();
