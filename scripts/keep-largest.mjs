// Оставляет в PNG только самую большую связную непрозрачную область (убирает обрезки соседей).
import sharp from 'sharp';
for (const f of process.argv.slice(2)) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const lab = new Int32Array(w * h).fill(-1);
  const sizes = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] >= 0 || data[i * 4 + 3] < 20) continue;
    const id = sizes.length; let n = 0; const st = [i]; lab[i] = id;
    while (st.length) { const p = st.pop(); n++; const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (lab[q] < 0 && data[q * 4 + 3] >= 20) { lab[q] = id; st.push(q); } } }
    sizes.push(n);
  }
  const best = sizes.indexOf(Math.max(...sizes));
  let removed = 0;
  for (let i = 0; i < w * h; i++) if (lab[i] !== best && data[i * 4 + 3] > 0) { data[i * 4 + 3] = 0; removed++; }
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toFile(f + '.tmp');
  console.log(f, 'компонент', sizes.length, 'убрано px', removed);
}
