// S8: destructive tutorial — reload/close per step, skip paths, pause, exit, replay, full-door repair, spam, wrong taps.
import { launch, open, reopen, state, shot, click, sleep, until, scene, cellXY, playTutorial } from './harness.mjs';

const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const browser = await launch();
const brief = (s) => ({ active: s.active, tut: s.tut, step: s.step, screen: s.screen, coins: s.coins, matches: s.matches, tutorial: s.tutorial, rev: s.rev, err: s.errors.length });
const waitTut = (page) => until(page, () => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').tut, null, 20000);
const step = (page) => scene(page, `return s.tut?.view()?.step.id ?? null`);

// ---- A: reload / close-tab at several steps → tutorial restarts, nothing persisted
{
  let { ctx, page } = await open(browser, { save: null });
  for (const at of ['pick', 'sofa', 'cannon', 'midnight', 'repair', 'finale']) {
    await waitTut(page);
    await playTutorial(page, { stopAt: at });
    const before = await state(page);
    if (at === 'cannon' || at === 'finale') ({ page } = await reopen(ctx, page)); else await page.reload();
    await waitTut(page).catch(() => {});
    await sleep(800);
    const st = await state(page);
    log(`A ${at === 'cannon' || at === 'finale' ? 'close-tab' : 'reload'} at ${at}: before`, { step: before.step, coins: before.coins }, '→ after', brief(st));
  }
  await ctx.close();
}

// ---- B: skip by holding ⏭ at "cannon"; short hold (0.8 s) must not skip
{
  const { ctx, page } = await open(browser, { save: null });
  await waitTut(page);
  await playTutorial(page, { stopAt: 'cannon' });
  const b = await (await page.$('.tut-skip')).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await sleep(800); await page.mouse.up();
  await sleep(500);
  log('B short hold 0.8s → step', await step(page));
  await page.mouse.down(); await sleep(1600); await page.mouse.up();
  await sleep(2500);
  let st = await state(page);
  log('B long hold → ', brief(st), 'overlay nodes', await page.evaluate(() => document.querySelectorAll('.tut-top, .tut-dim').length));
  // after skip: a normal easy match must be running; tap on field works (no stuck pointer)
  await sleep(1500);
  const pick = await scene(page, `return { phase: m.phase, tutorial: !!m.opts.tutorial }`);
  log('   match after skip:', pick);
  await page.reload(); await sleep(4000);
  st = await state(page);
  log('   reload after skip →', brief(st));
  await ctx.close();
}

// ---- C: skip via pause → "Пропустить обучение"; D: pause → "Выйти в меню"; then replay tutorial from menu fully
for (const how of ['pauseSkip', 'pauseMenu']) {
  const { ctx, page } = await open(browser, { save: null });
  await waitTut(page);
  await playTutorial(page, { stopAt: 'door' });
  await page.keyboard.press('Escape');
  await sleep(600);
  let st = await state(page);
  log(`${how}: pause during tutorial → screen`, st.screen, st.buttons, 'exit pill:', await page.$eval('#screen #tomenu', (e) => e.textContent).catch(() => '-'));
  await click(page, how === 'pauseSkip' ? '#skiptut' : '#tomenu');
  await sleep(2500);
  st = await state(page);
  log(`   after ${how}:`, brief(st));
  if (how === 'pauseMenu') {
    // replay tutorial from menu, finish it; gift/matches must not change twice
    if (await page.$('#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1300); if (await page.$('#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1300); } }
    const c0 = (await state(page)).coins;
    await click(page, '#tut');
    await waitTut(page);
    await playTutorial(page);
    await until(page, () => document.querySelector('#screen.show .card'), null, 60000);
    await sleep(600);
    st = await state(page);
    log('   replay done:', brief(st), 'coins delta', st.coins - c0, 'buttons', st.buttons);
    // replay again, exit via pause → tutorial status must stay 'done'
    await click(page, '#play');
    await sleep(2500);
    await page.keyboard.press('Escape'); await sleep(600); await click(page, '#tomenu'); await sleep(1500);
    await click(page, '#tut'); await waitTut(page); await sleep(500);
    await page.keyboard.press('Escape'); await sleep(600); await click(page, '#tomenu'); await sleep(1500);
    st = await state(page);
    log('   replay #2 exited via pause:', brief(st));
  }
  await ctx.close();
}

// ---- E: full-door repair & spam & wrong taps & double-tap menu options
{
  const { ctx, page } = await open(browser, { save: null });
  await waitTut(page);
  await playTutorial(page, { stopAt: 'sofa' });
  // wrong taps everywhere during 'sofa'
  for (const [x, y] of [[100, 100], [640, 700], [1200, 300], [5, 5]]) { await page.mouse.click(x, y); await sleep(150); }
  log('E wrong taps at sofa → step', await step(page), 'menuOpen', await scene(page, `return s.hud.menuOpen`));
  // R / 🔧 on a full door before the repair step
  await page.keyboard.press('r'); await sleep(200);
  await click(page, '#repair').catch((e) => log('   #repair', e.message)); await sleep(300);
  log('   repair before repair-step → task', await scene(page, `return m.player.task?.kind ?? null`), 'toast', await page.$eval('#toast', (e) => e.className + ' ' + e.textContent).catch(() => '-'));
  // sofa: 5 fast taps on the sofa then double click on the option
  const sofa = await scene(page, `return m.playerRoom.sofa`);
  const p = await cellXY(page, sofa.x, sofa.y);
  for (let i = 0; i < 5; i++) { await page.mouse.click(p.x, p.y); await sleep(60); }
  await sleep(1200);
  const opt = await page.$('#menu button[data-opt="upgradeSofa"]');
  if (opt) { const ob = await opt.boundingBox(); await page.mouse.click(ob.x + ob.width / 2, ob.y + ob.height / 2); await sleep(90); await page.mouse.click(ob.x + ob.width / 2, ob.y + ob.height / 2); }
  await sleep(4000);
  log('   sofa spam → level', await scene(page, `return { sofa: m.playerRoom.sofaLevel ?? m.playerRoom.sofa.level ?? null, candy: m.playerRoom.candy, step: s.tut?.view()?.step.id }`));
  // continue to cannon; double click build option
  await playTutorial(page, { stopAt: 'cannon' });
  await sleep(600);
  const cc = await scene(page, `return s.tut.view().target.at`);
  const q = await cellXY(page, cc.x, cc.y);
  await page.mouse.click(q.x, q.y); await sleep(1200);
  const bo = await page.$('#menu button[data-opt="build:cannon"]');
  if (bo) { const bb = await bo.boundingBox(); for (let i = 0; i < 3; i++) { await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(70); } }
  await sleep(4000);
  log('   cannon triple click → cannons', await scene(page, `return { cannons: m.playerRoom.buildings.filter(b=>b.kind==='cannon').length, candy: Math.round(m.playerRoom.candy), step: s.tut?.view()?.step.id }`));
  // at "repair": spam 🔧 10x, then R held
  await playTutorial(page, { stopAt: 'repair' });
  await sleep(500);
  for (let i = 0; i < 10; i++) { await click(page, '#repair'); await sleep(40); }
  await sleep(3000);
  log('   repair spam → step', await step(page), 'door', await scene(page, `const d=m.playerRoom.door; return { hp: Math.round(d.hp), max: d.maxHp, cd: d.repairCd }`));
  await playTutorial(page);
  await until(page, () => document.querySelector('#screen.show .card'), null, 60000).catch(() => {});
  log('   finished after spam →', brief(await state(page)));
  await ctx.close();
}

// ---- F: hold ⏭ then press Esc (pause) — skip must not fire over the pause card
{
  const { ctx, page } = await open(browser, { save: null });
  await waitTut(page);
  await playTutorial(page, { stopAt: 'sofa' });
  const b = await (await page.$('.tut-skip')).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(1500);
  await page.mouse.up();
  await sleep(1500);
  log('F hold ⏭ + Esc →', brief(await state(page)));
  await ctx.close();
}

// ---- G: full tutorial on phone portrait with touch
{
  const { ctx, page } = await open(browser, { w: 390, h: 844, touch: true, save: null });
  await waitTut(page);
  const t0 = Date.now();
  const steps = await playTutorial(page, { touch: true });
  await until(page, () => document.querySelector('#screen.show .card'), null, 60000).catch(() => {});
  log('G phone touch tutorial:', steps.join('>'), Math.round((Date.now() - t0) / 1000) + 's', brief(await state(page)));
  await shot(page, 's8-G-phone-done');
  await ctx.close();
}
await browser.close();
