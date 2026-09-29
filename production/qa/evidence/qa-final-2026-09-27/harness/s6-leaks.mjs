// S6: 10 real-time-ish matches in a row (rematch + menu + tutorial restarts), counting objects/listeners/sounds/heap, and frame time under load.
import { launch, open, state, click, sleep, until, scene } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 5, wins: { easy: 3, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins: 900, daily: { step: 1, last: new Date().toISOString().slice(0, 10) }, tutorialGift: true }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: false } } });
const browser = await launch();
const { page, logs } = await open(browser, { w: 844, h: 390, touch: true, save: VET });
await until(page, () => document.querySelector('#screen.show button[data-d="easy"], #dailyClaim'), null, 20000);
await sleep(700);
while (await page.$('#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1400); }
await page.evaluate(() => (window.__platform.fake = { show: () => Promise.resolve(true) }));

const probe = () => page.evaluate(() => {
  const g = window.__game, s = g.scene.getScene('game');
  const ev = (e) => e.eventNames().reduce((n, k) => n + e.listenerCount(k), 0);
  const snd = g.sound.sounds;
  return {
    children: s.children?.list.length, tweens: s.tweens?.getTweens().length, timers: s.time?._active?.length,
    displayListAll: g.scene.scenes.reduce((n, sc) => n + sc.children.list.length, 0),
    sounds: snd.length, playing: snd.filter((x) => x.isPlaying).length, music: snd.filter((x) => x.isPlaying && /menu|night/.test(x.key)).map((x) => x.key),
    gameEv: ev(g.events), scaleEv: ev(g.scale), inputMgr: ev(g.input.events ?? g.input), texEv: ev(g.textures),
    registryEv: ev(g.registry.events), sceneEv: ev(s.events), kb: ev(s.input.keyboard), inp: ev(s.input),
    domNodes: document.getElementsByTagName('*').length, uiChildren: document.getElementById('ui').querySelectorAll('*').length,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    winAdd: Object.entries(window.__qa.add).filter(([k]) => /touchstart|pagehide|visibilitychange|resize/.test(k)).map(([k, v]) => `${k}+${v}-${window.__qa.remove[k] || 0}`).join(' '),
  };
});

async function playMatch(i) {
  await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
  await sleep(300);
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep', null, 20000);
  // fill the room with buildings (max load) via grants + commands
  await scene(page, `const r = m.playerRoom; for (let k=0;k<40;k++){ m.grant(r, 5000); const kinds=['cannon','trap','workbench','fridge']; const kind = kinds[k%4]; const c = m.findBuildCell(r, kind); if (c) { m.chars[m.playerId].x = c.x+0.5; m.chars[m.playerId].y = c.y+0.5; m.command(m.playerId, { type:'build', kind, x:c.x, y:c.y }); for (let t=0;t<200 && m.player.task;t++) m.step(); } }`);
  await scene(page, `m.phaseLeft = 0.05`);
  await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 20000);
  // real-time night for a few seconds with the ghost around, then fast-forward, then win
  const fr = await page.evaluate(async () => {
    const times = []; let last = performance.now();
    await new Promise((res) => { let n = 0; const f = (t) => { times.push(t - last); last = t; if (++n < 180) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    times.sort((a, b) => a - b);
    return { p50: times[90].toFixed(1), p95: times[171].toFixed(1), max: times[179].toFixed(1) };
  });
  await scene(page, `s.debugAdvance(60)`);
  const b = await scene(page, `return { buildings: m.playerRoom.buildings.length, all: m.rooms.reduce((n,r)=>n+r.buildings.length,0), views: s.buildingViews.size, events: m.events.length }`);
  await scene(page, `m.ghost.hp = 0; m.ghost.state='dead'; m.events.push({type:'ghostDead'}); m.finish('win','ghost');`);
  await until(page, () => document.querySelector('#screen.show .result-card'), null, 10000);
  await sleep(500);
  const p = await probe();
  log(`#${i}`, { frame: fr, ...b }, p);
  // alternate: rematch / menu / tutorial replay
  if (i % 3 === 0) { await click(page, '#again'); }
  else { await click(page, '#tomenu'); await sleep(1200); if (i % 3 === 1) await click(page, '#screen.show button[data-d="easy"]'); else { await click(page, '#tut'); await sleep(3000); await page.keyboard.press('Escape'); await sleep(600); await click(page, '#tomenu'); await sleep(1200); await click(page, '#screen.show button[data-d="easy"]'); } }
  await sleep(800);
}
await click(page, '#screen.show button[data-d="easy"]');
for (let i = 1; i <= 10; i++) await playMatch(i);
const st = await state(page);
log('final errors', st.errors, logs.filter((l) => !l.includes('GL Driver') && !l.includes('404')).slice(0, 10));
await browser.close();
