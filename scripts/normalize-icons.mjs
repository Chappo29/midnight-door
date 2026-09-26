/**
 * Иконки кнопок-наклеек → src/assets/ui/*.png одного «визуального веса».
 *   node scripts/normalize-icons.mjs
 * Вписывать каждую картинку в квадрат по краям нельзя: высокие полоски паузы выходят крупнее
 * широкого динамика. Поэтому в группе все иконки масштабируются к одной закрашенной площади
 * (корень из числа непрозрачных пикселей), насколько позволяет холст.
 * Источник — обрезанные без масштаба ячейки: node scripts/slice-grid.mjs <лист> docs/art/source/icons/raw ... --raw
 */
import sharp from 'sharp';

const RAW = 'docs/art/source/icons/raw';
const OUT = 'src/assets/ui';
const SIZE = 192;
/** Поле по краям: белая обводка-наклейка и тень рисуются CSS-фильтром и не должны обрезаться. */
const MAX = SIZE - 12;

/**
 * Группы кнопок, которые стоят рядом и должны выглядеть одного размера.
 * `with` — масштаб как у другой иконки (пара вкл/выкл: динамик не «прыгает» при переключении).
 */
const GROUPS = [
  [{ src: 'home_bed', out: 'home' }, { src: 'repair_combo', out: 'repair' }],
  [{ src: 'pause_gold', out: 'pause' }, { src: 'sound_speaker_on', out: 'sound_on' }, { src: 'sound_speaker_off', out: 'sound_off', with: 'sound_speaker_on' }],
  [{ src: 'skip_ff', out: 'skip' }],
];

async function measure(name) {
  const { data, info } = await sharp(`${RAW}/${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let area = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 24) area++;
  return { w: info.width, h: info.height, root: Math.sqrt(area) };
}

for (const group of GROUPS) {
  const m = Object.fromEntries(await Promise.all(group.map(async (it) => [it.src, await measure(it.src)])));
  // Общая «площадь» группы — наибольшая, при которой каждая иконка (и её пара) ещё влезает в MAX.
  let target = Infinity;
  for (const it of group) {
    const base = m[it.with ?? it.src];
    const own = m[it.src];
    target = Math.min(target, (MAX / Math.max(own.w, own.h)) * base.root);
  }
  for (const it of group) {
    const scale = target / m[it.with ?? it.src].root;
    const { w, h } = m[it.src];
    const nw = Math.round(w * scale), nh = Math.round(h * scale);
    const img = await sharp(`${RAW}/${it.src}.png`).resize(nw, nh).png().toBuffer();
    await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: img, left: Math.round((SIZE - nw) / 2), top: Math.round((SIZE - nh) / 2) }])
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toFile(`${OUT}/${it.out}.png`);
    console.log(`${it.out}: ${nw}×${nh}`);
  }
}
