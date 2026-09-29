// Red-green for QA-10, QA-20, UX-16: revert each fix in place, run its tests (must FAIL), restore the fixed file.
const fs = require('fs');
const { execSync } = require('child_process');
const ROOT = 'C:/Users/bitse/Desktop/projects/ghost on door/';

const cases = [
  {
    id: 'QA-10',
    file: 'src/audio/sfx.ts',
    rep: [
      ['      if (s.pendingRemove) {\n        this.cancelFade(sound);\n        done?.();\n        return;\n      }\n', ''],
      ['        // Трек доиграл посреди затухания — затухание снимаем до destroy (см. fade).\n        this.cancelFade(m);\n', ''],
    ],
    tests: 'tests/sfx_music_fade.test.ts',
  },
  {
    id: 'QA-20',
    file: 'src/view/GameScene.ts',
    rep: [
      ["    const keys = 'W,A,S,D,UP,DOWN,LEFT,RIGHT,R,H,ESC';", "    const keys = 'W,A,S,D,UP,DOWN,LEFT,RIGHT,R,H,ESC,SPACE';"],
      ['    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => kb.removeCapture(keys));\n', ''],
    ],
    tests: 'tests/scene_input_regress.test.ts -t "QA-20"',
  },
  {
    id: 'UX-16',
    file: 'src/style.css',
    rep: [
      ['  #menu .menu-body {\n    padding: 10px;\n    gap: 8px;\n    max-height: calc(100vh - 90px);', '  #menu .menu-body-x {\n    padding: 10px;\n    gap: 8px;\n    max-height: 58vh;'],
      ['  #menu .opt {\n    min-height: 50px;', '  #menu .opt-x {\n    min-height: 64px;'],
    ],
    tests: 'tests/css-rules.test.ts -t "build_menu"',
  },
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
  console.log(`${c.id.padEnd(8)} reverted: ${red.ok ? 'PASS (!! test does not catch the bug)' : 'FAIL ✓'} ${red.line.trim()} | fixed: ${green.ok ? 'PASS ✓' : 'FAIL !!'} ${green.line.trim()}`);
}
