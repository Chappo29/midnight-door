// Release-certification harness: serves the UNPACKED production ZIP and a mock Yandex host (/sdk.js + cloud store).
// Drives it with headless Chromium. No dev globals: only Phaser.GAMES (a public global of the shipped bundle).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
export const { chromium } = require('C:/Users/bitse/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright');

export const ROOT = process.env.RC_ROOT || 'C:/Users/bitse/AppData/Local/Temp/claude/C--Users-bitse-Desktop-projects-ghost-on-door/1c342518-5275-477e-b2c1-ec5cfa2a0782/scratchpad/zip1';
export const SHOTS = process.env.RC_SHOTS || 'C:/Users/bitse/AppData/Local/Temp/claude/C--Users-bitse-Desktop-projects-ghost-on-door/1c342518-5275-477e-b2c1-ec5cfa2a0782/scratchpad/shots/';
fs.mkdirSync(SHOTS, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

/** Mock host state, keyed by profile cookie (`prof`). */
export const host = {
  cloud: {}, // prof -> { save: string }
  auth: {}, // prof -> bool
  setCalls: {}, // prof -> [{t, bytes, flush}]
  getCalls: {}, // prof -> [t]
  reqLog: [], // {url, status}
  reset() { this.cloud = {}; this.auth = {}; this.setCalls = {}; this.getCalls = {}; this.reqLog = []; },
};

/** Client-side mock of the Yandex SDK (served as /sdk.js). Config in window.__MOCK before load. */
const SDK_JS = `(() => {
  const cfg = window.__MOCK || {};
  const log = (window.__ylog = []);
  const t0 = performance.now();
  const L = (ev, x) => log.push(Object.assign({ t: Math.round(performance.now() - t0), ev }, x || {}));
  const listeners = {};
  let gp = 'idle'; // gameplay state seen by the SDK
  let advOpen = false;
  const emit = (ev) => { L('emit', { name: ev }); (listeners[ev] || []).slice().forEach((f) => f()); };
  window.__emit = emit;
  window.__gp = () => gp;
  const prof = () => (document.cookie.match(/prof=([^;]+)/) || [])[1] || 'default';
  const api = (p, body) => fetch('/__host/' + p + '?prof=' + prof(), body ? { method: 'POST', body: JSON.stringify(body) } : undefined).then((r) => r.json());
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const player = {
    isAuthorized: () => !!window.__authState,
    getData: async (keys) => { L('getData', { keys }); await wait(cfg.getDataDelay || 0); if (cfg.getDataFail) throw new Error('getData fail'); const d = await api('get'); return d.data || {}; },
    setData: async (data, flush) => { const s = JSON.stringify(data); L('setData', { bytes: s.length, flush: !!flush }); await wait(cfg.setDataDelay || 0); if (cfg.setDataFail) throw new Error('setData fail'); const r = await api('set', { data, flush: !!flush, bytes: s.length }); if (r.error) throw new Error(r.error); },
    getName: () => 'Test', getPhoto: () => '', getUniqueID: () => 'u1',
  };
  const ysdk = {
    environment: { i18n: { lang: cfg.lang || 'ru', tld: 'ru' }, app: { id: '1' }, browser: { lang: cfg.lang || 'ru' } },
    features: {
      LoadingAPI: { ready() { L('ready'); } },
      GameplayAPI: {
        start() { L('gp_start', { prev: gp, advOpen, hidden: document.hidden }); if (gp === 'on') L('VIOLATION', { what: 'double start' }); gp = 'on'; },
        stop() { L('gp_stop', { prev: gp }); if (gp === 'off') L('VIOLATION', { what: 'double stop' }); gp = 'off'; },
      },
    },
    on(ev, cb) { L('on', { name: ev }); (listeners[ev] = listeners[ev] || []).push(cb); },
    off(ev, cb) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== cb); },
    getPlayer: async () => { L('getPlayer'); await wait(cfg.playerDelay || 0); if (cfg.playerFail) throw new Error('player fail'); window.__authState = window.__authState ?? (await api('auth')).auth; return player; },
    getStorage: async () => { L('getStorage'); return { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v), removeItem: (k) => localStorage.removeItem(k) }; },
    auth: { openAuthDialog: async () => { L('openAuthDialog'); await wait(cfg.authDelay || 300); if (cfg.authResult === 'cancel') throw new Error('cancelled'); await api('setauth', { v: true }); window.__authState = true; } },
    adv: {
      showFullscreenAdv({ callbacks: c = {} } = {}) {
        L('adv_call', { kind: 'interstitial', gp, advOpen });
        const mode = (cfg.interstitial || 'ok');
        setTimeout(() => {
          if (mode === 'error') return c.onError && c.onError(new Error('no ads'));
          if (mode === 'notshown') return c.onClose && c.onClose(false);
          if (mode === 'silent') return;
          advOpen = true; emit('game_api_pause'); c.onOpen && c.onOpen(); L('adv_open', { kind: 'interstitial', gp });
          setTimeout(() => { advOpen = false; c.onClose && c.onClose(true); emit('game_api_resume'); L('adv_close', { kind: 'interstitial' }); }, cfg.advDur || 1500);
        }, cfg.advDelay || 400);
      },
      showRewardedVideo({ callbacks: c = {} } = {}) {
        L('adv_call', { kind: 'rewarded', gp, advOpen });
        const mode = (cfg.rewarded || 'reward');
        setTimeout(() => {
          if (mode === 'error') return c.onError && c.onError(new Error('no video'));
          if (mode === 'silent') return;
          advOpen = true; emit('game_api_pause'); c.onOpen && c.onOpen(); L('adv_open', { kind: 'rewarded', gp });
          setTimeout(() => {
            if (mode === 'reward') { L('onRewarded'); c.onRewarded && c.onRewarded(); }
            advOpen = false; c.onClose && c.onClose(true); emit('game_api_resume'); L('adv_close', { kind: 'rewarded' });
          }, cfg.advDur || 1500);
        }, cfg.advDelay || 400);
      },
    },
    dispatchEvent: () => {},
    EVENTS: { EXIT: 'EXIT' },
  };
  window.YaGames = { init: (o) => { L('init_call', { o }); return new Promise((res, rej) => setTimeout(() => (cfg.initFail ? rej(new Error('init fail')) : (L('init_done'), res(ysdk))), cfg.initDelay || 0)); } };
  L('sdk_js_loaded');
})();`;

/** Audio probe: everything that reaches ctx.destination goes through an analyser we can read. */
export const AUDIO_PROBE = () => {
  const ctxs = (window.__ctxs = []);
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const origConnect = AudioNode.prototype.connect;
  const analysers = new Map();
  window.__rms = () => {
    let max = 0;
    for (const [, an] of analysers) {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      max = Math.max(max, Math.sqrt(s / buf.length));
    }
    return max;
  };
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      if (dest && dest.constructor && dest.constructor.name === 'AudioDestinationNode') {
        const ctx = dest.context;
        if (!analysers.has(ctx)) {
          const an = ctx.createAnalyser();
          an.fftSize = 2048;
          origConnect.call(an, dest);
          analysers.set(ctx, an);
        }
        return origConnect.call(this, analysers.get(ctx));
      }
    } catch (e) {}
    return origConnect.call(this, dest, ...rest);
  };
  const Orig = AC;
  const Wrapped = function (...a) { const c = new Orig(...a); ctxs.push(c); return c; };
  Wrapped.prototype = Orig.prototype;
  window.AudioContext = Wrapped;
  window.webkitAudioContext = Wrapped;
};

/** Start the server; returns {port, close}. */
export function serve(port = 5199) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const PFX = process.env.RC_PREFIX; if (PFX && u.pathname.startsWith(PFX)) u.pathname = u.pathname.slice(PFX.length - 1);
    const done = (status, type, body) => { host.reqLog.push({ url: u.pathname, status }); res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
    if (u.pathname === '/sdk.js') return done(200, 'text/javascript', SDK_JS);
    if (u.pathname.startsWith('/__host/')) {
      const prof = u.searchParams.get('prof') || 'default';
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const j = body ? JSON.parse(body) : {};
        const op = u.pathname.slice(8);
        const out = (o) => done(200, 'application/json', JSON.stringify(o));
        if (op === 'get') { (host.getCalls[prof] ||= []).push(Date.now()); return out({ data: host.cloud[prof] || {} }); }
        if (op === 'set') {
          (host.setCalls[prof] ||= []).push({ t: Date.now(), bytes: j.bytes, flush: j.flush });
          if (j.bytes > 200 * 1024) return out({ error: 'data too large' });
          host.cloud[prof] = { ...(host.cloud[prof] || {}), ...j.data };
          return out({});
        }
        if (op === 'auth') return out({ auth: !!host.auth[prof] });
        if (op === 'setauth') { host.auth[prof] = !!j.v; return out({}); }
        return done(404, 'text/plain', 'x');
      });
      return;
    }
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT.replace(/\//g, path.sep)) && !f.startsWith(ROOT)) return done(403, 'text/plain', 'no');
    fs.readFile(f, (e, data) => (e ? done(404, 'text/plain', 'not found') : done(200, MIME[path.extname(f)] || 'application/octet-stream', data)));
  });
  return new Promise((r) => srv.listen(port, () => r({ port, url: `http://localhost:${port}/`, close: () => srv.close() })));
}

export function launch(extraArgs = []) {
  return chromium.launch({
    headless: true,
    executablePath: 'C:/Users/bitse/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',
    args: ['--mute-audio', ...extraArgs],
  });
}

/**
 * New page. opts: w,h,touch, mock (cfg for the SDK, null → no /sdk.js at all: route aborted), prof (cookie), save (raw localStorage value),
 * noSdk → /sdk.js 404 (host absent).
 */
export async function open(browser, url, { w = 1280, h = 720, touch = false, mock = {}, prof = 'p1', save, ctx: reuse, noSdk = false, query = '', authState } = {}) {
  const ctx = reuse || (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 }));
  if (!reuse) await ctx.addCookies([{ name: 'prof', value: prof, url }]);
  await ctx.addInitScript(AUDIO_PROBE);
  await ctx.addInitScript(() => {
    let val;
    Object.defineProperty(window, 'Phaser', { configurable: true, get: () => val, set(v) { val = v; if (v && v.Game && !v.Game.__hooked) { const G = v.Game; v.Game = class extends G { constructor(c) { super(c); window.__pgame = this; } }; v.Game.__hooked = true; } } });
  });
  await ctx.addInitScript(([m]) => { window.__MOCK = m; window.__errors = []; window.addEventListener('error', (e) => window.__errors.push('error: ' + e.message)); window.addEventListener('unhandledrejection', (e) => window.__errors.push('rej: ' + String(e.reason && e.reason.message || e.reason))); }, [mock]);
  if (save !== undefined) {
    await ctx.addInitScript(([s]) => { if (localStorage.getItem('__seeded')) return; localStorage.setItem('__seeded', '1'); if (s !== null) localStorage.setItem('midnight-door-progress', s); }, [save]);
  }
  if (authState !== undefined) host.auth[prof] = authState;
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => logs.push('[requestfailed] ' + r.url()));
  if (noSdk) await page.route('**/sdk.js', (r) => r.fulfill({ status: 404, body: 'nope' }));
  await page.goto(url + query);
  return { ctx, page, logs };
}

export const ylog = (page) => page.evaluate(() => window.__ylog || []);
export const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.png' });
export async function until(page, fn, arg, timeout = 20000) { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); }

/** Game-level info from public global. */
export const gameInfo = (page) => page.evaluate(() => {
  const P = window.Phaser; const g = window.__pgame;
  const scr = document.getElementById('screen');
  const s = g && g.scene.getScene('game');
  const active = !!g && g.scene.isActive('game');
  return {
    hasPhaser: !!P, hasGame: !!g, active,
    screenShown: !!scr && scr.classList.contains('show'),
    screenCard: scr && scr.querySelector('.card, .menu-frame') ? (scr.querySelector('.card, .menu-frame').className) : null,
    buttons: [...(scr ? scr.querySelectorAll('button') : [])].map((b) => (b.id || b.dataset.d || b.className) + (b.disabled ? '(off)' : '')),
    phase: active && s && s.m ? s.m.phase : null,
    nightTime: active && s && s.m ? s.m.nightTime : null,
    bootOff: document.getElementById('boot')?.classList.contains('off'),
    frame: g ? g.loop.frame : null,
  };
});

export const SAVE_MATCH1 = JSON.stringify({ v: 2, rev: 10, at: 1000, progress: { matches: 1, tutorial: 'done', meta: { coins: 100 } } });
export const snap = (progress, rev = 10, at = 1000) => JSON.stringify({ v: 2, rev, at, progress });

/** Run code with g (game), s (GameScene), m (Match) in scope. */
export const sc = (page, code, arg) => page.evaluate(new Function('arg', `const g = window.__pgame; const s = g.scene.getScene('game'); const m = s && s.m; ${code}`), arg);

export async function click(page, sel) {
  const el = await page.$(sel);
  if (!el) throw new Error('no element ' + sel);
  const box = await el.boundingBox();
  if (!box) throw new Error('invisible ' + sel);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
export const has = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel);
export async function waitSel(page, sel, t = 15000) { await page.waitForFunction((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel, { timeout: t, polling: 50 }); }
export const gp = (page) => page.evaluate(() => window.__gp());
/** Emulate tab visibility (headless has no real tab switch). */
export const setHidden = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event(h ? 'blur' : 'focus'));
}, hidden);
export const audioState = (page) => page.evaluate(() => ({ rms: window.__rms ? window.__rms() : null, ctx: (window.__ctxs || []).map((c) => c.state) }));

export const out = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
/** From match start (pick phase) → night. Picks first free room, shortens prep. */
export async function toNight(page, timeout = 30000) {
  await page.waitForFunction(() => { const s = window.__pgame?.scene.getScene('game'); return window.__pgame?.scene.isActive('game') && s.m && s.m.phase === 'pick'; }, null, { timeout, polling: 50 });
  await sleep(600);
  await sc(page, `const r = m.rooms.find(r => r.ownerId === null); s.cmd({ type: 'pickRoom', roomId: r.id });`);
  await page.waitForFunction(() => window.__pgame.scene.getScene('game').m.phase === 'prep', null, { timeout, polling: 50 });
  await sc(page, `m.phaseLeft = 0.05;`);
  await page.waitForFunction(() => window.__pgame.scene.getScene('game').m.phase === 'night', null, { timeout, polling: 50 });
}
export const winNow = (page) => sc(page, `m.ghost.hp = 0; m.ghost.state = 'dead'; m.events.push({type:'ghostDead'}); m.finish('win','ghost');`);
export const loseNow = (page) => sc(page, `for (const c of m.chars) { const r = m.rooms.find(r => r.ownerId === c.id); r.eliminated = true; c.caught = true; } m.finish('lose','allCaught');`);
export const progress = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('midnight-door-progress')); } catch (e) { return null; } });

/** Force the player to be caught the same way the sim does (catchOwner minus ghost movement). */
export const catchPlayer = (page) => sc(page, `const r = m.playerRoom; r.eliminated = true; const c = m.player; c.caught = true; c.task = null; c.queue = []; c.path = []; m.events.push({ type: 'caught', roomId: r.id, charId: c.id }); m.onEliminated(c);`);
export async function startMatch(page, d = 'easy') { await click(page, `.diff-btn[data-d="${d}"]`); }
export async function passMenuIntro(page) {
  await waitSel(page, '#screen.show'); await sleep(1300);
  if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1400); if (await has(page, '#dailyClaim')) { await click(page, '#dailyClaim'); await sleep(1300); } }
}

export const SAVE_VET = JSON.stringify({ v: 2, rev: 50, at: 5000, progress: { matches: 9, wins: { easy: 5, hard: 1, nightmare: 0 }, tutorial: 'done', hints: [], meta: { coins: 300 }, unlocks: { pumpkin: 'available', trap: 'available', workbench: 'available', fridge: 'available' }, settings: { muted: false } } });

export async function cellXY(page, x, y) {
  return page.evaluate(([x, y]) => {
    const g = window.__pgame; const s = g.scene.getScene('game'); const cam = s.cameras.main; const TS = 48;
    const canvas = g.canvas.getBoundingClientRect();
    return { x: canvas.x + ((x + 0.5) * TS - cam.worldView.x) * cam.zoom, y: canvas.y + ((y + 0.5) * TS - cam.worldView.y) * cam.zoom };
  }, [x, y]);
}
/** Play tutorial with real clicks; returns list of steps passed. */
export async function playTutorial(page, { touch = false, stopAt = null, maxIter = 600 } = {}) {
  const log = []; let last = null;
  for (let i = 0; i < maxIter; i++) {
    const v = await page.evaluate(() => {
      const g = window.__pgame; const s = g.scene.getScene('game');
      if (!g.scene.isActive('game') || !s.tut) return null;
      const v = s.tut.view(); if (!v) return { done: true };
      return { id: v.step.id, target: v.target, menuOpt: v.step.menuOpt, menuOpen: s.hud.menuOpen, phase: s.m.phase };
    });
    if (!v || v.done) break;
    if (stopAt && v.id === stopAt) break;
    if (v.id !== last) (log.push(v.id), (last = v.id));
    if (v.id === 'intro') { const vp = page.viewportSize(); await page.mouse.click(vp.width / 2, vp.height / 2); }
    else if (v.menuOpen && v.menuOpt && (await page.$(`#menu button[data-opt="${v.menuOpt}"]`))) { await sleep(1100); if (touch) { const bx = await (await page.$(`#menu button[data-opt="${v.menuOpt}"]`)).boundingBox(); await page.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); } else await click(page, `#menu button[data-opt="${v.menuOpt}"]`); }
    else if (v.target.kind === 'cell') { await sleep(400); const p = await cellXY(page, v.target.at.x, v.target.at.y); if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); }
    else if (v.target.kind === 'dom' && v.id === 'repair') { if (touch) { const bx = await (await page.$('#repair')).boundingBox(); await page.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); } else await click(page, '#repair'); }
    await sleep(300);
  }
  return log;
}
