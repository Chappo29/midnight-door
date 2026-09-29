import { launch, click } from '../qa-final-2026-09-27/harness/harness.mjs';
const b = await launch();
for (const [w,h] of [[844,390],[390,844]]) {
const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => { if (localStorage.getItem('__qa_seeded')) return; localStorage.clear(); localStorage.setItem('__qa_seeded','1'); localStorage.setItem('midnight-door-progress', JSON.stringify({v:2,rev:5,at:1,progress:{matches:0,wins:{easy:0,hard:0,nightmare:0},tutorial:'done',hints:[],meta:{coins:40,daily:{step:1,last:new Date().toISOString().slice(0,10)},tutorialGift:true},settings:{muted:true}}})); });
const p = await ctx.newPage();
await p.goto('http://localhost:5190/');
await p.waitForSelector('#screen.show .menu-frame', { timeout: 30000 });
await new Promise(r => setTimeout(r, 2500));
while (await p.$('#dailyClaim')) { await click(p, '#dailyClaim', { touch: true }); await new Promise(r => setTimeout(r, 1500)); }
await new Promise(r => setTimeout(r, 1500));
const info = await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; return { side: r('.meta-side'), shop: r('#metaShop'), gift: r('#metaGift'), sound: r('#metaSound'), mascot: r('.menu-mascot-wrap'), vw: innerWidth }; });
console.log(w, h, JSON.stringify(info));
await p.screenshot({ path: `polish/menu-check-${w}x${h}.png` });
await ctx.close();
}
await b.close();
