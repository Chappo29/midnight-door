import { serve, launch, open, sleep, shot, playTutorial, out } from './lib.mjs';
const srv = await serve(5199); const b = await launch(['--autoplay-policy=no-user-gesture-required']);
const { page } = await open(b, srv.url, { prof: 't18', w: 844, h: 390 });
await page.waitForFunction(() => window.__pgame?.scene.isActive('game'), null, { timeout: 20000 });
await sleep(1500); await shot(page, 't18-intro');
await playTutorial(page, { stopAt: 'sofa' }); await sleep(1800); await shot(page, 't18-sofa');
await b.close(); srv.close();
