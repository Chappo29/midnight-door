/**
 * Импорт сгенерированного арта в игру: обрезает прозрачные края, уменьшает
 * и кладёт в src/assets/sprites/<ключ>.png.
 *   npm run art                    — все файлы из docs/art/source/*.png
 *   npm run art -- char0 ghost     — только указанные ключи
 * Исходник называется так же, как ключ спрайта (char0.png, ghost.png, …).
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const SRC = 'docs/art/source';
const OUT = 'src/assets/sprites';
/** Во сколько раз исходник крупнее показа в игре: запас под ретину и зум. */
const MAX_SIDE = 256;

const only = process.argv.slice(2);
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.png') && (!only.length || only.includes(f.replace(/\.png$/, ''))));
fs.mkdirSync(OUT, { recursive: true });

for (const f of files) {
  const out = path.join(OUT, f);
  const trimmed = await sharp(path.join(SRC, f)).trim({ threshold: 1 }).toBuffer();
  await sharp(trimmed)
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`${f.padEnd(20)} ${meta.width}×${meta.height}  ${(fs.statSync(out).size / 1024).toFixed(0)} КБ`);
}
