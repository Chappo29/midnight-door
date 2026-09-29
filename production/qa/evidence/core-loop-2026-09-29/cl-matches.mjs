// Повторный прогон матчей в настоящем клиенте (CORE_LOOP_UX_PASS.md, п. 10): сцена, HUD, финал — те же, что у игрока.
// Игроком управляет ИИ с реакцией «внимательного ребёнка» (решение раз в ~1–2 с); симуляция перематывается через
// обработчики событий сцены (GameScene.debugAdvance), кадры — в ключевые моменты, финал — в реальных кадрах.
//   node cl-matches.mjs   (сервер: конфиг audit, порт 5190)
import { launch, click, scene } from '../qa-final-2026-09-27/harness/harness.mjs';
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
      hints: [],
      meta: { coins: 0, daily: { step: 1, last: new Date().toISOString().slice(0, 10) }, tutorialGift: true },
      unlocks: { pumpkin: unlocked ? 'available' : 'locked', trap: 'locked', workbench: 'locked', fridge: 'locked' },
      settings: { muted: true },
    },
  });

const MATCHES = [
  { name: 'easy-m1', diff: 'easy', unlocked: false },
  { name: 'easy-m2a', diff: 'easy', unlocked: true },
  { name: 'easy-m2b', diff: 'easy', unlocked: true },
  { name: 'hard-m1', diff: 'hard', unlocked: false },
  { name: 'hard-m2', diff: 'hard', unlocked: true },
  { name: 'nightmare-m1', diff: 'nightmare', unlocked: false },
  { name: 'nightmare-m2', diff: 'nightmare', unlocked: true },
];

const browser = await launch();
const results = [];
try {
  for (const M of MATCHES) {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    await ctx.addInitScript((s) => {
      if (localStorage.getItem('__qa_seeded')) return;
      localStorage.clear();
      localStorage.setItem('__qa_seeded', '1');
      localStorage.setItem('midnight-door-progress', s);
    }, save(M.unlocked));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install();
    await page.goto(URL);
    const run = async (ms) => {
      for (let left = ms; left > 0; left -= 500) await page.clock.runFor(Math.min(500, left));
    };
    for (let i = 0; i < 60 && !(await page.evaluate(() => !!window.__game && !!window.__save)); i++) await run(500);
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 200);
    for (let i = 0; i < 80 && !(await page.$(`#screen.show button[data-d="${M.diff}"]`)); i++) await run(250);
    await run(1200);
    while (await page.$('#dailyClaim')) (await click(page, '#dailyClaim', { touch: true }), await run(1400));
    await click(page, `#screen.show button[data-d="${M.diff}"]`, { touch: true });
    for (let i = 0; i < 80 && !(await page.evaluate(() => window.__game.scene.isActive('game') && window.__game.scene.getScene('game').m?.phase === 'pick')); i++) await run(250);
    // ИИ-игрок с реакцией ребёнка; журнал событий своей комнаты — через обработчик сцены.
    await scene(
      page,
      `m.opts.autoPlayer = true; m.opts.autoPlayerSkill = 0.6; m.player.profile = { ...m.player.profile, pace: 0.35 };
       const L = (window.__cl = { ev: [], door: [], flame: [], ends: 0, prep: -1, pumpkin: -1, flameUse: null, prevFlame: 0, shots: {} });
       const e0 = s.gd.onEnd; s.gd.onEnd = () => { L.ends++; e0(); };
       const h0 = s.handleEvents.bind(s);
       s.handleEvents = (events) => {
         h0(events);
         const r = m.playerRoom; if (!r) return;
         if (L.prep < 0 && m.phase === 'prep') L.prep = m.time;
         if (L.prep < 0 || m.player.caught) return;
         const t = m.time - L.prep;
         for (const e of events) {
           if ('roomId' in e && e.roomId !== r.id) continue;
           if (['built', 'upgraded', 'doorUpgraded', 'sofaUpgraded', 'repaired'].includes(e.type)) L.ev.push([t, e.type === 'built' ? 'build:' + e.kind : e.type]);
           if (e.type === 'built' && e.kind === 'pumpkin' && L.pumpkin < 0) L.pumpkin = t;
           if (e.type === 'siegeEnd' && e.meaningful) L.ev.push([t - (m.nightTime - e.start), 'attack', Math.round(100 * e.dmg / r.door.maxHp)]);
         }
         if (r.flame < L.prevFlame - 1e-6 && L.flameUse === null && L.pumpkin >= 0) L.flameUse = t - L.pumpkin;
         L.prevFlame = r.flame;
         if (m.phase === 'night' && Math.round(m.time * 20) % 20 === 0) { L.door.push(r.door.hp / r.door.maxHp); L.flame.push(r.flame); }
       };`,
    );
    // Перемотка по 1 с; в ключевые моменты — настоящий кадр и снимок.
    const want = new Set();
    for (let sec = 0; sec < 1500; sec++) {
      const st = await scene(
        page,
        `s.debugAdvance(1); const r = m.playerRoom; const gh = m.ghost;
         return { phase: m.phase, result: m.result, caught: m.player.caught, siege: !!r && gh.siegeRoom === r.id, low: !!r && !r.door.broken && r.door.hp < r.door.maxHp * 0.5, repairing: m.player.task?.kind === 'repair' };`,
      );
      const snap = async (key) => {
        if (want.has(key)) return;
        want.add(key);
        await run(200);
        await page.screenshot({ path: `${OUT}m-${M.name}-${key}.png` });
      };
      if (st.siege) await snap('1-first-attack');
      if (st.low) await snap('2-door-below-50');
      if (st.repairing) await snap('3-repair');
      if (st.phase === 'end' || st.result) break;
    }
    // Финал в реальных кадрах: итоги должны появиться один раз и не раньше конца финала.
    let resultAt = null;
    for (let t = 0; t <= 4000; t += 100) {
      if (t === 700) await page.screenshot({ path: `${OUT}m-${M.name}-4-finale.png` });
      await run(100);
      if (resultAt === null && (await page.$('#screen.show .result-card'))) resultAt = t;
    }
    await page.screenshot({ path: `${OUT}m-${M.name}-5-result.png` });
    const L = await page.evaluate(() => {
      const s = window.__game.scene.getScene('game');
      const m = s.m;
      return { ...window.__cl, result: m.result, caught: m.player.caught, night: m.nightTime, flameEnd: m.playerRoom?.flame ?? 0, finale: s.finale };
    });
    // Метрики.
    const ev = L.ev.sort((a, b) => a[0] - b[0]);
    const end = (L.prep >= 0 ? ev.at(-1)?.[0] ?? 0 : 0);
    const ts = [0, ...ev.map((e) => e[0])];
    let maxGap = 0;
    let firstBored = null;
    for (let k = 1; k < ts.length; k++) {
      const gap = ts[k] - ts[k - 1];
      if (gap > maxGap) maxGap = gap;
      if (gap > 30 && firstBored === null) firstBored = ts[k - 1] + 30;
    }
    const attacks = ev.filter((e) => e[1] === 'attack');
    const r = {
      match: M.name,
      outcome: L.caught ? 'caught' : L.result,
      night: +(L.night / 60).toFixed(1),
      attacks: attacks.length,
      attackLoss: attacks.map((a) => a[2]),
      attacksNeedRepair: attacks.filter((a) => a[2] >= 50).length,
      minDoor: Math.round(100 * Math.min(1, ...L.door)),
      repairs: ev.filter((e) => e[1] === 'repaired').length,
      purchases: ev.filter((e) => e[1] !== 'attack' && e[1] !== 'repaired').length,
      maxGap: Math.round(maxGap),
      firstBored: firstBored === null ? null : Math.round(firstBored),
      flameEnd: Math.round(L.flameEnd),
      flameMax: Math.round(Math.max(0, ...L.flame)),
      flameFirstUse: L.flameUse === null ? null : Math.round(L.flameUse),
      resultShownAfterMs: resultAt,
      onEnd: L.ends,
      errors,
      _span: Math.round(end),
    };
    results.push(r);
    log(r);
    await ctx.close();
  }
} finally {
  await browser.close();
}
import('fs').then((fs) => fs.writeFileSync(OUT + 'matches.json', JSON.stringify(results, null, 2)));
