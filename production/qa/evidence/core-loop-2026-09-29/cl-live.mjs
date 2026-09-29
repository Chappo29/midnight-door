// Core loop UX pass (CORE_LOOP_UX_PASS.md): живая проверка на замороженных часах, тихо, по одному сценарию.
//   node cl-live.mjs [victory|door|flame|queue|retreat|all]  (сервер: конфиг audit, порт 5190; QA_URL — другой)
// Время в странице идёт только через clock.runFor — каждый кадр финала можно снять.
import { launch, click, sleep, until, scene } from '../qa-final-2026-09-27/harness/harness.mjs';
import { fileURLToPath } from 'url';
import path from 'path';

const OUT = path.dirname(fileURLToPath(import.meta.url)) + '/';
const URL = process.env.QA_URL || 'http://localhost:5190/';
const log = (...a) => console.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
const save = (unlocked) =>
  JSON.stringify({
    v: 2,
    rev: 50,
    at: 1,
    progress: {
      matches: unlocked ? 1 : 0,
      wins: { easy: unlocked ? 1 : 0, hard: 0, nightmare: 0 },
      tutorial: 'done',
      hints: ['pan', 'basic-cannon', 'basic-door', 'range', 'level', 'retreat', 'left', 'sell', 'flame'],
      meta: { coins: 0, daily: { step: 1, last: new Date().toISOString().slice(0, 10) }, tutorialGift: true },
      unlocks: { pumpkin: unlocked ? 'available' : 'locked', trap: 'locked', workbench: 'locked', fridge: 'locked' },
      settings: { muted: true },
    },
  });

async function openPage(browser, { w, h, touch, unlocked }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => {
    if (localStorage.getItem('__qa_seeded')) return;
    localStorage.clear();
    localStorage.setItem('__qa_seeded', '1');
    localStorage.setItem('midnight-door-progress', s);
  }, save(unlocked));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto(URL);
  const run = async (ms) => {
    for (let left = ms; left > 0; left -= 500) await page.clock.runFor(Math.min(500, left));
  };
  for (let i = 0; i < 60 && !(await page.evaluate(() => !!window.__game && !!window.__save)); i++) await run(500);
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 200);
  // Меню → «Лёгкая».
  for (let i = 0; i < 80 && !(await page.$('#screen.show button[data-d="easy"]')); i++) await run(250);
  await run(1200);
  while (await page.$('#dailyClaim')) (await click(page, '#dailyClaim', { touch }), await run(1400));
  if (!(await page.$('#screen.show button[data-d="easy"]'))) await page.screenshot({ path: OUT + 'debug-menu.png' });
  await click(page, '#screen.show button[data-d="easy"]', { touch });
  for (let i = 0; i < 80 && !(await page.evaluate(() => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick')); i++) await run(250);
  await run(400);
  await scene(page, `window.__qa2 = { ends: 0 }; const e = s.gd.onEnd; s.gd.onEnd = () => { window.__qa2.ends++; e(); };`);
  return { ctx, page, run, errors };
}

/** До ночи: своя комната, подготовка пропущена, призрак вышел. */
async function toNight(page, run) {
  await scene(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  for (let i = 0; i < 80 && (await scene(page, 'return m.phase')) !== 'prep'; i++) await run(250);
  await scene(page, `m.player.x = m.playerRoom.door.inside.x + 0.5; m.player.y = m.playerRoom.door.inside.y + 0.5; m.player.path = []; m.phaseLeft = 0.05; s.fitCamera();`);
  for (let i = 0; i < 40 && (await scene(page, 'return m.phase')) !== 'night'; i++) await run(250);
  await run(3500);
}

const shot = (page, name) => page.screenshot({ path: OUT + name + '.png' });

/** Призрак у двери комнаты roomId, бьёт её; добить его одним выстрелом пушки у этой двери. */
const setupKill = (page, roomId) =>
  scene(
    page,
    `const gh = m.ghost; const r = m.rooms[arg]; gh.state = 'attacking'; gh.targetRoom = r.id; gh.x = gh.prevX = r.door.front.x; gh.y = gh.prevY = r.door.front.y;
     gh.waypoints = []; gh.switchTimer = 1e9; gh.desperate = true; gh.hp = 1;
     r.buildings = r.buildings.filter((b) => !(b.x === r.door.inside.x && b.y === r.door.inside.y));
     r.buildings.push({ kind: 'cannon', x: r.door.inside.x, y: r.door.inside.y, level: 6, cooldown: 0.4 });`,
    roomId,
  );
const finaleState = (page) =>
  scene(page, `const f = s.finale; const c = s.cameras.main; return { f: f && { t: Math.round(f.t), deathAt: f.deathAt, done: f.done }, ends: window.__qa2.ends, screen: document.querySelector('#screen.show .result-card') ? 'result' : null, cam: [Math.round(c.midPoint.x), Math.round(c.midPoint.y)], banner: document.querySelector('#banner.show')?.textContent ?? null }`);

async function victoryCase(browser, name, { w, h, touch, pick }) {
  const { ctx, page, run, errors } = await openPage(browser, { w, h, touch, unlocked: false });
  await toNight(page, run);
  // pick: какую комнату бьёт призрак и что делает камера до выстрела.
  const roomId = await scene(page, pick);
  await setupKill(page, roomId);
  const before = await scene(page, `return { mine: m.player.roomId, target: arg, visible: s.onScreenSafe(s.ghostView.x, s.ghostView.y - 24, 38) }`, roomId);
  // До выстрела (перезарядка 0,4 с).
  for (let i = 0; i < 40 && !(await scene(page, 'return !!s.finale')); i++) await run(50);
  const timeline = [];
  let shots = 0;
  for (let t = 0; t <= 3200; t += 100) {
    const st = await finaleState(page);
    timeline.push({ t, ...st });
    if ([100, 400, 900, 1400].includes(t) || (st.screen === 'result' && shots < 5)) {
      await shot(page, `${name}-${String(t).padStart(4, '0')}`);
      if (st.screen === 'result') shots = 5;
    }
    await run(100);
  }
  const firstResult = timeline.find((x) => x.screen === 'result');
  const cams = timeline.map((x) => x.cam.join(','));
  log(`${name}:`, before, {
    panned: new Set(cams.slice(0, 8)).size > 1,
    victoryBannerAt: timeline.find((x) => x.banner === 'Победа!')?.t ?? null,
    resultAt: firstResult?.t ?? null,
    finaleDoneAt: timeline.find((x) => x.f?.done)?.t ?? null,
    ends: timeline.at(-1).ends,
    errors,
  });
  await ctx.close();
}

const which = process.argv[2] || 'all';
const browser = await launch();
try {
  if (which === 'victory' || which === 'all') {
    const PHONE = { w: 844, h: 390, touch: true };
    const PC = { w: 1280, h: 720, touch: false };
    // 1) Призрак у моей двери, я в комнате, камера на месте — он на экране.
    await victoryCase(browser, 'v1-phone-at-my-door', { ...PHONE, pick: 'return m.player.roomId' });
    // 2) Призрак у самой дальней от меня комнаты — вне экрана.
    const far = `const me = m.playerRoom; const d = (r) => Math.hypot(r.door.x - me.door.x, r.door.y - me.door.y); return [...m.rooms].filter(r => r.ownerId !== null && r.id !== me.id).sort((a, b) => d(b) - d(a))[0].id`;
    await victoryCase(browser, 'v2-phone-far-offscreen', { ...PHONE, pick: far });
    // 3) Призрак у ближайшего соседа.
    const near = `const me = m.playerRoom; const d = (r) => Math.hypot(r.door.x - me.door.x, r.door.y - me.door.y); return [...m.rooms].filter(r => r.ownerId !== null && r.id !== me.id).sort((a, b) => d(a) - d(b))[0].id`;
    await victoryCase(browser, 'v3-phone-neighbor', { ...PHONE, pick: near });
    // 4) Камеру вручную отвели далеко от призрака (он у моей двери).
    const away = `const c = s.cameras.main; const me = m.playerRoom; c.centerOn((me.door.x > 20 ? 4 : 40) * 48, (me.door.y > 12 ? 3 : 22) * 48); s.clampCamera(); return me.id`;
    await victoryCase(browser, 'v4-phone-camera-dragged-away', { ...PHONE, pick: away });
    // 5) ПК: призрак у дальнего соседа (вся карта может влезать — тогда камера не нужна).
    await victoryCase(browser, 'v5-pc-far', { ...PC, pick: far });
  }
  if (which === 'door' || which === 'all') {
    // Атака на мою дверь на телефоне; меню постройки открыто рядом с дверью — не закрывает её.
    const { ctx, page, run, errors } = await openPage(browser, { w: 844, h: 390, touch: true, unlocked: false });
    await toNight(page, run);
    // Камеру отвели в сторону — «Призрак идёт к тебе!» возвращает её к двери.
    await scene(page, `const c = s.cameras.main; const me = m.playerRoom; c.centerOn((me.door.x > 20 ? 4 : 40) * 48, (me.door.y > 12 ? 3 : 22) * 48); s.clampCamera();`);
    await run(300);
    await shot(page, 'd1-camera-away-before-attack');
    await scene(page, `const gh = m.ghost; gh.state = 'moving'; gh.hp = gh.maxHp; gh.x = gh.prevX = m.nest.x; gh.y = gh.prevY = m.nest.y; s.handleEvents([{ type: 'ghostTarget', roomId: m.player.roomId }]); gh.targetRoom = m.player.roomId; gh.state='attacking'; const r = m.playerRoom; gh.x = gh.prevX = r.door.front.x; gh.y = gh.prevY = r.door.front.y; gh.waypoints = []; gh.switchTimer = 1e9; gh.hitTimer = 0.3; r.candy = 200;`);
    await run(900);
    await shot(page, 'd2-attack-camera-back-at-door');
    const cell = await scene(page, `const r = m.playerRoom; const c = m.placeableCells(r, 'cannon').sort((a, b) => Math.hypot(a.x - r.door.x, a.y - r.door.y) - Math.hypot(b.x - r.door.x, b.y - r.door.y))[0]; return c;`);
    await scene(page, `const cam = s.cameras.main; const x = ((arg.x + 0.5) * 48 - cam.worldView.x) * cam.zoom; const y = ((arg.y + 0.5) * 48 - cam.worldView.y) * cam.zoom; s.tap({ x, y });`, cell);
    await run(600);
    await shot(page, 'd3-attack-menu-beside-door');
    const menu = await page.evaluate(() => {
      const m = document.getElementById('menu').getBoundingClientRect();
      const s = window.__game.scene.getScene('game');
      const a = s.doorAvoidRect();
      return { menu: [m.left, m.top, m.right, m.bottom].map(Math.round), door: a && [a.left, a.top, a.right, a.bottom].map(Math.round), overlap: !!a && m.left < a.right && m.right > a.left && m.top < a.bottom && m.bottom > a.top };
    });
    log('door:', menu, { errors });
    await ctx.close();
  }
  if (which === 'flame' || which === 'all') {
    // Матч 2: тыква открыта — цена улучшения пушки до ур. 3 с пламенем и зачёркнутой ценой без огня.
    const { ctx, page, run, errors } = await openPage(browser, { w: 844, h: 390, touch: true, unlocked: true });
    await toNight(page, run);
    await scene(page, `const r = m.playerRoom; const c = m.placeableCells(r, 'cannon')[0]; r.buildings.push({ kind: 'cannon', x: c.x, y: c.y, level: 2, cooldown: 0 }); r.candy = 60; r.flame = 40; m.ghost.state = 'hidden';`);
    await run(300);
    const b = await scene(page, `return m.playerRoom.buildings.find(b => b.kind === 'cannon' && b.level === 2)`);
    await scene(page, `const cam = s.cameras.main; const x = ((arg.x + 0.5) * 48 - cam.worldView.x) * cam.zoom; const y = ((arg.y + 0.5) * 48 - cam.worldView.y) * cam.zoom; s.tap({ x, y });`, b);
    await run(500);
    await shot(page, 'f1-cannon-l3-price-with-flame');
    const txt = await page.evaluate(() => [...document.querySelectorAll('#menu .opt-wrap')].map((w) => w.textContent.replace(/\s+/g, ' ').trim()));
    log('flame menu:', txt, { errors });
    await ctx.close();
  }
  if (which === 'queue' || which === 'all') {
    // Покупка: строит пушку (оплачено), тап по другой клетке — стройка не отменяется, конфеты не «пропадают».
    const { ctx, page, run, errors } = await openPage(browser, { w: 844, h: 390, touch: true, unlocked: false });
    await toNight(page, run);
    await scene(page, `m.ghost.state = 'hidden'; m.playerRoom.candy = 120;`);
    const cells = await scene(page, `const r = m.playerRoom; return m.placeableCells(r, 'cannon').filter(c => !(c.x === r.door.inside.x && c.y === r.door.inside.y)).slice(0, 3)`);
    await scene(page, `s.cmd({ type: 'build', kind: 'cannon', ...arg })`, cells[0]);
    for (let i = 0; i < 40 && (await scene(page, `return m.player.task?.stage`)) !== 'work'; i++) await run(100);
    const paidCandy = await scene(page, `return Math.round(m.playerRoom.candy)`);
    // Двойной тап и тап по другой клетке во время работы (как ребёнок).
    for (const c of [cells[1], cells[1], cells[2]]) {
      await scene(page, `const cam = s.cameras.main; const x = ((arg.x + 0.5) * 48 - cam.worldView.x) * cam.zoom; const y = ((arg.y + 0.5) * 48 - cam.worldView.y) * cam.zoom; s.tap({ x, y }); s.hud.hideMenu();`, c);
      await run(120);
    }
    await shot(page, 'q1-tap-during-build');
    await run(2500);
    await shot(page, 'q2-build-finished');
    const res = await scene(page, `return { cannons: m.playerRoom.buildings.filter(b => b.kind === 'cannon').length, candy: Math.round(m.playerRoom.candy), queue: m.player.queue.length, task: m.player.task?.cmd.type ?? null }`);
    log('queue:', { paidCandy, ...res, errors });
    await ctx.close();
  }
  if (which === 'retreat' || which === 'all') {
    const { ctx, page, run, errors } = await openPage(browser, { w: 844, h: 390, touch: true, unlocked: false });
    await toNight(page, run);
    await scene(page, `const gh = m.ghost; const r = m.playerRoom; gh.state = 'attacking'; gh.targetRoom = r.id; gh.x = gh.prevX = r.door.front.x; gh.y = gh.prevY = r.door.front.y; gh.waypoints = []; gh.switchTimer = 1e9; gh.hp = gh.maxHp * 0.2; gh.siegeRoom = r.id;`);
    await run(300);
    await shot(page, 'r1-retreat-banner');
    const b1 = await page.evaluate(() => document.querySelector('#banner.show')?.textContent ?? null);
    // Долетел и отлечился: выход из гнезда к моей двери.
    await scene(page, `const gh = m.ghost; gh.x = gh.prevX = m.nest.x; gh.y = gh.prevY = m.nest.y; gh.waypoints = []; gh.state = 'healing'; gh.healTimer = 0.1; m.ATTACK_FORCE = 1; const d = window.__game.scene.getScene('game'); gh.calmSince = m.rooms.map(() => -999); gh.attacked = m.rooms.map(() => true);`);
    await run(700);
    await shot(page, 'r2-healed-comes-back');
    const b2 = await page.evaluate(() => document.querySelector('#banner.show')?.textContent ?? null);
    log('retreat:', { b1, b2, target: await scene(page, 'return [m.ghost.targetRoom, m.player.roomId, m.ghost.state]'), errors });
    await ctx.close();
  }
} finally {
  await browser.close();
}
