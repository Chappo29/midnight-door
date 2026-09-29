// QA harness: headless Chromium against the dev server (vite, DEV globals __game/__save/__platform).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/bitse/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright');

export const URL = process.env.QA_URL || 'http://localhost:5190/';
export const SHOTS = 'C:/Users/bitse/AppData/Local/Temp/claude/C--Users-bitse-Desktop-projects-ghost-on-door/136f9a63-8d4e-435e-905d-ec81bdf34360/scratchpad/qa/shots/';

/** Counts listeners/timers so leaks across rematches are visible. Runs before any page script. */
const INIT = () => {
  const counts = (window.__qa = { add: {}, remove: {}, errors: [], timeouts: 0, intervals: 0, raf: 0 });
  const wrap = (proto, name) => {
    const add = proto.addEventListener;
    const rem = proto.removeEventListener;
    proto.addEventListener = function (type, fn, opts) {
      const k = name + ':' + type;
      counts.add[k] = (counts.add[k] || 0) + 1;
      return add.call(this, type, fn, opts);
    };
    proto.removeEventListener = function (type, fn, opts) {
      const k = name + ':' + type;
      counts.remove[k] = (counts.remove[k] || 0) + 1;
      return rem.call(this, type, fn, opts);
    };
  };
  // Only window/document — element listeners die with their nodes.
  const w = window.addEventListener, wr = window.removeEventListener;
  window.addEventListener = function (t, f, o) { counts.add['win:' + t] = (counts.add['win:' + t] || 0) + 1; return w.call(this, t, f, o); };
  window.removeEventListener = function (t, f, o) { counts.remove['win:' + t] = (counts.remove['win:' + t] || 0) + 1; return wr.call(this, t, f, o); };
  const d = document.addEventListener.bind(document), dr = document.removeEventListener.bind(document);
  document.addEventListener = function (t, f, o) { counts.add['doc:' + t] = (counts.add['doc:' + t] || 0) + 1; return d(t, f, o); };
  document.removeEventListener = function (t, f, o) { counts.remove['doc:' + t] = (counts.remove['doc:' + t] || 0) + 1; return dr(t, f, o); };
  window.addEventListener('error', (e) => counts.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => counts.errors.push('rej: ' + String(e.reason)));
  void wrap;
};

export async function launch() {
  return chromium.launch({ headless: true, executablePath: 'C:/Users/bitse/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
}

/**
 * New page. save: undefined → keep, null → clean, string → raw localStorage value for the progress key.
 */
export async function open(browser, { w = 960, h = 540, touch = false, save = null, extra = {}, url = URL } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(INIT);
  if (save !== undefined) {
    await ctx.addInitScript(
      ([s, ex]) => {
        if (localStorage.getItem('__qa_seeded')) return;
        localStorage.clear();
        localStorage.setItem('__qa_seeded', '1');
        if (s !== null) localStorage.setItem('midnight-door-progress', s);
        for (const [k, v] of Object.entries(ex)) localStorage.setItem(k, v);
      },
      [save, extra],
    );
  }
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__save, null, { timeout: 30000 });
  return { ctx, page, logs };
}

/** Wait until predicate (string of JS evaluated in page) true. */
export async function until(page, fn, arg, timeout = 15000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 50 });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Snapshot of the interesting state. */
export async function state(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const s = g.scene.getScene('game');
    const active = g.scene.isActive('game');
    const m = s?.m;
    const scr = document.getElementById('screen');
    const card = scr?.querySelector('.card') ?? scr?.querySelector('.menu-frame');
    const p = window.__save.store.progress;
    return {
      active,
      screen: scr?.classList.contains('show') ? (card?.className.split(' ').find((c) => c.endsWith('-card')) || card?.className || 'screen?') : null,
      buttons: [...(scr?.querySelectorAll('button') ?? [])].filter((b) => b.id).map((b) => b.id + (b.disabled ? '(off)' : '')),
      phase: active ? m?.phase : null,
      result: active ? m?.result : null,
      tut: active ? !!m?.opts.tutorial : null,
      step: active ? s.tut?.view()?.step.id ?? null : null,
      paused: active ? { user: s.userPaused, hidden: s.hiddenPaused, caught: s.caughtPaused, ended: s.ended } : null,
      coins: p.meta.coins,
      matches: p.matches,
      wins: p.wins,
      tutorial: p.tutorial,
      unlocks: JSON.parse(JSON.stringify(p.unlocks)),
      boosters: { ...p.meta.boosters },
      rev: window.__save.store.revision,
      menu: !!document.querySelector('#menu.show, #menu .menu-card'),
      errors: window.__qa.errors.slice(),
    };
  });
}

export async function shot(page, name) {
  await page.screenshot({ path: SHOTS + name + '.png' });
}

/** Real click at element center (mouse or touch). */
export async function click(page, sel, { touch = false } = {}) {
  const el = await page.$(sel);
  if (!el) throw new Error('no element ' + sel);
  await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
  const box = await el.boundingBox();
  if (!box) throw new Error('invisible ' + sel);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Screen coordinate of a world cell center. */
export async function cellXY(page, x, y) {
  return page.evaluate(([x, y]) => {
    const s = window.__game.scene.getScene('game');
    const cam = s.cameras.main;
    const TS = 48;
    const canvas = window.__game.canvas.getBoundingClientRect();
    return { x: canvas.x + ((x + 0.5) * TS - cam.worldView.x) * cam.zoom, y: canvas.y + ((y + 0.5) * TS - cam.worldView.y) * cam.zoom };
  }, [x, y]);
}

/** Play tutorial to the end using real clicks on world cells / menu options / repair button. */
export async function playTutorial(page, { touch = false, stopAt = null } = {}) {
  const log = [];
  let last = null;
  for (let i = 0; i < 600; i++) {
    const v = await page.evaluate(() => {
      const s = window.__game.scene.getScene('game');
      if (!window.__game.scene.isActive('game') || !s.tut) return null;
      const v = s.tut.view();
      if (!v) return { done: true };
      return { id: v.step.id, target: v.target, menuOpt: v.step.menuOpt, menuOpen: s.hud.menuOpen, phase: s.m.phase };
    });
    if (!v || v.done) break;
    if (stopAt && v.id === stopAt) break;
    if (v.id !== last) (log.push(v.id), (last = v.id));
    if (v.id === 'intro') { const vp = page.viewportSize(); await page.mouse.click(vp.width / 2, vp.height / 2); }
    else if (v.menuOpen && v.menuOpt && (await page.$(`#menu button[data-opt="${v.menuOpt}"]`))) {
      await sleep(1100);
      await click(page, `#menu button[data-opt="${v.menuOpt}"]`, { touch });
    } else if (v.target.kind === 'cell') {
      await sleep(400);
      const p = await cellXY(page, v.target.at.x, v.target.at.y);
      if (touch) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    } else if (v.target.kind === 'dom' && v.id === 'repair') await click(page, '#repair', { touch });
    await sleep(300);
  }
  return log;
}

/** Scene internals shortcut. */
export const scene = (page, fn, arg) => page.evaluate(new Function('arg', `const g = window.__game; const s = g.scene.getScene('game'); const m = s.m; const p = window.__save.store.progress; ${fn}`), arg);

/** Close the tab and open a new one in the same browser profile (localStorage survives). */
export async function reopen(ctx, oldPage, url = URL) {
  await oldPage.close({ runBeforeUnload: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push('[' + m.type() + '] ' + m.text()); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__save, null, { timeout: 30000 });
  return { page, logs };
}
