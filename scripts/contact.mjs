/**
 * Контрольный лист кадров на светлом фоне — проверить нарезку глазами.
 *   node scripts/contact.mjs <префикс> <out.png>
 *   node scripts/contact.mjs char0_side_ check.png   — все src/assets/sprites/char0_side_*.png
 */
import fs from 'fs';
import sharp from 'sharp';

const [prefix, out] = process.argv.slice(2);
const DIR = 'src/assets/sprites';
const files = fs
  .readdirSync(DIR)
  .filter((f) => f.startsWith(prefix) && f.endsWith('.png'))
  .sort();
const metas = await Promise.all(files.map((f) => sharp(`${DIR}/${f}`).metadata()));
const W = Math.max(...metas.map((m) => m.width));
const H = Math.max(...metas.map((m) => m.height));
await sharp({ create: { width: (W + 10) * files.length + 12, height: H + 12, channels: 4, background: '#cfe3ee' } })
  .composite(files.map((f, i) => ({ input: `${DIR}/${f}`, left: i * (W + 10) + 6, top: 6 + H - metas[i].height })))
  .png()
  .toFile(out);
console.log(files.join(' '));
