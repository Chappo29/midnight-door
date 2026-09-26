/**
 * Сжимает спрайты игры без видимой потери: PNG с палитрой (как pngquant, sharp/libimagequant, quality 90).
 *   npm run sprites:compress              — все src/assets/sprites/*.png и src/assets/ui/*.png
 *   npm run sprites:compress -- pumpkin   — только указанные ключи
 * Файл заменяется, только если стал меньше и видимые пиксели почти не изменились (средняя разница ≤ MAX_DIFF
 * из 255, полностью прозрачные не считаются — их не видно). Уже сжатые файлы остаются как есть.
 * Запускать после импорта нового арта (npm run art): новые картинки приходят несжатыми.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const DIRS = ['src/assets/sprites', 'src/assets/ui'];
/** Предел средней разницы по видимым пикселям (0..255). На спрайтах игры выходит 1–2 — глазом не видно. */
const MAX_DIFF = 4;

const only = process.argv.slice(2);

/** Средняя разница по видимым пикселям: цвет взвешен прозрачностью, плюс разница самой прозрачности. */
async function visibleDiff(a, b) {
  const [pa, pb] = await Promise.all([sharp(a).ensureAlpha().raw().toBuffer(), sharp(b).ensureAlpha().raw().toBuffer()]);
  let d = 0;
  let n = 0;
  for (let i = 0; i < pa.length; i += 4) {
    const al = pa[i + 3] / 255;
    if (al < 0.05) continue;
    d += ((Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])) / 3) * al + Math.abs(pa[i + 3] - pb[i + 3]);
    n++;
  }
  return n ? d / n : 0;
}

let before = 0;
let after = 0;
let changed = 0;
const skipped = [];
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.png') && (!only.length || only.includes(f.replace(/\.png$/, ''))))) {
    const file = path.join(dir, f);
    const orig = fs.readFileSync(file);
    const out = await sharp(orig).png({ palette: true, quality: 90, effort: 10, dither: 1, compressionLevel: 9 }).toBuffer();
    before += orig.length;
    if (out.length >= orig.length) {
      after += orig.length;
      continue;
    }
    const diff = await visibleDiff(orig, out);
    if (diff > MAX_DIFF) {
      skipped.push(`${f} (${diff.toFixed(1)})`);
      after += orig.length;
      continue;
    }
    fs.writeFileSync(file, out);
    after += out.length;
    changed++;
  }
}
const mb = (x) => (x / 1048576).toFixed(2);
console.log(`Сжато ${changed} файлов: ${mb(before)} МБ → ${mb(after)} МБ (−${Math.round((1 - after / Math.max(1, before)) * 100)}%)`);
if (skipped.length) console.log(`Оставлены как есть (заметная разница): ${skipped.join(', ')}`);
