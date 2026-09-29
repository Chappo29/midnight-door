// S9: building/door/sofa through the real UI — spam, sell→build, exact/short money, repair spam, upgrade during repair, door HUD states.
import { launch, open, state, shot, click, sleep, until, scene, cellXY } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const today = new Date().toISOString().slice(0, 10);
const VET = JSON.stringify({ v: 2, rev: 50, at: 1, progress: { matches: 9, wins: { easy: 3, hard: 0, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins: 10, daily: { step: 1, last: today } }, unlocks: { pumpkin: 'seen', trap: 'seen', workbench: 'seen', fridge: 'seen' }, settings: { muted: true } } });
const browser = await launch();
const { page, logs } = await open(browser, { save: VET });
await until(page, () => document.querySelector('#screen.show button[data-d="easy"]'), null, 20000);
await sleep(500);
await page.evaluate(() => (window.__platform.fake = { show: () => Promise.resolve(true) }));
await click(page, '#screen.show button[data-d="easy"]');
await until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick', null, 20000);
await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
await until(page, () => window.__game.scene.getScene('game').m.phase === 'prep' && !window.__game.scene.getScene('game').m.player.path.length, null, 30000);
await scene(page, `m.phaseLeft = 9999; m.playerRoom.candy = 0; m.playerRoom.flame = 0;`);
await sleep(800);

// invariant probe (every 100 ms in page)
await page.evaluate(() => {
  window.__inv = [];
  setInterval(() => {
    const s = window.__game.scene.getScene('game'); const m = s?.m; if (!m || !window.__game.scene.isActive('game')) return;
    for (const r of m.rooms) {
      if (r.candy < -1e-6 || !Number.isFinite(r.candy)) window.__inv.push(`candy ${r.id}=${r.candy}`);
      if (r.flame < -1e-6) window.__inv.push(`flame ${r.id}=${r.flame}`);
      if (r.door.hp < 0 || r.door.hp > r.door.maxHp + 1e-6) window.__inv.push(`door ${r.id} ${r.door.hp}/${r.door.maxHp}`);
      const seen = new Set();
      for (const b of r.buildings) { const k = b.x + ',' + b.y; if (seen.has(k)) window.__inv.push(`overlap ${r.id} ${k}`); seen.add(k); }
    }
  }, 100);
});
const room = () => scene(page, `const r = m.playerRoom; return { candy: +r.candy.toFixed(2), flame: +r.flame.toFixed(2), sofa: r.sofa.level, door: { lvl: r.door.level, hp: Math.round(r.door.hp), max: r.door.maxHp, cd: +r.door.repairCd.toFixed(1), broken: r.door.broken }, b: r.buildings.map(b => b.kind[0] + b.level + '@' + b.x + ',' + b.y).join(' '), task: m.player.task ? m.player.task.kind + ':' + (m.player.task.cmd?.type) : null }`);
const cells = await scene(page, `const r = m.playerRoom; return m.placeableCells(r, 'cannon').filter(c => !(c.x===r.door.inside.x && c.y===r.door.inside.y)).slice(0, 8)`);
const tapCell = async (c) => { const p = await cellXY(page, c.x, c.y); await page.mouse.click(p.x, p.y); };
const menuOpt = async (id, times = 1, gap = 80, candy = null) => {
  await sleep(1100);
  if (candy !== null) { await scene(page, `s.m.playerRoom.candy = ${candy}; s.m.script = s.m.script ?? null;`); await sleep(200); await scene(page, `s.m.playerRoom.candy = ${candy}`); }
  const b = await page.$(`#menu button[data-opt="${id}"]`) ?? (await page.$$('#menu .opt-wrap')).find(async () => false);
  const el = await page.$(`#menu [data-opt="${id}"]`);
  if (!el) return 'no-opt';
  const bb = await el.boundingBox();
  if (!bb) return 'hidden-opt';
  const info = await el.evaluate((e) => ({ cls: e.className, wrap: e.closest('.opt-wrap')?.className, cost: e.querySelector('.cost')?.textContent, reason: e.closest('.opt-wrap')?.querySelector('.opt-reason')?.textContent }));
  for (let i = 0; i < times; i++) { await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(gap); }
  return info;
};
const finish = () => scene(page, `for (let t=0;t<400 && m.player.task;t++){ m.step(); s.handleEvents(m.events); }`);
const cost = (k) => scene(page, `return m.buildCost('${k}', m.playerRoom)`);

// 1: exact money, 5 fast clicks on build:cannon
const cc = await cost('cannon');
log('cannon cost', cc);
await scene(page, `m.playerRoom.candy = ${cc.candy}`);
await tapCell(cells[0]);
log('1 exact money x5:', await menuOpt('build:cannon', 5));
await sleep(300); await finish(); log('   →', await room());

// 2: one short → grey, price visible, click does nothing
await scene(page, `m.playerRoom.candy = ${cc.candy - 1}`);
await tapCell(cells[1]);
log('2 short by 1:', await menuOpt('build:cannon', 3, 80, cc.candy - 1.3));
await sleep(300); await finish(); log('   →', await room());

// 3: sell spam with confirm; refund once
await scene(page, `m.playerRoom.candy = 0`);
await page.mouse.click(5, 5); await sleep(300);
await tapCell(cells[0]);
const sv = await scene(page, `const b = m.playerRoom.buildings[0]; return m.sellValue(b)`);
log('3 sell (value', sv + '):', await menuOpt('sell', 1));
await sleep(1100);
const yes = await page.$('#menu .opt-yes');
if (yes) { const yb = await yes.boundingBox(); for (let i = 0; i < 4; i++) { await page.mouse.click(yb.x + yb.width / 2, yb.y + yb.height / 2); await sleep(60); } }
await sleep(300); await finish(); log('   → after 4x Да', await room());

// 4: sell → immediately build on the same cell
await scene(page, `m.playerRoom.candy = ${cc.candy}`);
await tapCell(cells[0]);
log('4 build on sold cell:', await menuOpt('build:cannon', 1));
await sleep(200); await finish(); log('   →', await room());

// 5: two different buildings into the same cell (trap, then cannon before trap finishes)
const tc = await cost('trap');
await scene(page, `m.playerRoom.candy = ${tc.candy + cc.candy + 5}; m.playerRoom.flame = 999`);
await tapCell(cells[2]);
await sleep(1100); await page.screenshot({ path: 'shots/s9-5a-menu.png' }); log('5a menu opts:', await page.$$eval('#menu [data-opt]', (a) => a.map((e) => e.dataset.opt + (e.getBoundingClientRect().height ? '' : '(hidden)') + ':' + e.className))); log('5a trap:', await menuOpt('build:trap', 1));
await sleep(150);
await tapCell(cells[2]);
log('5b cannon same cell while trap in progress:', await menuOpt('build:cannon', 1));
await sleep(200); await finish(); log('   →', await room());

// 6: build → immediately upgrade (tap the finished building, upgrade x5)
const up = await scene(page, `const b = m.playerRoom.buildings.find(b=>b.kind==='cannon'); return m.upgradeCost(b, m.playerRoom)`);
await scene(page, `m.playerRoom.candy = ${up.candy}`);
await tapCell(cells[0]);
log('6 upgrade x5 with money for one:', await menuOpt('upgrade', 5));
await sleep(200); await finish(); log('   →', await room());

// 7: sofa upgrade spam
const su = await scene(page, `return m.sofaUpgradeCost(m.playerRoom)`);
await scene(page, `m.playerRoom.candy = ${su ? su.candy : 0}`);
const sofa = await scene(page, `return m.playerRoom.sofa`);
await tapCell(sofa);
log('7 sofa x4:', await menuOpt('upgradeSofa', 4));
await sleep(200); await finish(); log('   →', await room());

// 8: door — full door repair via menu and 🔧; 50% → spam; upgrade during repair; break during repair
await scene(page, `m.phaseLeft = 0.05`);
await until(page, () => window.__game.scene.getScene('game').m.phase === 'night', null, 10000);
await scene(page, `m.ghost.state='hidden'; m.ghost.x = 0; m.ghost.y = 0;`); // keep the ghost away for now
const doorCell = await scene(page, `return { x: m.playerRoom.door.x, y: m.playerRoom.door.y }`);
await tapCell(doorCell);
log('8a full door menu repair:', await menuOpt('repair', 2));
await page.mouse.click(5, 5); await sleep(200);
await click(page, '#repair'); await sleep(300);
log('   🔧 full →', await room(), 'toast:', await page.$eval('#toast', (e) => e.className + ' / ' + e.textContent));
await scene(page, `const d = m.playerRoom.door; d.hp = d.maxHp * 0.5; d.repairCd = 0;`);
for (let i = 0; i < 10; i++) { await click(page, '#repair'); await sleep(30); }
await sleep(200);
log('8b 🔧 x10 at 50% →', await room());
const du = await scene(page, `return m.doorUpgradeCost(m.playerRoom)`);
await scene(page, `m.playerRoom.candy = ${du ? du.candy : 0}`);
await tapCell(doorCell);
log('8c upgrade door during repair:', await menuOpt('upgradeDoor', 1));
await sleep(200); log('   → right after', await room());
await finish(); log('   → finished', await room());
// break during repair: ghost pinned attacking with low door HP, player repairing
await scene(page, `const r = m.playerRoom, d = r.door, gh = m.ghost; d.hp = 5; d.repairCd = 0; m.command(m.playerId, { type: 'repair' }); gh.targetRoom = r.id; gh.x = gh.prevX = d.front.x; gh.y = gh.prevY = d.front.y; gh.waypoints = []; gh.state = 'attacking'; gh.hitTimer = 0.05; gh.switchTimer = 1e9; gh.hp = gh.maxHp; gh.siegeHp = gh.hp; gh.siegeDoorHp = d.hp; gh.siegeTime = 0;`);
const beforeBreak = await room();
await sleep(1500);
log('8d door broken during repair: before', beforeBreak, 'after', await room(), 'caught', await scene(page, `return m.player.caught`));

// door HUD states over a new match
await sleep(1500);
const inv = await page.evaluate(() => window.__inv.slice(0, 20));
log('invariant violations:', inv.length ? inv : 'none');
log('errors:', (await state(page)).errors, logs.filter((l) => !l.includes('GL Driver') && !l.includes('404')).slice(0, 5));
await browser.close();
