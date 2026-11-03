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
const SHOTS_DIR = path.join(REPO, 'shots', 'v42');

if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

if (!EDGE) throw new Error('Không tìm thấy msedge.exe');

const CDP_PORT = 9338;
const UDD = path.join(os.tmpdir(), 'shot_edge_v42_' + Date.now());

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
      const timer = setTimeout(() => { this.p.delete(id); reject(new Error('CDP treo >20s: ' + method)); }, 20000);
      this.p.set(id, { resolve, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.p.delete(id); reject(e); }
    });
  }
  close() { try { this.ws.terminate(); } catch {} }
}

function parsePng(buf) {
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
  return { width, height, bpp, raw };
}

function getPixel(parsed, x, y) {
  const off = (y * parsed.width + x) * parsed.bpp;
  return [parsed.raw[off], parsed.raw[off + 1], parsed.raw[off + 2]];
}

function getAverageBrightness(parsed, sampleStep = 20) {
  let sum = 0, count = 0;
  for (let y = 0; y < parsed.height; y += sampleStep) {
    for (let x = 0; x < parsed.width; x += sampleStep) {
      const rgb = getPixel(parsed, x, y);
      sum += (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114);
      count++;
    }
  }
  return count > 0 ? (sum / count) : 0;
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
  if (setupFn) await setupFn();

  // Chờ nền decode và canvas sẵn sàng
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
      if (typeof finishPrep === 'function') finishPrep();
    })()
  `);

  await sleep(1500);

  const shotResp = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const data = shotResp.data || shotResp.result?.data;
  if (!data) throw new Error('Không lấy được dữ liệu screenshot từ CDP');
  const buf = Buffer.from(data, 'base64');
  const filePath = path.join(SHOTS_DIR, name + '.png');
  fs.writeFileSync(filePath, buf);
  log(`Đã lưu ${filePath} (${(buf.length / 1024).toFixed(1)} KB)`);

  const parsed = parsePng(buf);
  const p700 = getPixel(parsed, 540, 700);
  const p1200 = getPixel(parsed, 540, 1200);
  const avgBright = getAverageBrightness(parsed, 40);
  log(`Tự kiểm ${name}: (540,700)=RGB(${p700.join(',')}), (540,1200)=RGB(${p1200.join(',')}), độ sáng TB=${avgBright.toFixed(1)}`);
  return { name, p700, p1200, avgBright, bytes: buf.length };
}

const DEMO_NAMES = [
  'An Lạc', 'Tâm Thiện', 'Diệu Âm', 'Minh Trí', 'Phúc Nguyên',
  'Tuệ Tĩnh', 'Bảo Quang', 'Liên Hoa', 'Quảng Độ', 'Tịnh Tâm',
  'Chân Như', 'Phổ Hiền', 'Đại Trí', 'Thiện Căn', 'Từ Bi',
  'Huệ Đăng', 'Thanh Tịnh', 'Bổn Nguyện', 'Giác Ngộ', 'Vạn Hạnh'
];

async function main() {
  log('Bắt đầu quy trình kiểm thử và ghi log 3 phút...');
  const testStartTime = Date.now();

  srv = spawn('node', ['server.mjs'], { cwd: LIVE, stdio: 'inherit' });
  await sleep(2500);

  edge = spawn(EDGE, [
    '--app=http://127.0.0.1:3000/live/overlay.html?shot=1&ceremony=code',
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

  // Mở kết nối control WebSocket
  ctlWs = new WebSocket('ws://127.0.0.1:3000/ws?role=control');
  await new Promise((res, rej) => {
    ctlWs.on('open', res);
    ctlWs.on('error', rej);
  });
  log('Đã kết nối control WebSocket');

  // Đảm bảo prep screen được ẩn nếu sau 3s chưa ẩn
  await sleep(3000);
  await evalInPage(`
    if (typeof finishPrep === 'function') finishPrep();
    if (typeof fit === 'function') fit();
  `);

  const results = [];

  // ==================== 1. idle.png ====================
  results.push(await captureShot('idle', async () => {
    await sendCtl({ t: 'ctl', cmd: 'clear' });
    await sendCtl({ t: 'ctl', cmd: 'settings', settings: { scene: 'day', safeZone: false } });
    await sleep(1000);
  }));

  // ==================== 2. seated_20.png ====================
  results.push(await captureShot('seated_20', async () => {
    await sendCtl({ t: 'ctl', cmd: 'clear' });
    await sleep(500);
    for (let i = 0; i < 20; i++) {
      const name = DEMO_NAMES[i];
      await sendCtl({ t: 'ctl', cmd: 'chat', name, text: 'Nam mô A Di Đà Phật' });
      await sleep(50);
    }
    // Chờ 20 người ngồi ổn định
    for (let w = 0; w < 40; w++) {
      const sz = await evalInPage('visitors.size');
      if (sz >= 20) break;
      await sleep(200);
    }
    await sleep(2000);
  }));

  // TỰ ĐẾM: số nhân vật ngồi trong seated_20 phải = 20 (đếm từ state, in ra); nếu ≠ thì ghi LỖI
  const seatedCount = await evalInPage(`
    (() => {
      let count = 0;
      for (const v of visitors.values()) {
        if (!v.inCeremony && !v.atAltarSpot) count++;
      }
      return count;
    })()
  `);
  console.log(`\n======================================================`);
  console.log(`[TỰ ĐẾM NHÂN VẬT NGỒI]: Số nhân vật ngồi = ${seatedCount} (Kỳ vọng: 20)`);
  if (seatedCount === 20) {
    console.log(`✓ KẾT QUẢ: ĐẠT (seated === 20)`);
  } else {
    console.error(`✗ LỖI: Số nhân vật ngồi = ${seatedCount} khác 20!`);
    throw new Error(`LỖI: Tự đếm seated_20 = ${seatedCount} ≠ 20`);
  }
  console.log(`======================================================\n`);

  // ==================== 3. ceremony_code.png (?ceremony=code) ====================
  // 20 người ngồi + 2 người làm lễ (!cúng bái) qua đường sự kiện thật
  results.push(await captureShot('ceremony_code', async () => {
    // Kích hoạt 2 người lễ !cúng bái
    await sendCtl({ t: 'ctl', cmd: 'chat', name: DEMO_NAMES[0], text: '!cúng bái' });
    await sleep(500);
    await sendCtl({ t: 'ctl', cmd: 'chat', name: DEMO_NAMES[1], text: '!cúng bái' });
    // Chờ 2 người bước lên bồ đoàn hoặc hành lễ
    await sleep(3500);
  }));

  // ==================== 4. ceremony.png ====================
  // 8 người trên 8 gối + 2 trụ trì + 20 người ngồi
  results.push(await captureShot('ceremony', async () => {
    // Đảm bảo có đủ 20 người ngồi
    const curSize = await evalInPage('visitors.size');
    if (curSize < 20) {
      for (let i = curSize; i < 20; i++) {
        await sendCtl({ t: 'ctl', cmd: 'chat', name: DEMO_NAMES[i], text: 'Nam mô A Di Đà Phật' });
        await sleep(40);
      }
    }
    // Đặt 8 người lên 8 gối (row 0: 4 quỳ chắp tay, row 1: 4 lạy sát đất)
    await evalInPage(`
      (() => {
        const rows = [
          { yFoot: 1418, xs: [402, 494, 586, 678] },
          { yFoot: 1478, xs: [402, 494, 586, 678] }
        ];
        const skins = ['man', 'woman', 'granny', 'monk', 'man', 'woman', 'granny', 'monk'];
        let idx = 0;
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          const isFront = (r === 1);
          for (let c = 0; c < row.xs.length; c++) {
            const x = row.xs[c];
            const y = row.yFoot;
            const id = 'ceremony_cushion_' + idx;
            const name = 'Lễ ' + (idx + 1);
            let cv = visitors.get(id);
            if (!cv) {
              cv = new Character({ id, name, skin: skins[idx] }, x, y);
              visitors.set(id, cv);
            }
            cv.x = x;
            cv.y = y;
            cv.targetX = x;
            cv.targetY = y;
            cv.scale = 115 / 260; // Đúng chuẩn seatHeight 115, không phóng to
            cv.targetScale = cv.scale;
            cv.atAltarSpot = true;
            cv.inCeremony = true;
            cv.walkControlled = false;
            cv.state = 'sit';
            cv.fade = 1;
            cv.poseMix = 1;
            cv.kneelMix = 1;
            cv.prostrateMix = isFront ? 1 : 0; // Hàng trước (idx 4..7) lạy sát đất, hàng sau quỳ
            cv.walkImgKey = 'stand';
            cv.ceremonyTagText = 'Lễ ' + (idx + 1);
            idx++;
          }
        }
      })()
    `);
    await sleep(2000);
  }));

  // ==================== 5. 6 Cảnh (scene_*.png) ====================
  const scenes = ['day', 'dawn', 'night', 'ram', 'phatdan', 'vulan'];
  const sceneBrightnesses = {};

  for (const sc of scenes) {
    const shot = await captureShot(`scene_${sc}`, async () => {
      await sendCtl({ t: 'ctl', cmd: 'settings', settings: { scene: sc } });
      await sleep(1500);
    });
    results.push(shot);
    sceneBrightnesses[sc] = shot.avgBright;
  }

  log('Độ sáng các cảnh:', JSON.stringify(sceneBrightnesses, null, 2));
  // Kiểm tra cảnh đêm phải tối
  if (sceneBrightnesses.night >= sceneBrightnesses.day) {
    throw new Error(`LỖI: Cảnh đêm (độ sáng ${sceneBrightnesses.night}) không tối hơn cảnh ngày (${sceneBrightnesses.day})!`);
  }
  log(`✓ Xác nhận: Cảnh đêm tối rõ rệt (độ sáng TB = ${sceneBrightnesses.night.toFixed(1)} vs ngày = ${sceneBrightnesses.day.toFixed(1)})`);

  // ==================== 6. Chạy tiếp đến đủ 3 phút (180s) với sự kiện thử ====================
  log('Tiếp tục chạy overlay đến khi đủ 3 phút với luồng sự kiện thử liên tục...');
  let eventTick = 0;
  while (Date.now() - testStartTime < 185_000) {
    eventTick++;
    const sender = DEMO_NAMES[eventTick % DEMO_NAMES.length];
    if (eventTick % 3 === 0) {
      await sendCtl({ t: 'ctl', cmd: 'chat', name: sender, text: 'A Di Đà Phật tĩnh tâm' });
    } else if (eventTick % 3 === 1) {
      await sendCtl({ t: 'ctl', cmd: 'likes', name: sender, n: 5 });
    } else {
      await sendCtl({ t: 'ctl', cmd: 'gift', name: sender, gift: 'Hoa Sen', count: 1, diamonds: 1 });
    }
    await sleep(4000);
  }

  log('Đã hoàn thành 3 phút kiểm thử!');

  // ==================== Kiểm tra nhật ký live và startup ====================
  const logDir = path.join(REPO, 'logs');
  const files = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
  log('Các file trong logs/:', files);

  const startupLogFile = path.join(logDir, 'startup.log');
  if (fs.existsSync(startupLogFile)) {
    console.log('\n--- NỘI DUNG LOGS/STARTUP.LOG ---');
    console.log(fs.readFileSync(startupLogFile, 'utf8'));
    console.log('--------------------------------\n');
  }

  const liveJsonl = files.find(f => f.startsWith('live_') && f.endsWith('.jsonl'));
  if (liveJsonl) {
    console.log(`\n--- NỘI DUNG LOGS/${liveJsonl} ---`);
    console.log(fs.readFileSync(path.join(logDir, liveJsonl), 'utf8'));
    console.log('--------------------------------\n');
  }

  console.log('\n=== TẤT CẢ HÌNH ẢNH ĐÃ CHỤP THÀNH CÔNG ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error('LỖI CHẠY TEST V42:', err);
  process.exit(1);
}).finally(() => {
  cleanup();
});
