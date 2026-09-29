/**
 * Архив для Яндекс Игр (YANDEX_READINESS.md): npm run build:yandex
 * Берёт готовую сборку dist/ (npm run build) и кладёт в yandex/midnight-door.zip только то, что нужно игре:
 *  - без sounds.html — страница прослушивания для GitHub Pages, со ссылкой на внешний сайт;
 *  - без файлов, на которые не ссылается ни index.html, ни код, ни стили (варианты звуков-кандидатов и т. п.).
 * Проверяет требования к архиву: index.html в корне, в именах нет пробелов и кириллицы, распакованный размер ≤ 100 МБ.
 * ZIP пишется своим кодом (deflate из zlib) — без зависимостей.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const DIST = 'dist';
const OUT_DIR = 'yandex';
const OUT = path.join(OUT_DIR, 'midnight-door.zip');
const LIMIT = 100 * 1024 * 1024;
/** Не нужны в архиве Яндекса (есть на GitHub Pages). */
const EXCLUDE = new Set(['sounds.html']);

/** Все файлы dist относительными путями через «/». */
function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
  });
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('Нет dist/index.html — сначала npm run build');
  process.exit(1);
}

const files = walk(DIST).filter((f) => !EXCLUDE.has(f));
// Что реально нужно: index.html и всё, на что ссылаются html/js/css (имена файлов с хешем Vite уникальны).
const texts = files.filter((f) => /\.(html|js|css)$/.test(f)).map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n');
const keep = files.filter((f) => f === 'index.html' || /\.(js|css)$/.test(f) || texts.includes(path.posix.basename(f)));
const dropped = files.filter((f) => !keep.includes(f));

const bad = keep.filter((f) => /[\sЀ-ӿ]/.test(f));
if (bad.length) {
  console.error(`В именах файлов пробелы или кириллица (Яндекс не примет): ${bad.join(', ')}`);
  process.exit(1);
}

// --- ZIP (PKZIP, deflate) ---
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Дата записей — 1980-01-01 00:00 (DOS): нулевая дата 1980-00-00 некорректна и путает часть распаковщиков (RA-04). */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const parts = [];
const central = [];
let offset = 0;
let unpacked = 0;
for (const f of keep) {
  const data = fs.readFileSync(path.join(DIST, f));
  unpacked += data.length;
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(f, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // имена в UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  parts.push(local, name, packed);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0x0800, 8);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt16LE(DOS_TIME, 12);
  cd.writeUInt16LE(DOS_DATE, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(packed.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(offset, 42);
  central.push(cd, name);
  offset += local.length + name.length + packed.length;
}
const cdBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(keep.length, 8);
end.writeUInt16LE(keep.length, 10);
end.writeUInt32LE(cdBuf.length, 12);
end.writeUInt32LE(offset, 16);

if (unpacked > LIMIT) {
  console.error(`Распакованный размер ${(unpacked / 1048576).toFixed(1)} МБ больше 100 МБ`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([...parts, cdBuf, end]));
const mb = (x) => (x / 1048576).toFixed(1);
console.log(`${OUT}: ${keep.length} файлов, распаковано ${mb(unpacked)} МБ, архив ${mb(fs.statSync(OUT).size)} МБ`);
console.log(`Не вошло (${dropped.length + EXCLUDE.size}): ${[...EXCLUDE].join(', ')}${dropped.length ? `, ${dropped.length} файлов без ссылок` : ''}`);
