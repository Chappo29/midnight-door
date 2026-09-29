import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
const Z = 'C:/Users/bitse/Desktop/projects/ghost on door/yandex/midnight-door.zip';
const DIR = process.argv[2];
const walk = (d,b='') => fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{const r=b?b+'/'+e.name:e.name;return e.isDirectory()?walk(path.join(d,e.name),r):[r]});
const files = walk(DIR);
console.log('files', files.length, 'index.html at root:', files.includes('index.html'));
console.log('bad names:', files.filter(f=>/[^\x21-\x7e\/]/.test(f)||/\s/.test(f)));
console.log('maps/dev files:', files.filter(f=>/\.(map|ts|md|psd|wav|txt|json)$|sounds\.html|\.env/i.test(f)));
let total=0; for(const f of files) total+=fs.statSync(path.join(DIR,f)).size; console.log('unpacked bytes', total, (total/1048576).toFixed(2)+' MB', 'zip', fs.statSync(Z).size);
const texts = files.filter(f=>/\.(html|js|css)$/.test(f)).map(f=>[f,fs.readFileSync(path.join(DIR,f),'utf8')]);
const urls = new Set();
for (const [f,t] of texts) for (const m of t.matchAll(/https?:\/\/[A-Za-z0-9._~:\/?#@!$&*+,;=%-]+/g)) urls.add(f+' -> '+m[0]);
console.log('absolute URLs in text files:'); [...urls].forEach(u=>console.log('  ',u));
// missing assets: relative refs "./assets/x" or bare names
const missing = new Set();
for (const [f,t] of texts) for (const m of t.matchAll(/(?:\.\/|\/)?assets\/[A-Za-z0-9_.\-]+\.[a-z0-9]+/g)) { const p=m[0].replace(/^(\.\/|\/)/,''); if(!files.includes(p)) missing.add(f+' -> '+m[0]); }
console.log('missing referenced assets:', [...missing]);
// zip headers
const b = fs.readFileSync(Z); let dates=new Set(); let off=0; 
const eocd = b.lastIndexOf(Buffer.from([0x50,0x4b,5,6])); const n=b.readUInt16LE(eocd+10); let p=b.readUInt32LE(eocd+16);
for(let i=0;i<n;i++){ dates.add(b.readUInt16LE(p+12)+'/'+b.readUInt16LE(p+14)); p+=46+b.readUInt16LE(p+28)+b.readUInt16LE(p+30)+b.readUInt16LE(p+32);}
console.log('zip entries', n, 'DOS time/date pairs', [...dates]);
