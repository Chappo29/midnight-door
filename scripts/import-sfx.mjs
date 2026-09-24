/**
 * Импорт звуков: docs/audio/source/<ключ>_c<N>.mp3 (скачанные кандидаты с Pixabay,
 * список и источники — docs/audio/source/list.txt) → src/assets/sfx/.
 * Срезает тишину в начале, обрезает по длине события с затуханием,
 * выравнивает громкость, жмёт в mono mp3.
 *   npm run sfx
 * Выбранный вариант переименовывается в <ключ>.mp3 (см. `npm run sfx -- pick click=2 shot=1 …`).
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const SRC = 'docs/audio/source';
const OUT = 'src/assets/sfx';

/** Максимальная длина звука события, секунды. */
const MAX = {
  click: 0.4, popup: 0.6, deny: 1.0, start: 2.5, build: 1.2, hammer: 0.5, upgrade: 1.2, sold: 1.2,
  repair: 0.9, door_hit: 0.2, door_break: 2.0, shot: 0.8, jelly_hit: 0.8, ghost_laugh: 1.7,
  ghost_boo: 2.0, ghost_dead: 1.5, ghost_retreat: 1.2, midnight: 4.0, tick: 0.5, win: 5.0, lose: 4.0,
};

const args = process.argv.slice(2);
if (args[0] === 'pick') {
  // npm run sfx -- pick click=2 shot=1 — выбранный вариант копируется в <ключ>.mp3;
  // кандидаты остаются, чтобы можно было переслушать и перевыбрать.
  for (const a of args.slice(1)) {
    const [key, n] = a.split('=');
    const chosen = path.join(OUT, `${key}_c${n}.mp3`);
    if (!fs.existsSync(chosen)) throw new Error(`Нет ${chosen}`);
    fs.copyFileSync(chosen, path.join(OUT, `${key}.mp3`));
    console.log(`${key} ← вариант ${n}`);
  }
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
// Пересобираем только кандидатов; уже выбранные <ключ>.mp3 не трогаем.
for (const f of fs.readdirSync(OUT)) if (/_c\d+\.mp3$/.test(f)) fs.unlinkSync(path.join(OUT, f));
let total = 0;
let count = 0;
for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.mp3'))) {
  const key = f.replace(/_c\d+\.mp3$/, '');
  const max = MAX[key] ?? 2;
  const fade = Math.min(0.15, max / 4);
  const filter = [
    // Тишина в начале — долой, иначе звук «опаздывает» за событием.
    'silenceremove=start_periods=1:start_threshold=-45dB',
    `atrim=0:${max}`,
    `afade=t=out:st=${Math.max(0, max - fade)}:d=${fade}`,
    'loudnorm=I=-18:TP=-2:LRA=11',
  ].join(',');
  const out = path.join(OUT, f);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(SRC, f), '-af', filter, '-ac', '1', '-ar', '44100', '-b:a', '64k', out]);
  total += fs.statSync(out).size;
  count++;
}
console.log(`${count} файлов, ${(total / 1024).toFixed(0)} КБ → ${OUT}`);
