// Đo hiệu suất: server + Edge overlay (cửa sổ thật 540x960) với 100 bot.
// Dùng:  node scripts/bench.mjs <số phút> <nhãn> [file kết quả]
// Biến môi trường: BENCH_EDGE (đường dẫn msedge.exe), BENCH_EDGE_FLAGS (cờ Edge thêm, cách nhau bằng dấu cách).
// Mọi lệnh CDP có timeout 10s: treo thì bỏ mẫu, ghi log, và luôn đóng Edge + server sạch khi kết thúc.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const LIVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = Math.min(Math.max(+process.argv[2] || 10, 0.5), 240);
const LABEL = String(process.argv[3] || 'run').replace(/[^\w.-]/g, '_');
const OUT = process.argv[4] || path.join(os.tmpdir(), 'bench_' + LABEL + '.json');
const EDGE = process.env.BENCH_EDGE || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));
const EXTRA_FLAGS = (process.env.BENCH_EDGE_FLAGS || '').split(/\s+/).filter(Boolean);
const UDD = path.join(os.tmpdir(), 'bench_edge_' + Date.now());
const CDP_PORT = 9333;
const CDP_TIMEOUT_MS = 10000;
const INTERVAL = 30000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const getJSON = u => new Promise((res, rej) => {
  const rq = http.get(u, { timeout: CDP_TIMEOUT_MS }, r => {
    let b = ''; r.on('data', c => b += c);
    r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  });
  rq.on('timeout', () => rq.destroy(new Error('timeout ' + u)));
  rq.on('error', rej);
});

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.p = new Map();
    this.ws.on('message', d => {
      let m; try { m = JSON.parse(d); } catch { return; }
      const h = m.id && this.p.get(m.id);
      if (h) { this.p.delete(m.id); clearTimeout(h.timer); h.resolve(m); }
    });
    this.ws.on('error', () => {});
    this.ready = new Promise((r, j) => { this.ws.on('open', r); this.ws.on('error', j); });
  }
  // Mọi lệnh đều có timeout; quá hạn thì reject để người gọi bỏ mẫu.
  async send(method, params = {}) {
    await Promise.race([this.ready, sleep(CDP_TIMEOUT_MS).then(() => { throw new Error('CDP chưa mở: ' + method); })]);
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.p.delete(id); reject(new Error('CDP treo >10s: ' + method)); }, CDP_TIMEOUT_MS);
      this.p.set(id, { resolve, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.p.delete(id); reject(e); }
    });
  }
  close() { try { this.ws.terminate(); } catch {} }
}

let srv = null, edge = null, br = null, pg = null, ctl = null, cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  log('Dọn dẹp: đóng Edge và server');
  try { if (br) await br.send('Browser.close'); } catch {}
  await sleep(800);
  for (const c of [pg, br]) c && c.close();
  try { ctl && ctl.terminate(); } catch {}
  // Dừng đúng PID đã spawn (không taskkill hàng loạt).
  for (const [p, n] of [[edge, 'Edge'], [srv, 'server']]) {
    if (!p || p.exitCode !== null) continue;
    try { p.kill(); } catch {}
    await sleep(500);
    if (p.exitCode === null && process.platform === 'win32') {
      try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
  }
  try { fs.rmSync(UDD, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch {}
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup().finally(() => process.exit(130)); });

async function main() {
  if (!EDGE) throw new Error('Không tìm thấy msedge.exe (đặt BENCH_EDGE)');
  srv = spawn('node', ['server.mjs'], { cwd: LIVE, stdio: 'ignore' });
  await sleep(2500);
  edge = spawn(EDGE, ['--app=http://localhost:3000/live/overlay.html', '--window-size=540,960', '--window-position=50,20',
    '--user-data-dir=' + UDD, '--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', ...EXTRA_FLAGS],
  { stdio: 'ignore' });

  // Chờ cổng CDP và tab overlay xuất hiện (tối đa 30s) thay vì ngủ cố định.
  let ver = null, page = null;
  for (let i = 0; i < 30 && !page; i++) {
    await sleep(1000);
    try {
      ver = await getJSON(`http://127.0.0.1:${CDP_PORT}/json/version`);
      page = (await getJSON(`http://127.0.0.1:${CDP_PORT}/json`)).find(t => t.type === 'page' && /overlay/.test(t.url));
    } catch {}
  }
  if (!page) throw new Error('Edge không mở được CDP/tab overlay sau 30s');
  br = new Cdp(ver.webSocketDebuggerUrl); pg = new Cdp(page.webSocketDebuggerUrl);
  await pg.send('Page.bringToFront'); await pg.send('Performance.enable'); await pg.send('Runtime.enable');
  await pg.send('Runtime.evaluate', { expression: `window.__f=0;(function l(){window.__f++;requestAnimationFrame(l)})();document.getElementById('unmute')?.click();0` });

  // Trạng thái GPU của Edge (tương đương edge://gpu): canvas phần cứng hay phần mềm.
  try {
    const gi = (await br.send('SystemInfo.getInfo')).result;
    const fs_ = gi.gpu && gi.gpu.featureStatus || {};
    log('GPU featureStatus:', JSON.stringify(fs_));
    log('GPU devices:', JSON.stringify((gi.gpu.devices || []).map(d => d.deviceString)));
  } catch (e) { log('Không đọc được GPU info:', e.message); }

  ctl = new WebSocket('ws://localhost:3000/ws?role=control', { headers: { Origin: 'http://localhost:3000' } });
  ctl.on('error', e => log('ctl lỗi:', e.message));
  await new Promise((r, j) => { ctl.on('open', r); ctl.on('error', j); });
  const cmd = o => { try { ctl.send(JSON.stringify({ t: 'ctl', ...o })); } catch (e) { log('Gửi lệnh lỗi:', e.message); } };
  cmd({ cmd: 'bots', on: true, n: 100, pace: 'fast' });
  await sleep(15000);                               // cho 100 chỗ đầy

  const cpuNow = async () => {
    const l = (await br.send('SystemInfo.getProcessInfo')).result.processInfo; let t = 0; const byType = {};
    for (const p of l) { t += p.cpuTime; byType[p.type] = (byType[p.type] || 0) + p.cpuTime; }
    return { t, byType };
  };
  const heap = async () => Object.fromEntries((await pg.send('Performance.getMetrics')).result.metrics.map(x => [x.name, x.value]));
  const evalNum = async ex => (await pg.send('Runtime.evaluate', { expression: ex })).result.result.value;
  const nodeMem = () => {
    try {
      const o = execFileSync('tasklist', ['/FI', 'PID eq ' + srv.pid, '/FO', 'CSV', '/NH']).toString();
      const m = /"([\d,.]+) K"/.exec(o); return m ? +m[1].replace(/[,.]/g, '') / 1024 : null;
    } catch { return null; }
  };

  const rows = []; const kinds = ['incense', 'worship', 'prostrate'];
  const N = Math.round(MIN * 60000 / INTERVAL);
  let c0 = null, f0 = null, t0 = Date.now();
  try { c0 = await cpuNow(); f0 = await evalNum('window.__f'); t0 = Date.now(); } catch (e) { log('Mẫu gốc lỗi:', e.message); }
  let skipped = 0;
  for (let i = 1; i <= N; i++) {
    for (let k = 0; k < INTERVAL / 6000; k++) {          // tải thêm: lên lễ, follow, quà lớn xen kẽ
      cmd({ cmd: 'ceremony', name: 'Khach' + (i * 5 + k) % 40, kind: kinds[(i + k) % 3] });
      if (k % 2) cmd({ cmd: 'follow', name: 'F' + i + '_' + k });
      else cmd({ cmd: 'gift', name: 'Gift' + (k % 7), gift: 'Đèn hoa sen', count: 1, diamonds: 99 });
      await sleep(6000);
    }
    try {
      await pg.send('Page.bringToFront');
      const vis = (await pg.send('Runtime.evaluate', { expression: 'document.visibilityState' })).result.result.value;
      const c1 = await cpuNow(), f1 = await evalNum('window.__f'), t1 = Date.now();
      const dt = (t1 - t0) / 1000, m = await heap();
      if (!c0 || f0 == null) { c0 = c1; f0 = f1; t0 = t1; throw new Error('chưa có mẫu gốc, đặt lại mốc'); }
      const g = k => (c1.byType[k] || 0) - (c0.byType[k] || 0);
      const fps = +((f1 - f0) / dt).toFixed(1), cpu = +((c1.t - c0.t) / dt * 100).toFixed(1);
      const row = { min: +(i * INTERVAL / 60000).toFixed(1), fps, edgeCpuPctOfOneCore: cpu,
        renderer: +(g('renderer') / dt * 100).toFixed(1), gpu: +(g('GPU') / dt * 100).toFixed(1), browser: +(g('browser') / dt * 100).toFixed(1),
        msPerFrame: fps > 0 ? +(cpu / fps * 10).toFixed(1) : null,
        vis, jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, nodeRssMB: nodeMem() };
      rows.push(row); console.log(JSON.stringify(row)); c0 = c1; f0 = f1; t0 = t1;
    } catch (e) {
      skipped++; log(`Bỏ mẫu ${i}/${N}: ${e.message}`);
      c0 = null; f0 = null;                                // sau lỗi, mẫu kế tiếp chỉ đặt lại mốc
      try { c0 = await cpuNow(); f0 = await evalNum('window.__f'); t0 = Date.now(); } catch {}
      if (skipped >= 3 && rows.length === 0) throw new Error('Quá nhiều mẫu lỗi liên tiếp, dừng đo');
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, edgeFlags: EXTRA_FLAGS, skipped, rows }, null, 1));
  const ok = rows.filter(r => r.fps >= 20 && r.msPerFrame != null);
  const avg = k => ok.length ? +(ok.reduce((s, r) => s + r[k], 0) / ok.length).toFixed(1) : null;
  log(`Xong. ${rows.length} mẫu, bỏ ${skipped}. Mẫu fps≥20: ${ok.length}; fps TB ${avg('fps')}, ms/khung TB ${avg('msPerFrame')}, CPU Edge TB ${avg('edgeCpuPctOfOneCore')}%, GPU TB ${avg('gpu')}%. Ghi ${OUT}`);
}

let code = 0;
try { await main(); } catch (e) { code = 1; log('LỖI:', e.message); }
finally { await cleanup(); }
process.exit(code);
