/**
 * Режет лист 2×2 (или cols×rows) с прозрачным фоном на отдельные иконки.
 *   node scripts/slice-grid.mjs <лист.png> <папка> имя1,имя2,имя3,имя4 [--cols=2] [--rows=2] [--size=256]
 * Каждая ячейка обрезается по непрозрачному содержимому и вписывается в квадрат size×size.
 * Нейросеть ставит иконки впритык, поэтому границу ячейки двигаем к самой «пустой» колонке/строке рядом (±15%).
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (k, d) => Number(args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const [sheet, outDir, namesArg] = args.filter((a) => !a.startsWith('--'));
if (!sheet || !outDir || !namesArg) {
  console.error('Использование: node scripts/slice-grid.mjs <лист.png> <папка> имена,через,запятую');
  process.exit(1);
}
const cols = opt('cols', 2), rows = opt('rows', 2), size = opt('size', 256);
/** --raw: только обрезать по содержимому, без масштаба — для scripts/normalize-icons.mjs. */
const RAW = args.includes('--raw');
const names = namesArg.split(',');
const meta = await sharp(sheet).metadata();
const { data, info } = await sharp(sheet).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, Hh = info.height;
const opaque = (x, y) => data[(y * W + x) * 4 + 3] > 24;
/** Границы вдоль оси: равные доли, сдвинутые к минимуму непрозрачных пикселей в полосе [from, to) поперёк. */
function cuts(n, len, count) {
  const out = [0];
  for (let k = 1; k < n; k++) {
    const mid = Math.round((len * k) / n), r = Math.round((len / n) * 0.15);
    let best = mid, bestN = Infinity;
    for (let c = mid - r; c <= mid + r; c++) {
      const v = count(c);
      if (v < bestN || (v === bestN && Math.abs(c - mid) < Math.abs(best - mid))) { bestN = v; best = c; }
    }
    out.push(best);
  }
  out.push(len);
  return out;
}
const rowCuts = cuts(rows, Hh, (y) => { let n = 0; for (let x = 0; x < W; x++) if (opaque(x, y)) n++; return n; });
fs.mkdirSync(outDir, { recursive: true });
for (let i = 0; i < names.length; i++) {
  const ri = Math.floor(i / cols), ci = i % cols;
  const top = rowCuts[ri], height = rowCuts[ri + 1] - top;
  const colCuts = cuts(cols, W, (x) => { let n = 0; for (let y = top; y < top + height; y++) if (opaque(x, y)) n++; return n; });
  const left = colCuts[ci], width = colCuts[ci + 1] - left;
  const cell = await sharp(sheet).extract({ left, top, width, height }).png().toBuffer();
  const trimmed = await sharp(cell).trim({ threshold: 10 }).toBuffer();
  const out = path.join(outDir, `${names[i]}.png`);
  if (RAW) {
    await sharp(trimmed).png().toFile(out);
    console.log('→', out);
    continue;
  }
  await sharp(trimmed)
    .resize(size - 8, size - 8, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  console.log('→', out);
}
