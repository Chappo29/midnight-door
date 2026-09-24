/**
 * Режет лист с позами (одна строка, прозрачный фон) на кадры анимации.
 *   node scripts/slice-sheet.mjs <лист.png> <ключ> [имена кадров через запятую]
 *   node scripts/slice-sheet.mjs docs/art/source/char0_sheet.png char0
 *   node scripts/slice-sheet.mjs лист.png - sofa,furniture1,furniture2 --each   — предметы, имя = ключ
 * Кадры → src/assets/sprites/<ключ>_<имя>.png, все на одном холсте:
 * ноги на нижней кромке, центр тела по центру — при смене кадра персонаж не «прыгает».
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const args = process.argv.slice(2);
/** --idle=210: масштаб по росту первой позы (покой) — одинаковый размер героя во всех листах. */
const idleOpt = args.find((a) => a.startsWith('--idle='));
const IDLE_H = idleOpt ? Number(idleOpt.split('=')[1]) : 0;
/** --each: предметы (не кадры) — каждый обрезается по себе и вписывается в 256×256. */
const EACH = args.includes('--each');
const [sheet, key, namesArg] = args.filter((a) => !a.startsWith('--'));
if (!sheet || !key) {
  console.error('Использование: node scripts/slice-sheet.mjs <лист.png> <ключ> [имена,через,запятую]');
  process.exit(1);
}
const names = (namesArg ?? 'idle,walk1,walk2,hammer1,hammer2,scared').split(',');
const OUT = 'src/assets/sprites';
/** Высота холста кадра в пикселях. */
const OUT_H = 256;
const ALPHA = 24;

const { data, info } = await sharp(sheet).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const opaque = (x, y) => data[(y * W + x) * 4 + 3] > ALPHA;

// 1. Границы поз. Нейросеть не всегда оставляет пустые промежутки (волосы соседей
// касаются), поэтому режем в самой «тонкой» колонке рядом с ожидаемой границей.
const colCount = Array.from({ length: W }, (_, x) => {
  let n = 0;
  for (let y = 0; y < H; y++) if (opaque(x, y)) n++;
  return n;
});
const filled = colCount.map((n) => n > 0);
const first = filled.indexOf(true);
const last = filled.lastIndexOf(true) + 1;
const step = (last - first) / names.length;
const cuts = [first];
for (let k = 1; k < names.length; k++) {
  const mid = Math.round(first + step * k);
  const win = Math.round(step * 0.3);
  let best = mid;
  for (let x = mid - win; x <= mid + win; x++) if (colCount[x] < colCount[best]) best = x;
  cuts.push(best);
  if (colCount[best] > 0) console.warn(`граница ${k}: позы касаются, режу по колонке с ${colCount[best]} px`);
}
cuts.push(last);
// 2. Связные фигуры (8-соседство) целиком уходят к ближайшей позе — так молоток,
// оторвавшийся от руки, не теряется, а кусок соседа не попадает в кадр.
// Режем по границам только фигуры, в которых слиплись несколько поз.
const poseOfX = (x) => {
  let i = 0;
  while (i < names.length - 1 && x >= cuts[i + 1]) i++;
  return i;
};
const owner = new Int8Array(W * H).fill(-1);
const seen = new Uint8Array(W * H);
for (let start = 0; start < W * H; start++) {
  if (seen[start] || data[start * 4 + 3] <= ALPHA) continue;
  const comp = [start];
  seen[start] = 1;
  for (let q = 0; q < comp.length; q++) {
    const p = comp[q];
    const x = p % W;
    const y = (p - x) / W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (!seen[n] && data[n * 4 + 3] > ALPHA) {
          seen[n] = 1;
          comp.push(n);
        }
      }
  }
  // Крошечные обрывки (кончик волос соседа, пылинка) выбрасываем.
  if (comp.length < (W * H) / 3000) continue;
  const votes = new Array(names.length).fill(0);
  for (const p of comp) votes[poseOfX(p % W)]++;
  const main = votes.indexOf(Math.max(...votes));
  const merged = votes.filter((v) => v > comp.length * 0.15).length > 1;
  for (const p of comp) owner[p] = merged ? poseOfX(p % W) : main;
}

// Второй проход: после разреза слипшихся поз у кадра могут остаться отрезанные хвосты
// соседа. Внутри каждой позы оставляем только куски не меньше 3% от самого крупного.
{
  const mark = new Uint8Array(W * H);
  const parts = names.map(() => []);
  for (let s0 = 0; s0 < W * H; s0++) {
    const o = owner[s0];
    if (o < 0 || mark[s0]) continue;
    const comp = [s0];
    mark[s0] = 1;
    for (let q = 0; q < comp.length; q++) {
      const p = comp[q];
      const x = p % W;
      const y = (p - x) / W;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (!mark[n] && owner[n] === o) {
            mark[n] = 1;
            comp.push(n);
          }
        }
    }
    parts[o].push(comp);
  }
  for (const list of parts) {
    const biggest = Math.max(0, ...list.map((c) => c.length));
    for (const c of list) if (c.length < biggest * 0.03) for (const p of c) owner[p] = -1;
  }
}

// 3. Рамка каждой позы и центр тела (медиана x в средней полосе).
const frames = names.map((_, i) => {
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let p = 0; p < W * H; p++) {
    if (owner[p] !== i) continue;
    const x = p % W;
    const y = (p - x) / W;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
  }
  const xs = [];
  const bandTop = Math.floor(y0 + (y1 - y0) * 0.45);
  const bandBot = y0 + (y1 - y0) * 0.8;
  for (let y = bandTop; y < bandBot; y++) for (let x = x0; x < x1; x++) if (owner[y * W + x] === i) xs.push(x);
  xs.sort((a, b) => a - b);
  return { x0, x1, y0, y1, cx: xs[Math.floor(xs.length / 2)] ?? (x0 + x1) / 2 };
});

if (EACH) {
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const w = f.x1 - f.x0;
    const h = f.y1 - f.y0;
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y + f.y0) * W + (x + f.x0);
        if (owner[p] === i) data.copy(buf, (y * w + x) * 4, p * 4, p * 4 + 4);
      }
    const file = path.join(OUT, `${names[i]}.png`);
    await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
      .resize(OUT_H, OUT_H, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toFile(file);
    console.log(file);
  }
  process.exit(0);
}

// 4. Общий холст: одинаковый масштаб, общий низ, центр тела посередине.
const top = Math.min(...frames.map((f) => f.y0));
const bottom = Math.max(...frames.map((f) => f.y1));
const half = Math.max(...frames.map((f) => Math.max(f.cx - f.x0, f.x1 - f.cx)));
const scale = IDLE_H ? IDLE_H / (frames[0].y1 - frames[0].y0) : OUT_H / (bottom - top);
const outW = Math.ceil(half * 2 * scale);
const outH = Math.ceil((bottom - top) * scale);
// Ноги в позе покоя — точка опоры. Ниже неё может торчать молоток при ударе,
// поэтому низ холста ≠ пол: доля высоты, где стоят ноги, уходит в anchors.json.
const anchorY = (frames[0].y1 - top) / (bottom - top);
const ANCHORS = path.join(OUT, 'anchors.json');
const anchors = fs.existsSync(ANCHORS) ? JSON.parse(fs.readFileSync(ANCHORS, 'utf8')) : {};

for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const w = f.x1 - f.x0;
  const h = bottom - top;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y + top) * W + (x + f.x0);
      if (owner[p] !== i) continue;
      data.copy(buf, (y * w + x) * 4, p * 4, p * 4 + 4);
    }
  const crop = await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .resize(Math.round(w * scale), outH)
    .png()
    .toBuffer();
  const left = Math.round((half - (f.cx - f.x0)) * scale);
  const file = path.join(OUT, `${key}_${names[i]}.png`);
  await sharp({ create: { width: outW, height: outH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: crop, left: Math.max(0, left), top: 0 }])
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(file);
  console.log(`${file}  ${outW}×${outH}`);
  anchors[`${key}_${names[i]}`] = Math.round(anchorY * 1000) / 1000;
}
fs.writeFileSync(ANCHORS, JSON.stringify(anchors, Object.keys(anchors).sort(), 1) + '\n');
