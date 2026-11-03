import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import WebSocket from 'ws';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.resolve(SCRIPT_DIR, '..');
const REPO = path.resolve(LIVE, '..');
const SHOTS_DIR = path.join(REPO, 'shots', 'v41');

if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

if (!EDGE) throw new Error('Không tìm thấy msedge.exe');

const CDP_PORT = 9338;
const UDD = path.join(os.tmpdir(), 'shot_edge_' + Date.now());

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const getJSON = u => new Promise((res, rej) => {
  const rq = http.get(u, { timeout: 10000 }, r => {
    let b = ''; r.on('data', c => b += c);
    r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  });
  rq.on('error', rej);
});

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.p = new Map();
    this.ws.on('message', d => {
      let m; try { m = JSON.parse(d); } catch { return; }
      const h = m.id && this.p.get(m.id);
      if (h) { this.p.delete(m.id); clearTimeout(h.timer); h.resolve(m.result !== undefined ? m.result : m); }
    });
    this.ws.on('error', () => {});
    this.ready = new Promise((r, j) => { this.ws.on('open', r); this.ws.on('error', j); });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.p.delete(id); reject(new Error('CDP treo >15s: ' + method)); }, 15000);
      this.p.set(id, { resolve, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.p.delete(id); reject(e); }
    });
  }
  close() { try { this.ws.terminate(); } catch {} }
}

function readPngPixel(buf, x, y) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('Not a PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25]; // 6: RGBA, 2: RGB
  let pos = 8;
  const idats = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idats.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const decomp = zlib.inflateSync(Buffer.concat(idats));
  const bpp = colorType === 6 ? 4 : 3;
  const raw = Buffer.alloc(width * height * bpp);
  let srcPos = 0;
  for (let r = 0; r < height; r++) {
    const filter = decomp[srcPos++];
    const rowStart = r * width * bpp;
    const prevStart = (r - 1) * width * bpp;
    for (let c = 0; c < width * bpp; c++) {
      const v = decomp[srcPos++];
      const a = (c >= bpp) ? raw[rowStart + c - bpp] : 0;
      const b = (r > 0) ? raw[prevStart + c] : 0;
      const cCorner = (r > 0 && c >= bpp) ? raw[prevStart + c - bpp] : 0;
      let val = v;
      if (filter === 1) val = (v + a) & 0xff;
      else if (filter === 2) val = (v + b) & 0xff;
      else if (filter === 3) val = (v + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - cCorner;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cCorner);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : cCorner);
        val = (v + pr) & 0xff;
      }
      raw[rowStart + c] = val;
    }
  }
  const off = (y * width + x) * bpp;
  return [raw[off], raw[off + 1], raw[off + 2], bpp === 4 ? raw[off + 3] : 255];
}

let srv = null, edge = null, cdp = null, ctlWs = null;

async function cleanup() {
  log('Dọn dẹp tiến trình...');
  try { if (cdp) cdp.close(); } catch {}
  try { if (ctlWs) ctlWs.terminate(); } catch {}
  for (const [p, n] of [[edge, 'Edge'], [srv, 'server']]) {
    if (!p || p.exitCode !== null) continue;
    try { p.kill(); } catch {}
    await sleep(400);
    if (p.exitCode === null && process.platform === 'win32') {
      try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
  }
  try { fs.rmSync(UDD, { recursive: true, force: true }); } catch {}
}

const sendCtl = msg => new Promise(res => {
  if (ctlWs && ctlWs.readyState === WebSocket.OPEN) {
    ctlWs.send(JSON.stringify(msg), () => res());
  } else res();
});

async function evalInPage(expr) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r?.result?.value !== undefined ? r.result.value : r?.value;
}

async function captureShot(name, setupFn) {
  log(`=== Chuẩn bị chụp ${name}.png ===`);
  await setupFn();

  // Chờ nền decode và canvas sẵn sàng
  log('Chờ background decode & fit...');
  await evalInPage(`
    (async () => {
      const sc = resolveScene();
      const im = sceneImg(sc);
      if (im) {
        if (im.decode) try { await im.decode(); } catch {}
        while (!im.naturalWidth) await new Promise(r => setTimeout(r, 50));
      }
      if (typeof fit === 'function') fit();
      if (typeof renderStatic === 'function') renderStatic();
      if (document.getElementById('unmute')) document.getElementById('unmute').remove();
    })()
  `);

  // Đợi thêm 2 s sau khi ổn định số người / cảnh
  log('Đợi thêm 2s để cảnh hoàn toàn ổn định...');
  await sleep(2000);

  // Chụp ảnh qua CDP
  const shotResp = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const data = shotResp.data || shotResp.result?.data;
  if (!data) throw new Error('Không lấy được dữ liệu screenshot từ CDP');
  const buf = Buffer.from(data, 'base64');
  const filePath = path.join(SHOTS_DIR, name + '.png');
  fs.writeFileSync(filePath, buf);
  log(`Đã lưu ${filePath} (${(buf.length / 1024).toFixed(1)} KB)`);

  // Tự kiểm pixel (540, 700) và (540, 1200)
  const p700 = readPngPixel(buf, 540, 700);
  const p1200 = readPngPixel(buf, 540, 1200);
  log(`Pixel tự kiểm ${name}: (540,700)=RGB(${p700[0]},${p700[1]},${p700[2]}), (540,1200)=RGB(${p1200[0]},${p1200[1]},${p1200[2]})`);

  const fail700 = (p700[0] < 30 && p700[1] < 30 && p700[2] < 30);
  const fail1200 = (p1200[0] < 30 && p1200[1] < 30 && p1200[2] < 30);
  if (fail700 || fail1200) {
    throw new Error(`LỖI: Ảnh ${name}.png có pixel tối R,G,B < 30! (540,700): ${p700.slice(0,3)}, (540,1200): ${p1200.slice(0,3)}`);
  }
  return { name, p700: p700.slice(0,3), p1200: p1200.slice(0,3) };
}

async function main() {
  srv = spawn('node', ['server.mjs'], { cwd: LIVE, stdio: 'inherit' });
  await sleep(2500);

  edge = spawn(EDGE, [
    '--app=http://127.0.0.1:3000/live/overlay.html?shot=1',
    '--window-size=1080,1920',
    '--user-data-dir=' + UDD,
    '--remote-debugging-port=' + CDP_PORT,
    '--remote-allow-origins=*',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
  ], { stdio: 'ignore' });

  // Tìm tab overlay
  let pageWs = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const list = await getJSON(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const target = list.find(t => t.url && t.url.includes('overlay.html'));
      if (target && target.webSocketDebuggerUrl) {
        pageWs = target.webSocketDebuggerUrl;
        break;
      }
    } catch {}
  }

  if (!pageWs) throw new Error('Không tìm thấy tab overlay trên Edge');

  cdp = new Cdp(pageWs);
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1080,
    height: 1920,
    deviceScaleFactor: 1,
    mobile: false
  });
  await evalInPage('fit()');

  // Mở kết nối control WebSocket
  ctlWs = new WebSocket('ws://127.0.0.1:3000/ws?role=control');
  await new Promise((res, rej) => {
    ctlWs.on('open', res);
    ctlWs.on('error', rej);
  });
  log('Đã kết nối control WebSocket');

  const DEMO_NAMES = [
    'An Lạc', 'Tâm Thiện', 'Diệu Âm', 'Minh Trí', 'Phúc Nguyên',
    'Tuệ Tĩnh', 'Bảo Quang', 'Liên Hoa', 'Quảng Độ', 'Tịnh Tâm',
    'Chân Như', 'Phổ Hiền', 'Đại Trí', 'Thiện Căn', 'Từ Bi'
  ];

  async function pumpViewers(n) {
    await sendCtl({ t: 'control', action: 'clear' });
    await sleep(300);
    for (let i = 0; i < n; i++) {
      const name = DEMO_NAMES[i % DEMO_NAMES.length] + ' ' + (i + 1);
      await sendCtl({ t: 'control', action: 'chat', name, text: 'Nam mô A Di Đà Phật' });
      await sleep(30);
    }
    // Chờ số người đạt đủ trên overlay
    const targetVis = Math.min(n, 50);
    for (let wait = 0; wait < 80; wait++) {
      const cur = await evalInPage('visitors.size');
      const moreText = await evalInPage("document.getElementById('chipMore')?.textContent || ''");
      if (cur >= targetVis && (n <= 50 || moreText.includes('+' + (n - 50)))) break;
      await sleep(200);
    }
  }

  const results = [];

  // 1. scene_day (idle, 0 bots)
  results.push(await captureShot('scene_day', async () => {
    await sendCtl({ t: 'control', action: 'clear' });
    await sendCtl({ t: 'control', action: 'settings', settings: { scene: 'day', safeZone: false } });
    await sleep(600);
  }));

  // 2. scene_night (idle, 0 bots)
  results.push(await captureShot('scene_night', async () => {
    await sendCtl({ t: 'control', action: 'settings', settings: { scene: 'night', safeZone: false } });
    await sleep(600);
  }));

  // 3. scene_ram (idle, 0 bots)
  results.push(await captureShot('scene_ram', async () => {
    await sendCtl({ t: 'control', action: 'settings', settings: { scene: 'ram', safeZone: false } });
    await sleep(600);
  }));

  // 4. viewers_09 (phải thấy 6 phải + 3 trái, tất cả ở hàng 1 sát lối đi)
  results.push(await captureShot('viewers_09', async () => {
    await sendCtl({ t: 'control', action: 'settings', settings: { scene: 'day', safeZone: false } });
    await pumpViewers(9);
  }));

  // 5. viewers_12
  results.push(await captureShot('viewers_12', async () => {
    await pumpViewers(12);
  }));

  // 6. viewers_30
  results.push(await captureShot('viewers_30', async () => {
    await pumpViewers(30);
  }));

  // 7. viewers_50
  results.push(await captureShot('viewers_50', async () => {
    await pumpViewers(50);
  }));

  // 8. viewers_80 (phải thấy "+30 người đang thiền")
  results.push(await captureShot('viewers_80', async () => {
    await pumpViewers(80);
  }));

  // 9. ceremony_8_cushions (8 người trên 8 gối + 50 người ngồi + 2 trụ trì)
  results.push(await captureShot('ceremony_8_cushions', async () => {
    await pumpViewers(50);
    // Bố trí 8 người lên 8 bồ đoàn lễ (kneel + prostrate)
    await evalInPage(`
      (() => {
        const spots = window.LayoutV3.buildSpots(V3);
        const skins = ['man', 'woman', 'man', 'woman', 'man', 'woman', 'man', 'woman'];
        spots.forEach((s, idx) => {
          const id = 'ceremony_cushion_' + idx;
          const name = 'Lễ ' + (idx + 1);
          let cv = visitors.get(id);
          if (!cv) {
            cv = new Character({ id, name, skin: skins[idx] }, s.x, s.y);
            visitors.set(id, cv);
          }
          cv.x = s.x;
          cv.y = s.y;
          cv.targetX = s.x;
          cv.targetY = s.y;
          cv.scale = s.scale;
          cv.atAltarSpot = true;
          cv.inCeremony = true;
          cv.walkControlled = false;
          cv.state = 'sit';
          cv.fade = 1;
          cv.poseMix = 1;
          cv.kneelMix = 1;
          // Hàng trước (idx 4..7) lạy sát đất (prostrate), hàng sau (idx 0..3) quỳ (kneel)
          cv.prostrateMix = (idx >= 4) ? 1 : 0;
          cv.walkImgKey = 'stand';
        });
      })()
    `);
  }));

  // 10. safe_zone_overlay
  results.push(await captureShot('safe_zone_overlay', async () => {
    await sendCtl({ t: 'control', action: 'settings', settings: { safeZone: true } });
    await evalInPage("document.getElementById('safe').style.display = 'block'");
    await sleep(500);
  }));

  log('=== TẤT CẢ 10 ẢNH ĐÃ CHỤP VÀ TỰ KIỂM THÀNH CÔNG ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('LỖI CHỤP ẢNH:', err);
  process.exit(1);
}).finally(() => {
  cleanup();
});
