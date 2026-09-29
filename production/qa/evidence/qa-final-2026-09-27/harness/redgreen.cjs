// Red-green: revert each fix in place, run its regression tests (must FAIL), restore the fixed file.
const fs = require('fs');
const { execSync } = require('child_process');
const ROOT = 'C:/Users/bitse/Desktop/projects/ghost on door/';

const cases = [
  { id: 'QA-01', file: 'src/platform/save.ts', rep: [["withTimeout(cloud.load(), LOAD_TIMEOUT_MS, 'getData')", 'cloud.load()']], tests: 'tests/save_platform_late.test.ts -t "QA-01"' },
  { id: 'QA-15', file: 'src/platform/save.ts', rep: [['if (pending) void connectPlayer(pending, store, log);', '']], tests: 'tests/save_platform_late.test.ts -t "QA-15"' },
  { id: 'QA-08 yandex', file: 'src/platform/yandex.ts', rep: [['export function lateYandexSdk(): Promise<YaSdk | null> {\n  return initOnce();', 'export function lateYandexSdk(): Promise<YaSdk | null> {\n  return Promise.resolve(null);']], tests: 'tests/save_platform_late.test.ts -t "QA-08"' },
  { id: 'QA-08 ready', file: 'src/platform/platform.ts', rep: [['    this.wantReady = true;\n    this.sendReady();', '    if (this.readySent) return;\n    this.readySent = true;\n    this.sdk?.features?.LoadingAPI?.ready();']], tests: 'tests/save_platform_late.test.ts -t "QA-08"' },
  { id: 'QA-08 main', file: 'src/main.ts', rep: [['  if (!saved.sdk) {\n    void lateYandexSdk()', '  if (false) {\n    void lateYandexSdk()']], tests: 'tests/main_flow.test.ts -t "test_late_sdk"' },
  { id: 'QA-02 ad', file: 'src/platform/platform.ts', rep: [["if (this.ad) return this.ad.kind === kind && kind === 'interstitial' ? this.ad.done : Promise.resolve(false);", 'if (this.ad) return Promise.resolve(false);']], tests: 'tests/save_platform_late.test.ts tests/main_flow.test.ts -t "QA-02|double_tap_difficulty|double_tap_try"' },
  { id: 'QA-02/03 nav', file: 'src/main.ts', rep: [['  if (my !== nav) return;\n', ''], ['  if (my !== nav) return;\n', ''], ['  if (my !== nav) return;\n', '']], tests: 'tests/main_flow.test.ts -t "QA-02, QA-03"' },
  { id: 'QA-21 part', file: 'src/main.ts', rep: [['onCloud: store.cloudAttached ? undefined : (cloudSave ?? undefined),', 'onCloud: cloudSave ?? undefined,']], tests: 'tests/main_flow.test.ts -t "save_button_hidden"' },
  { id: 'QA-04', file: 'src/ui/inputGuard.ts', rep: [['  if (now < s.readyAt || echo) return false;\n  if (trusted) s.last = { t: now, ...point };', '  if (trusted) s.last = { t: now, ...point };\n  if (now < s.readyAt || echo) return false;']], tests: 'tests/input-guard.test.ts -t "QA-04"' },
  { id: 'QA-06', file: 'src/style.css', rep: [['.caught-card .result-mascot {\n    display: none;', '.caught-card .result-mascot-x {\n    display: none;'], ['.card.daily-card {', '.daily-card {']], tests: 'tests/css-rules.test.ts' },
  { id: 'QA-07 rect', file: 'src/view/GameScene.ts', rep: [['off.x + (wx - cam.worldView.x)', '(wx - cam.worldView.x)'], ['off.y + (wy - cam.worldView.y)', '(wy - cam.worldView.y)']], tests: 'tests/scene_input_regress.test.ts -t "QA-07"' },
  { id: 'QA-07 echo', file: 'src/view/GameScene.ts', rep: [['this.hud.isEchoOfPress(this.downAt, p.x + off.x, p.y + off.y)', 'this.hud.isEchoOfPress(this.downAt, p.x, p.y)']], tests: 'tests/scene_input_regress.test.ts -t "QA-07"' },
  { id: 'QA-09', file: 'src/view/GameScene.ts', rep: [['        if (this.tut && !this.tut.done) return;\n        const [a, b] = touching;', '        const [a, b] = touching;']], tests: 'tests/scene_input_regress.test.ts -t "QA-09"' },
  { id: 'QA-18', file: 'src/view/GameScene.ts', rep: [['    this.hud.hideMenu();\n    this.selected = null;\n    this.fitCamera();\n  }', '    this.fitCamera();\n  }']], tests: 'tests/scene_input_regress.test.ts -t "QA-18"' },
  { id: 'QA-16', file: 'src/platform/platform.ts', rep: [['setTimeout(finish, adv ? AD_OPEN_TIMEOUT_MS : AD_TIMEOUT_MS)', 'setTimeout(finish, 90_000)'], ['          timer = setTimeout(finish, AD_TIMEOUT_MS);', '          timer = setTimeout(finish, 90_000 - 1);']], tests: 'tests/save_platform_late.test.ts -t "QA-16"' },
  { id: 'QA-19', file: 'src/main.ts', rep: [['    if (signingIn) return;\n', '']], tests: 'tests/main_flow.test.ts -t "double_tap_save"' },
  { id: 'QA-05', file: 'src/sim/ghost.ts', rep: [["const fleeing = g.state === 'moving' || g.state === 'attacking';", "const fleeing = g.state === 'moving' || g.state === 'attacking' || g.state === 'entering';"]], tests: 'tests/ghost_broken_door.test.ts' },
];

const run = (tests) => {
  try {
    const out = execSync(`npx vitest run ${tests}`, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, line: (out.match(/Tests\s+.*/) || [''])[0] };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    return { ok: false, line: (out.match(/Tests\s+.*/) || ['(no summary) ' + out.slice(0, 200)])[0] };
  }
};

for (const c of cases) {
  const path = ROOT + c.file;
  const orig = fs.readFileSync(path, 'utf8');
  const crlf = orig.includes('\r\n');
  let s = orig.replace(/\r\n/g, '\n');
  let missing = null;
  for (const [a, b] of c.rep) {
    if (!s.includes(a)) { missing = a; break; }
    s = s.replace(a, b);
  }
  if (missing) { console.log(`${c.id}: ANCHOR MISSING ${JSON.stringify(missing.slice(0, 60))}`); continue; }
  fs.writeFileSync(path, crlf ? s.replace(/\n/g, '\r\n') : s);
  let red;
  try { red = run(c.tests); } finally { fs.writeFileSync(path, orig); }
  const green = run(c.tests);
  console.log(`${c.id.padEnd(14)} reverted: ${red.ok ? 'PASS (!! test does not catch the bug)' : 'FAIL ✓'} ${red.line.trim()} | fixed: ${green.ok ? 'PASS ✓' : 'FAIL !!'} ${green.line.trim()}`);
}
