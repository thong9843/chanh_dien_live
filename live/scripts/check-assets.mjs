// Kiểm tra tài nguyên trong /assets: tên file, PNG có alpha (và 4 góc nhân vật trong suốt thật),
// chiều cao nhân vật, hall.jpg 1080x1920. Không dùng thư viện ngoài. Chạy: npm run check-assets
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const CHARS = { c_man: 260, c_woman: 260, c_granny: 260, c_monk: 260, c_nun: 260, c_child: 229 };   // chiều cao bắt buộc
const POSE_SKINS = ['man', 'woman', 'granny', 'monk', 'nun', 'child'];
const POSES = ['stand', 'walkL', 'walkR'], POSES_OPT = ['kneel', 'prostrate'];   // pose_<skin>_<pose>.png: đủ stand/walkL/walkR mới có đi bộ; kneel+prostrate tuỳ chọn
const isPoseFile = n => new RegExp(`^pose_(${POSE_SKINS.join('|')})_(${[...POSES, ...POSES_OPT].join('|')})\.png$`).test(n);
const SCENES = ['hall.jpg', 'hall_mountain_day.jpg', 'hall_mountain_dawn.jpg', 'hall_mountain_night.jpg', 'hall_ram.jpg', 'hall_phatdan.jpg', 'hall_vulan.jpg'];   // ảnh nền các cảnh (hall.jpg = Chánh điện cũ), đều 1080x1920
const FX = ['fx_banner', 'fx_bell', 'fx_halo', 'fx_incense', 'fx_lotus', 'fx_mo', 'fx_petal', 'fx_scroll'];
const WIDTH_OK = [100, 400];                                                                            // rộng linh hoạt, chỉ cảnh báo ngoài khoảng
let errors = 0, warns = 0;
const ok = m => console.log('  ✓ ' + m), warn = m => { warns++; console.log('  ⚠ ' + m); }, bad = m => { errors++; console.log('  ✗ ' + m); };

/* ---------- PNG ---------- */
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function parsePng(buf){
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error('không phải PNG');
  let pos = 8, ihdr = null, trns = null; const idat = [];
  while (pos + 8 <= buf.length){
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], ctype: data[9], interlace: data[12] };
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('thiếu IHDR');
  return { ...ihdr, trns, idat: Buffer.concat(idat) };
}
const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };                      // số kênh theo color type
const hasAlpha = p => p.ctype === 4 || p.ctype === 6 || !!p.trns;
const paeth = (a, b, c) => { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

// Giải nén + bỏ filter từng dòng (None/Sub/Up/Average/Paeth); trả về các dòng pixel thô
function unfilter(p){
  const bpp = Math.max(1, (CH[p.ctype] * p.depth) >> 3), stride = Math.ceil(p.w * CH[p.ctype] * p.depth / 8);
  const raw = zlib.inflateSync(p.idat);
  if (raw.length < (stride + 1) * p.h) throw new Error('dữ liệu IDAT thiếu');
  const out = Buffer.alloc(stride * p.h);
  for (let y = 0; y < p.h; y++){
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    if (f > 4) throw new Error('filter lạ ' + f);
    for (let x = 0; x < stride; x++){
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = (x >= bpp && y) ? out[dst - stride + x - bpp] : 0, v = raw[src + x];
      out[dst + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  return { out, stride };
}

// alpha (0-255) của pixel (x,y); null nếu không xác định được
function alphaAt(p, u, x, y){
  const o = y * u.stride, d = p.depth;
  if (p.ctype === 6) return d === 8 ? u.out[o + x * 4 + 3] : u.out[o + x * 8 + 6];
  if (p.ctype === 4) return d === 8 ? u.out[o + x * 2 + 1] : u.out[o + x * 4 + 2];
  if (p.ctype === 3 && p.trns){
    const bits = x * d, idx = (u.out[o + (bits >> 3)] >> (8 - d - (bits & 7))) & ((1 << d) - 1);
    return idx < p.trns.length ? p.trns[idx] : 255;
  }
  if (p.trns && d === 8 && (p.ctype === 0 || p.ctype === 2)){        // tRNS màu khoá (8 bit)
    const n = CH[p.ctype], px = [...u.out.subarray(o + x * n, o + x * n + n)];
    const key = p.ctype === 0 ? [p.trns.readUInt16BE(0) & 255] : [p.trns.readUInt16BE(0) & 255, p.trns.readUInt16BE(2) & 255, p.trns.readUInt16BE(4) & 255];
    return px.every((v, i) => v === key[i]) ? 0 : 255;
  }
  return null;
}

/* ---------- JPEG: đọc SOF để lấy kích thước ---------- */
function jpegSize(buf){
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('không phải JPEG');
  for (let p = 2; p + 9 < buf.length;){
    if (buf[p] !== 0xff){ p++; continue; }
    const m = buf[p + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
    p += 2 + buf.readUInt16BE(p + 2);
  }
  throw new Error('không tìm thấy SOF');
}

/* ---------- kiểm tra ---------- */
console.log('Kiểm tra ' + DIR);
if (!fs.existsSync(DIR)){ bad('không có thư mục assets'); process.exit(1); }
const files = new Set(fs.readdirSync(DIR));

console.log('Tên file');
const need = [...SCENES, ...Object.keys(CHARS).map(n => n + '.png'), ...FX.map(n => n + '.png')];
for (const n of need) files.has(n) ? ok(n) : bad('thiếu ' + n);
const EXTRAS = ['candle_body', 'candle_flame', 'wish_card', 'cushion'];   // dành cho Đợt 3 / v4.2 (nến + thẻ nguyện ước + gối): chỉ cho phép có mặt và kiểm tra alpha
const known = new Set([...need, ...EXTRAS.map(n => n + '.png'), 'music', 'fonts', 'README.md', '_unused']);
for (const n of files) if (!known.has(n) && !isPoseFile(n)) warn(n.startsWith('anim_') ? `${n}: sprite cũ, nên xoá (code tự hiện tư thế ngồi)` : `file lạ: ${n}`);

console.log('Phông chữ tự lưu (assets/fonts)');
{
  const FD = path.join(DIR, 'fonts');
  if (!fs.existsSync(path.join(FD, 'fonts.css'))) bad('thiếu fonts/fonts.css');
  else {
    const css = fs.readFileSync(path.join(FD, 'fonts.css'), 'utf8');
    const urls = [...new Set([...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map(m => m[1]))];
    let missing = 0; for (const u of urls) if (!fs.existsSync(path.join(FD, u))) { bad('fonts.css trỏ tới file không có: ' + u); missing++; }
    if (!missing) ok(urls.length + ' file woff2 có đủ');
    if (/https?:\/\//i.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))) bad('fonts.css không được gọi tài nguyên ngoài');
  }
  for (const f of ['OFL-NotoSerif.txt', 'OFL-BeVietnamPro.txt']) fs.existsSync(path.join(FD, f)) ? ok(f) : bad('thiếu giấy phép ' + f);
}

console.log('PNG nhân vật (cao đúng, rộng hợp lý, có alpha, 4 góc trong suốt)');
for (const [name, H] of Object.entries(CHARS)){
  const f = name + '.png'; if (!files.has(f)) continue;
  try {
    const p = parsePng(fs.readFileSync(path.join(DIR, f)));
    p.h === H ? ok(`${f}: cao ${p.h}`) : bad(`${f}: cao ${p.h}, cần ${H}`);
    p.w >= WIDTH_OK[0] && p.w <= WIDTH_OK[1] ? ok(`${f}: rộng ${p.w}`) : warn(`${f}: rộng ${p.w}, ngoài khoảng ${WIDTH_OK.join('–')}`);
    if (!hasAlpha(p)){ bad(`${f}: không có kênh alpha`); continue; }
    if (p.interlace){ warn(`${f}: PNG interlace, bỏ qua kiểm tra góc`); continue; }
    const u = unfilter(p);
    const corners = [[0, 0], [p.w - 1, 0], [0, p.h - 1], [p.w - 1, p.h - 1]].map(([x, y]) => alphaAt(p, u, x, y));
    const opaque = corners.filter(a => a === null || a > 250).length;
    if (opaque === 4) bad(`${f}: cả 4 góc đều đục (alpha ${corners.join('/')}), nền chưa được tách`);
    else if (opaque) warn(`${f}: ${opaque}/4 góc đục (alpha ${corners.join('/')})`);
    else ok(`${f}: 4 góc trong suốt`);
  } catch (e) { bad(`${f}: ${e.message}`); }
}

console.log('PNG tư thế đứng / đi bộ (tuỳ chọn: thiếu chỉ cảnh báo, skin đó dùng cách lên lễ cũ)');
let anyPose = false;
for (const sk of POSE_SKINS){
  const have = [...POSES, ...POSES_OPT].filter(k => files.has(`pose_${sk}_${k}.png`));
  if (!have.length) continue;
  anyPose = true;
  const missing = POSES.filter(k => !have.includes(k));
  missing.length ? warn(`pose_${sk}: thiếu ${missing.join(', ')} → ${sk} chưa đi bộ được`) : ok(`pose_${sk}: đủ stand/walkL/walkR`);
  if (have.some(k => POSES_OPT.includes(k)) && !POSES_OPT.every(k => have.includes(k))) warn(`pose_${sk}: có kneel hoặc prostrate nhưng thiếu cái còn lại → bỏ qua nhánh quỳ lạy`);
  for (const k of have){
    const f = `pose_${sk}_${k}.png`;
    try {
      const p = parsePng(fs.readFileSync(path.join(DIR, f)));
      if (!hasAlpha(p)){ bad(`${f}: không có kênh alpha`); continue; }
      if (p.interlace){ warn(`${f}: PNG interlace, bỏ qua kiểm tra góc`); continue; }
      const u = unfilter(p);
      const corners = [[0, 0], [p.w - 1, 0], [0, p.h - 1], [p.w - 1, p.h - 1]].map(([x, y]) => alphaAt(p, u, x, y));
      const opaque = corners.filter(a => a === null || a > 250).length;
      if (opaque === 4) bad(`${f}: cả 4 góc đều đục (alpha ${corners.join('/')}), nền chưa được tách`);
      else if (opaque) warn(`${f}: ${opaque}/4 góc đục (alpha ${corners.join('/')})`);
      else ok(`${f}: ${p.w}x${p.h}, 4 góc trong suốt`);
    } catch (e) { bad(`${f}: ${e.message}`); }
  }
}
if (!anyPose) warn('chưa có ảnh pose_<skin>_<stand|walkL|walkR>.png nào (lên lễ dùng cách mờ tại chỗ)');

console.log('PNG hiệu ứng (có alpha)');
for (const n of FX){
  const f = n + '.png'; if (!files.has(f)) continue;
  try { const p = parsePng(fs.readFileSync(path.join(DIR, f))); hasAlpha(p) ? ok(`${f}: ${p.w}x${p.h}`) : bad(`${f}: không có kênh alpha`); }
  catch (e) { bad(`${f}: ${e.message}`); }
}

console.log('PNG dành cho Đợt 3 (nến, thẻ nguyện ước; có alpha)');
for (const n of EXTRAS){
  const f = n + '.png'; if (!files.has(f)) continue;
  try { const p = parsePng(fs.readFileSync(path.join(DIR, f))); hasAlpha(p) ? ok(`${f}: ${p.w}x${p.h}`) : bad(`${f}: không có kênh alpha`); }
  catch (e) { bad(`${f}: ${e.message}`); }
}

console.log('Nền các cảnh (1080x1920)');
for (const n of SCENES){
  if (!files.has(n)) continue;
  try { const j = jpegSize(fs.readFileSync(path.join(DIR, n))); j.w === 1080 && j.h === 1920 ? ok(`${n} 1080x1920`) : bad(`${n} ${j.w}x${j.h}, cần 1080x1920`); }
  catch (e) { bad(`${n}: ${e.message}`); }
}

console.log('Nhạc');
const music = fs.existsSync(path.join(DIR, 'music')) ? fs.readdirSync(path.join(DIR, 'music')).filter(n => /\.mp3$/i.test(n)) : [];
music.length ? ok(`${music.length} file mp3`) : bad('không có mp3 trong assets/music');

console.log(`\n${errors ? '✗' : '✓'} ${errors} lỗi, ${warns} cảnh báo`);
process.exit(errors ? 1 : 0);
