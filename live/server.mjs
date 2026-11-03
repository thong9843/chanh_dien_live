// Chánh Điện Tịnh Tâm — live server
// Runs on the streaming PC. Serves the overlay + control panel, listens to a TikTok LIVE room,
// keeps the list of seated viewers, generates Vietnamese voice lines with Edge TTS and pushes
// everything to the overlay over WebSocket.
//
//   cd live && npm install && npm start        → http://localhost:3000/live/control.html
//
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import DEFAULT_CONTENT from './content.defaults.mjs';
import { readGift } from './gift-event.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');            // repo root: serves /assets, /live
const TTS_DIR = path.join(__dirname, 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });
for (const f of fs.readdirSync(TTS_DIR)) { if (!f.startsWith('cache_')) try { fs.unlinkSync(path.join(TTS_DIR, f)); } catch {} }
// live/.env (đã nằm trong .gitignore, không bao giờ commit): EULER_API_KEY=... — đọc bằng loadEnvFile có sẵn của Node 20.12+, không thêm dependency.
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}
const PORT = +process.env.PORT || 3000;

/* ------------------------------------------------------------- không để sập
   Lỗi không bắt được (thư viện TTS/TikTok phát sự kiện error không ai nghe, promise bị bỏ rơi…) được ghi log đầy đủ rồi server chạy tiếp.
   Chỉ thoát khi không mở được cổng, hoặc lỗi lặp quá 20 lần trong 60 giây (tránh vòng lặp lỗi vô tận). */
const crashTimes = [];
function survive(kind, err){
  lastRecordedError = `${kind}: ${String(err?.message || err).slice(0, 120)}`;
  console.error(`[${kind}]`, err?.stack || err);
  try { addLog(`⚠ ${kind}: ${String(err?.message || err).replace(/\s+/g, ' ').slice(0, 200)} (server vẫn chạy)`); } catch {}
  if (err?.code === 'EADDRINUSE' || err?.code === 'EACCES') { console.error('Không mở được cổng, thoát.'); process.exit(1); }
  const now = Date.now(); crashTimes.push(now); while (crashTimes.length && now - crashTimes[0] > 60_000) crashTimes.shift();
  if (crashTimes.length > 20) { console.error('Lỗi lặp quá nhiều (>20 lần/60 giây), thoát.'); process.exit(1); }
}
process.on('unhandledRejection', r => survive('unhandledRejection', r));
process.on('uncaughtException', e => survive('uncaughtException', e));
const bg = (label, p) => Promise.resolve(p).catch(e => { try { addLog(`${label}: ${String(e?.message || e).slice(0, 200)}`); } catch {} });   // promise chạy nền: luôn bắt lỗi
const guard = (label, fn) => (...a) => { try { return fn(...a); } catch (e) { try { addLog(`${label}: ${String(e?.message || e).slice(0, 200)}`); } catch {} } };   // handler sự kiện: không ném lỗi ra ngoài

/* ------------------------------------------------------------------ content
   Mọi chuỗi hiển thị / đọc nằm trong live/content.json. Thiếu file hoặc thiếu khóa thì dùng content.defaults.mjs.
   Chuỗi bị cắt độ dài, số bị kẹp khoảng, nên file sai cũng không làm hỏng server. */
const cStr = (v, d, n) => (typeof v === 'string' && v.trim()) ? v.slice(0, n) : d;
const cArr = (v, d, n, max) => { const a = Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).slice(0, max).map(x => x.slice(0, n)) : []; return a.length ? a : d; };
const cNum = (v, lo, hi, d) => Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
function loadContent(){
  let r = {};
  try { r = JSON.parse(fs.readFileSync(path.join(__dirname, 'content.json'), 'utf8')) || {}; }
  catch (e) { console.warn('content.json lỗi hoặc thiếu, dùng giá trị mặc định:', e.message); }
  const D = DEFAULT_CONTENT, o = k => (r[k] && typeof r[k] === 'object' && !Array.isArray(r[k])) ? r[k] : {};
  const labels = {}; for (const k of Object.keys(D.labels)) labels[k] = cStr(o('labels')[k], D.labels[k], 60);
  const gift = {}; for (const k of Object.keys(D.gift)) gift[k] = cStr(o('gift')[k], D.gift[k], 260);
  const rawOracles = Array.isArray(r.oracles) && r.oracles.length ? r.oracles : D.oracles;
  const oracles = rawOracles.slice(0, 50).map((it, i) => {
    const fb = D.oracles[i % D.oracles.length];
    return (it && typeof it === 'object') ? {
      title: cStr(it.title, fb.title, 60),
      verse: cStr(it.verse, fb.verse, 180),
      advice: cStr(it.advice, fb.advice, 180),
    } : fb;
  });
  const cr = o('credit'), em = Array.isArray(cr.everyMin) && cr.everyMin.length === 2 ? cr.everyMin : D.credit.everyMin;
  const lo = cNum(em[0], .05, 600, 5), hi = cNum(em[1], .05, 600, 10);
  const zm = o('zoom'), dz = D.zoom;
  const ce = o('ceremony'), dce = D.ceremony;
  return {
    channel: { title: cStr(o('channel').title, D.channel.title, 40), subtitle: cStr(o('channel').subtitle, D.channel.subtitle, 60) },
    labels, gift, oracles,
    avatar: { hosts: cArr(o('avatar').hosts, D.avatar.hosts, 60, 20).map(h => h.toLowerCase().replace(/^\.+/, '')).filter(h => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) },
    guide: { title: cStr(o('guide').title, D.guide.title, 60), lines: cArr(o('guide').lines, D.guide.lines, 160, 12) },
    prayers: cArr(r.prayers, D.prayers, 300, 100), chants: cArr(r.chants, D.chants, 400, 100),
    demo: { names: cArr(o('demo').names, D.demo.names, 18, 200), botLines: cArr(o('demo').botLines, D.demo.botLines, 120, 100) },
    member: { line: cStr(o('member').line, D.member.line, 240) },
    follow: { line: cStr(o('follow').line, D.follow.line, 240) },
    share: { text: cStr(o('share').text, D.share.text, 80), showSec: cNum(o('share').showSec, 1, 30, D.share.showSec) },
    milestone: { every: Math.round(cNum(o('milestone').every, 100, 100000, D.milestone.every)), line: cStr(o('milestone').line, D.milestone.line, 240),
                 text: cStr(o('milestone').text, D.milestone.text, 80), showSec: cNum(o('milestone').showSec, 1, 30, D.milestone.showSec) },
    zoom: {
      enabled: typeof zm.enabled === 'boolean' ? zm.enabled : dz.enabled,
      minCoins: Math.round(cNum(zm.minCoins, 1, 50000, dz.minCoins)),
      onFollow: typeof zm.onFollow === 'boolean' ? zm.onFollow : dz.onFollow,
      scaleFrom: cNum(zm.scaleFrom, 0.5, 2, dz.scaleFrom),
      scaleTo: cNum(zm.scaleTo, 1.05, 3, dz.scaleTo),
      holdSec: cNum(zm.holdSec, 1, 20, dz.holdSec),
      outSec: cNum(zm.outSec, 0.3, 10, dz.outSec),
      cooldownSec: cNum(zm.cooldownSec, 0, 300, dz.cooldownSec),
      maxQueue: Math.round(cNum(zm.maxQueue, 0, 20, dz.maxQueue)),
    },
    ceremony: {
      inviteText: cStr(ce.inviteText, dce.inviteText, 120),
      fadeSec: cNum(ce.fadeSec, 0.2, 3, dce.fadeSec),
      incenseBoostSec: cNum(ce.incenseBoostSec, 1, 30, dce.incenseBoostSec),
      inviteSec: cNum(ce.inviteSec, 1, 10, dce.inviteSec),
      gapSec: cNum(ce.gapSec, 0, 10, dce.gapSec),
      incenseHoldSec: cNum(ce.incenseHoldSec, 0.5, 10, dce.incenseHoldSec),
      tailSec: cNum(ce.tailSec, 0, 3, dce.tailSec),
      bow: (() => {
        const b = (ce.bow && typeof ce.bow === 'object' && !Array.isArray(ce.bow)) ? ce.bow : {}, db = dce.bow;
        return {
          dropPct: cNum(b.dropPct, 0, 0.12, db.dropPct), squashPct: cNum(b.squashPct, 0, 0.15, db.squashPct),
          leanPx: cNum(b.leanPx, 0, 12, db.leanPx),
          downSec: cNum(b.downSec, 0.2, 5, db.downSec), holdSec: cNum(b.holdSec, 0, 6, db.holdSec),
          upSec: cNum(b.upSec, 0.2, 5, db.upSec), prostrateHoldSec: cNum(b.prostrateHoldSec, 0, 8, db.prostrateHoldSec),
          pauseSec: cNum(b.pauseSec, 0, 3, db.pauseSec),
        };
      })(),
      walk: (() => {
        const w = (ce.walk && typeof ce.walk === 'object' && !Array.isArray(ce.walk)) ? ce.walk : {}, dw = dce.walk;
        let minSec = cNum(w.minSec, 0.3, 10, dw.minSec), maxSec = cNum(w.maxSec, 0.3, 20, dw.maxSec); if (minSec > maxSec) { minSec = dw.minSec; maxSec = dw.maxSec; }
        return {
          speedPxPerSec: cNum(w.speedPxPerSec, 20, 1000, dw.speedPxPerSec), minSec, maxSec,
          stepSec: cNum(w.stepSec, 0.1, 2, dw.stepSec), riseSec: cNum(w.riseSec, 0.1, 2, dw.riseSec),
          bobPx: cNum(w.bobPx, 0, 12, dw.bobPx), laneFrac: cNum(w.laneFrac, 0.1, 0.9, dw.laneFrac),
        };
      })(),
      stand: (() => {
        const t = (ce.stand && typeof ce.stand === 'object' && !Array.isArray(ce.stand)) ? ce.stand : {}, dt = dce.stand;
        const hr = (t.headRatio && typeof t.headRatio === 'object') ? t.headRatio : {}, headRatio = {};
        for (const k of Object.keys(dt.headRatio)) headRatio[k] = cNum(hr[k], 0.05, 0.4, dt.headRatio[k]);
        return { dropPct: cNum(t.dropPct, 0, 0.12, dt.dropPct), squashPct: cNum(t.squashPct, 0, 0.15, dt.squashPct),
          waistRatio: cNum(t.waistRatio, 0.3, 0.7, dt.waistRatio), headRatio };
      })(),
      kneel: (() => {
        const k = (ce.kneel && typeof ce.kneel === 'object' && !Array.isArray(ce.kneel)) ? ce.kneel : {}, dk = dce.kneel;
        return { downSec: cNum(k.downSec, 0.1, 2, dk.downSec), upSec: cNum(k.upSec, 0.1, 2, dk.upSec), prostrateFadeSec: cNum(k.prostrateFadeSec, 0.1, 2, dk.prostrateFadeSec),
                 scale: cNum(k.scale, 0.5, 1.2, dk.scale) };   // hệ số thu nhỏ ảnh quỳ/lạy so với ảnh đứng
      })(),
      prostrateExtraDrop: (() => {
        const e = (ce.prostrateExtraDrop && typeof ce.prostrateExtraDrop === 'object' && !Array.isArray(ce.prostrateExtraDrop)) ? ce.prostrateExtraDrop : {}, out = {};
        for (const k of Object.keys(dce.prostrateExtraDrop)) out[k] = cNum(e[k], 0, 0.12, dce.prostrateExtraDrop[k]);
        return out;
      })(),
      maxQueue: Math.round(cNum(ce.maxQueue, 1, 20, dce.maxQueue)),
      cooldownSec: cNum(ce.cooldownSec, 0, 3600, dce.cooldownSec),
    },
    tts: {
      minGapMs: cNum(o('tts')?.minGapMs, 500, 10000, D.tts?.minGapMs || 2000),
      cacheMaxMB: cNum(o('tts')?.cacheMaxMB, 50, 2000, D.tts?.cacheMaxMB || 200),
      order: (() => {
        const allowed = ['vieneu', 'edge', 'cached'];
        const raw = Array.isArray(o('tts')?.order) ? o('tts').order : D.tts?.order;
        const filtered = (raw || []).filter(x => allowed.includes(x));
        return filtered.length ? filtered : ['vieneu', 'cached'];
      })(),
      vieneuVoice: cStr(o('tts')?.vieneuVoice, D.tts?.vieneuVoice || 'Thiền Tâm Đức', 80),
      vieneuSpeed: cNum(o('tts')?.vieneuSpeed, 0.7, 1.2, D.tts?.vieneuSpeed || 0.9),
      minGiftWhenBusy: Math.round(cNum(o('tts')?.minGiftWhenBusy, 1, 50000, D.tts.minGiftWhenBusy)),   // hàng đợi giọng bận: quà dưới ngưỡng này chỉ phát câu chung đã lưu
      busyQueueLen: Math.round(cNum(o('tts')?.busyQueueLen, 1, 8, D.tts.busyQueueLen)),
    },
    limits: (() => { const l = o('limits'), dl = D.limits; return {
      chatGapSec: cNum(l.chatGapSec, 0, 60, dl.chatGapSec), rotateAfterMin: cNum(l.rotateAfterMin, 0.1, 600, dl.rotateAfterMin),
      batchMs: Math.round(cNum(l.batchMs, 20, 1000, dl.batchMs)), giftComboMs: Math.round(cNum(l.giftComboMs, 200, 10000, dl.giftComboMs)),
      giftComboMaxMs: Math.round(cNum(l.giftComboMaxMs, 500, 30000, dl.giftComboMaxMs)) }; })(),
    oracle: {
      userCooldownSec: cNum(o('oracle')?.userCooldownSec, 10, 3600, D.oracle?.userCooldownSec || 600),
      globalCooldownSec: cNum(o('oracle')?.globalCooldownSec, 1, 300, D.oracle?.globalCooldownSec || 20),
      tts: cStr(o('oracle')?.tts, D.oracle?.tts || 'Pháp ngữ gửi Phật tử {name}.', 200),
    },
    scene: (() => {
      const sc = o('scene'), ds = D.scene, h = (sc.halo && typeof sc.halo === 'object' && !Array.isArray(sc.halo)) ? sc.halo : {}, dh = ds.halo;
      let dayFrom = Math.round(cNum(sc.dayFromHour, 0, 23, ds.dayFromHour)), nightFrom = Math.round(cNum(sc.nightFromHour, 1, 24, ds.nightFromHour));
      if (dayFrom >= nightFrom) { dayFrom = ds.dayFromHour; nightFrom = ds.nightFromHour; }
      return { fadeSec: cNum(sc.fadeSec, 0, 10, ds.fadeSec), dayFromHour: dayFrom, nightFromHour: nightFrom,
               lunar: (() => { const lu = (sc.lunar && typeof sc.lunar === 'object' && !Array.isArray(sc.lunar)) ? sc.lunar : {}, dl = ds.lunar;
                 const rg = (k, withMonth) => { const r = (lu[k] && typeof lu[k] === 'object') ? lu[k] : {}, dr = dl[k]; let from = Math.round(cNum(r.from, 1, 30, dr.from)), to = Math.round(cNum(r.to, 1, 30, dr.to)); if (from > to) { from = dr.from; to = dr.to; }
                   return withMonth ? { month: Math.round(cNum(r.month, 1, 12, dr.month)), from, to } : { from, to }; };
                 return { recheckMin: cNum(lu.recheckMin, 1, 1440, dl.recheckMin), ram: rg('ram', false), phatdan: rg('phatdan', true), vulan: rg('vulan', true) }; })(),
               halo: { x: cNum(h.x, 0, 1080, dh.x), y: cNum(h.y, 0, 1920, dh.y), r: cNum(h.r, 30, 400, dh.r), alpha: cNum(h.alpha, 0, 0.6, dh.alpha),
                       breathSec: cNum(h.breathSec, 3, 20, dh.breathSec), breathAmp: cNum(h.breathAmp, 0, 0.8, dh.breathAmp) } };
    })(),
    plaque: {
      enabled: typeof o('plaque').enabled === 'boolean' ? o('plaque').enabled : D.plaque.enabled,
      text: cStr(o('plaque').text, D.plaque.text, 60),
      top: cNum(o('plaque').top, 40, 270, D.plaque.top),
      width: cNum(o('plaque').width, 200, 760, D.plaque.width),
      height: cNum(o('plaque').height, 36, 140, D.plaque.height)
    },
    layout: (() => {
      const L = o('layout'), D = DEFAULT_CONTENT.layout, sub = k => (L[k] && typeof L[k] === 'object' && !Array.isArray(L[k])) ? L[k] : {};
      const n = (src, def, k, lo, hi) => cNum(src[k], lo, hi, def[k]);
      const fl = sub('floor'), df = D.floor;
      let yTop = n(fl, df, 'yTop', 0, 1920), yBot = n(fl, df, 'yBot', 0, 1920); if (yTop >= yBot){ yTop = df.yTop; yBot = df.yBot; }
      const g = sub('candleGlow'), dg = D.candleGlow, h = sub('halo'), dh = D.halo;
      const as = sub('altarSpot'), das = D.altarSpot;
      const tl = Array.isArray(L.teachers) && L.teachers.length ? L.teachers.slice(0, 8) : D.teachers;
      return {
        halo: { y: n(h, dh, 'y', -500, 2500), scale: n(h, dh, 'scale', .05, 5), alpha: n(h, dh, 'alpha', 0, 1) },
        candleGlow: { x: n(g, dg, 'x', -1080, 1080), y: n(g, dg, 'y', 0, 1920), w: n(g, dg, 'w', 0, 2160), h: n(g, dg, 'h', 0, 1920) },
        incense: { y: n(sub('incense'), D.incense, 'y', 0, 1920) },
        teachers: tl.map((t, i) => { const dt = D.teachers[i] || D.teachers[0], tt = (t && typeof t === 'object') ? t : {};
          return { name: cStr(tt.name, dt.name, 30), skin: ['monk','nun','granny','man','woman','child'].includes(tt.skin) ? tt.skin : dt.skin,
                   x: cNum(tt.x, 0, 1080, dt.x), y: cNum(tt.y, 0, 1920, dt.y), s: cNum(tt.s, .05, 5, dt.s), master: !!tt.master, flip: !!tt.flip }; }),
        teacherTagGap: cNum(L.teacherTagGap, 0, 60, D.teacherTagGap),   // khoảng cách thẻ tên thầy tới đỉnh đầu
        buddhaGlow: (() => { const b = sub('buddhaGlow'), db = D.buddhaGlow, bs = k => (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? b[k] : {};
          const h = bs('head'), dh = db.head, bd = bs('body'), dbd = db.body, vg = bs('vignette'), dvg = db.vignette;
          return { head: { x: cNum(h.x, 0, 1080, dh.x), y: cNum(h.y, 0, 1920, dh.y), r: cNum(h.r, 50, 700, dh.r), alpha: cNum(h.alpha, 0, 0.8, dh.alpha) },
                   body: { x: cNum(bd.x, 0, 1080, dbd.x), y: cNum(bd.y, 0, 1920, dbd.y), rx: cNum(bd.rx, 50, 700, dbd.rx), ry: cNum(bd.ry, 50, 700, dbd.ry), alpha: cNum(bd.alpha, 0, 0.8, dbd.alpha) },
                   breathSec: cNum(b.breathSec, 6, 8, db.breathSec), breathAmp: cNum(b.breathAmp, 0, 0.6, db.breathAmp), nightBoost: cNum(b.nightBoost, 1, 2.5, db.nightBoost),
                   vignette: { alpha: cNum(vg.alpha, 0, 0.3, dvg.alpha), size: cNum(vg.size, 40, 600, dvg.size) } }; })(),
        // Đỉnh Sổ Vàng: không bao giờ cao hơn y 640 (vùng mặt tượng y 250–600 luôn được chừa trống)
        meritScroll: { top: cNum(sub('meritScroll').top, 640, 1700, D.meritScroll.top) },
        ui: (() => { const u = sub('ui'), du = D.ui, sb = k => (u[k] && typeof u[k] === 'object' && !Array.isArray(u[k])) ? u[k] : {};
          const ch = sb('chips'), dch = du.chips, tp = sb('tips'), dtp = du.tips, mr = sb('merit'), dmr = du.merit;
          return { chips: { top: cNum(ch.top, 0, 1800, dch.top), left: cNum(ch.left, 0, 540, dch.left), right: cNum(ch.right, 540, 1080, dch.right) },
                   // hai thẻ chân màn hình: gợi ý bình luận (trái), Tri Ân (phải)
                   tips: { x: cNum(tp.x, 0, 700, dtp.x), y: cNum(tp.y, 0, 1850, dtp.y), w: cNum(tp.w, 120, 400, dtp.w), h: cNum(tp.h, 60, 1200, dtp.h),
                           sec: cNum(tp.sec, 2, 60, dtp.sec), perPage: Math.round(cNum(tp.perPage, 1, 6, dtp.perPage)) },
                   merit: { x: cNum(mr.x, 540, 1000, dmr.x), y: cNum(mr.y, 0, 1850, dmr.y), w: cNum(mr.w, 120, 400, dmr.w), h: cNum(mr.h, 60, 1200, dmr.h),
                            max: Math.round(cNum(mr.max, 1, 8, dmr.max)), nameMax: Math.round(cNum(mr.nameMax, 4, 20, dmr.nameMax)) },
                   // vùng thông báo chung (hàng đợi duy nhất): rộng ≤ 600, căn giữa x 540, nằm dưới vùng tượng
                   notice: (() => { const nt = sb('notice'), dnt = du.notice; return { top: cNum(nt.top, 900, 1500, dnt.top), h: cNum(nt.h, 100, 400, dnt.h), w: cNum(nt.w, 300, 600, dnt.w) }; })() }; })(),
        v3: (() => {
          const v = sub('v3'), dv = D.v3, so = (src, k) => (src && src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) ? src[k] : {};
          const num = (src, d, k, lo, hi) => cNum(src[k], lo, hi, d[k]);
          // cushions[]: tối đa 16 bồ đoàn {x, y, w}; hỏng/thiếu thì dùng bộ mặc định
          const cuRaw = Array.isArray(v.cushions) && v.cushions.length ? v.cushions.slice(0, 16) : dv.cushions;
          const cushions = cuRaw.map((c, i) => { const dc = dv.cushions[i % dv.cushions.length], cc = (c && typeof c === 'object') ? c : {};
            return { x: cNum(cc.x, 0, 1080, dc.x), y: cNum(cc.y, 900, 1800, dc.y), w: cNum(cc.w, 30, 300, dc.w) }; });
          const ai = so(v, 'aisle'), dai = dv.aisle, rg = so(v, 'rug'), drg = dv.rug, se = so(v, 'seats'), dse = dv.seats, ro = so(v, 'route'), dro = dv.route, lb = so(v, 'labels'), dlb = dv.labels;
          let yTop = num(ai, dai, 'yTop', 1000, 1800), yBottom = num(ai, dai, 'yBottom', 1100, 2000); if (yTop >= yBottom - 100) { yTop = dai.yTop; yBottom = dai.yBottom; }
          const poly = (arr, d) => { const p = Array.isArray(arr) ? arr.slice(0, 12).filter(q => Array.isArray(q) && q.length === 2 && Number.isFinite(+q[0]) && Number.isFinite(+q[1])).map(q => [cNum(+q[0], 0, 1080, 0), cNum(+q[1], 1000, 1920, 1000)]) : []; return p.length >= 3 ? p : d; };
          const sa = so(v, 'seatArea');
          const sc = (src, d) => { const o = (src && typeof src === 'object') ? src : {}; return { y: cNum(o.y, 1000, 1920, d.y), s: cNum(o.s, 0.05, 1.5, d.s) }; };
          let far = sc(se.seatScaleFar, dse.seatScaleFar), near = sc(se.seatScaleNear, dse.seatScaleNear); if (far.y >= near.y - 50) { far = dse.seatScaleFar; near = dse.seatScaleNear; }
          const monks = (Array.isArray(v.monkSpots) && v.monkSpots.length ? v.monkSpots : dv.monkSpots).slice(0, 8).map((m, i) => { const dm = dv.monkSpots[i] || dv.monkSpots[0], mm = (m && typeof m === 'object') ? m : {};
            return { name: cStr(mm.name, dm.name, 30), skin: ['monk', 'nun', 'granny', 'man', 'woman', 'child'].includes(mm.skin) ? mm.skin : dm.skin,
                     x: cNum(mm.x, -100, 1180, dm.x), y: cNum(mm.y, 900, 1920, dm.y), flip: typeof mm.flip === 'boolean' ? mm.flip : dm.flip, master: !!mm.master }; });
          return {
            baseW: num(v, dv, 'baseW', 100, 400), baseH: num(v, dv, 'baseH', 100, 500), spriteK: num(v, dv, 'spriteK', 0.3, 2), monkWidthK: num(v, dv, 'monkWidthK', 0.5, 2),
            maxVisibleSeats: Math.round(num(v, dv, 'maxVisibleSeats', 10, 100)),
            monkSpots: monks, cushions, footDy: num(v, dv, 'footDy', -40, 80),
            rug: { x: num(rg, drg, 'x', 0, 1080), y: num(rg, drg, 'y', 900, 1800), w: num(rg, drg, 'w', 100, 1080), h: num(rg, drg, 'h', 20, 600) },
            aisle: { yTop, yBottom, topX0: num(ai, dai, 'topX0', 0, 540), topX1: num(ai, dai, 'topX1', 540, 1080), bottomX0: num(ai, dai, 'bottomX0', 0, 540), bottomX1: num(ai, dai, 'bottomX1', 540, 1080) },
            seatArea: { left: poly(sa.left, dv.seatArea.left), right: poly(sa.right, dv.seatArea.right) },
            seats: { perSide: Math.round(num(se, dse, 'perSide', 4, 80)), gapK: num(se, dse, 'gapK', 0.3, 2), seatScaleFar: far, seatScaleNear: near },
            route: { laneK: num(ro, dro, 'laneK', 0, 1), entryDy: num(ro, dro, 'entryDy', -100, 300), gateDy: num(ro, dro, 'gateDy', -200, 200), backGapDy: num(ro, dro, 'backGapDy', 0, 200) },
            labels: { recentMax: Math.round(num(lb, dlb, 'recentMax', 1, 100)), avatarPx: Math.round(num(lb, dlb, 'avatarPx', 16, 80)), nameMax: Math.round(num(lb, dlb, 'nameMax', 4, 20)), nameFontPx: Math.round(num(lb, dlb, 'nameFontPx', 10, 30)) },
          };
        })(),
        v4: (() => {
          const v = sub('v4'), dv = D.v4 || {};
          const so = (src, k) => (src && src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) ? src[k] : {};
          const num = (src, d, k, lo, hi) => cNum(src[k], lo, hi, d[k]);
          const abbots = (Array.isArray(v.abbots) && v.abbots.length ? v.abbots : (dv.abbots || [])).slice(0, 4).map((a, i) => {
            const da = (dv.abbots && dv.abbots[i]) || { x: 190, yFoot: 1480, flip: false };
            const aa = (a && typeof a === 'object') ? a : {};
            return {
              x: cNum(aa.x, 0, 1080, da.x),
              yFoot: cNum(aa.yFoot, 1000, 1920, da.yFoot),
              flip: typeof aa.flip === 'boolean' ? aa.flip : !!da.flip
            };
          });
          const se = so(v, 'seats'), dse = dv.seats || {};
          const rows = (Array.isArray(se.rows) && se.rows.length ? se.rows : (dse.rows || [])).slice(0, 10).map((r, i) => {
            const dr = (dse.rows && dse.rows[i]) || { yFoot: 1600, leftXs: [], rightXs: [] };
            const rr = (r && typeof r === 'object') ? r : {};
            const cleanXs = (arr, dArr) => (Array.isArray(arr) && arr.length ? arr : dArr).map(x => cNum(+x, 0, 1080, 540));
            return {
              yFoot: cNum(rr.yFoot, 1000, 1920, dr.yFoot),
              leftXs: cleanXs(rr.leftXs, dr.leftXs),
              rightXs: cleanXs(rr.rightXs, dr.rightXs)
            };
          });
          const lb = so(v, 'labels'), dlb = dv.labels || {};
          const nt = so(v, 'nameTag'), dnt = dv.nameTag || {};
          const nameTag = {
            avatar: Math.round(cNum(nt.avatar, 10, 60, dnt.avatar || 22)),
            avatarBorder: cNum(nt.avatarBorder, 0.5, 5, dnt.avatarBorder || 1.5),
            font: Math.round(cNum(nt.font, 8, 24, dnt.font || 11)),
            fontWeight: cNum(nt.fontWeight, 400, 900, dnt.fontWeight || 600),
            bg: cStr(nt.bg, dnt.bg || 'rgba(0,0,0,0.55)', 40),
            padding: Array.isArray(nt.padding) && nt.padding.length === 2 ? [cNum(nt.padding[0], 0, 20, 2), cNum(nt.padding[1], 0, 30, 6)] : (dnt.padding || [2, 6]),
            maxChars: Math.round(cNum(nt.maxChars, 3, 30, dnt.maxChars || 8)),
            maxTags: Math.round(cNum(nt.maxTags, 1, 30, dnt.maxTags || 12)),
            maxHeight: Math.round(cNum(nt.maxHeight, 16, 50, dnt.maxHeight || 24)),
            maxWidth: Math.round(cNum(nt.maxWidth, 50, 200, dnt.maxWidth || 110)),
            gapHead: Math.round(cNum(nt.gapHead, 0, 30, dnt.gapHead || 4)),
          };
          const ce = so(v, 'ceremony'), dce = dv.ceremony || {};
          const ceremony = {
            drawInCode: typeof ce.drawInCode === 'boolean' ? ce.drawInCode : (dce.drawInCode !== false),
            cushion: {
              w: cNum(ce.cushion?.w, 20, 200, dce.cushion?.w || 76),
              h: ce.cushion?.h === 'auto' ? 'auto' : cNum(ce.cushion?.h, 10, 100, dce.cushion?.h || 30),
              img: cStr(ce.cushion?.img, dce.cushion?.img || 'assets/cushion.png', 100),
            },
            rows: (Array.isArray(ce.rows) && ce.rows.length ? ce.rows : (dce.rows || [])).slice(0, 4).map((r, i) => {
              const dr = (dce.rows && dce.rows[i]) || { yFoot: 1418, xs: [402, 494, 586, 678] };
              const rr = (r && typeof r === 'object') ? r : {};
              const cleanXs = (arr, dArr) => (Array.isArray(arr) && arr.length ? arr : dArr).map(x => cNum(+x, 0, 1080, 540));
              return {
                yFoot: cNum(rr.yFoot, 1000, 1920, dr.yFoot),
                xs: cleanXs(rr.xs, dr.xs),
              };
            }),
            carpet: {
              x: cNum(ce.carpet?.x, 0, 1080, dce.carpet?.x || 340),
              y: cNum(ce.carpet?.y, 1000, 1920, dce.carpet?.y || 1372),
              w: cNum(ce.carpet?.w, 100, 1080, dce.carpet?.w || 400),
              h: cNum(ce.carpet?.h, 50, 600, dce.carpet?.h || 132),
              color: cStr(ce.carpet?.color, dce.carpet?.color || '#8e1b17', 20),
              border: cStr(ce.carpet?.border, dce.carpet?.border || '#c99a3b', 20),
            },
            abbots: (Array.isArray(ce.abbots) && ce.abbots.length ? ce.abbots : (dce.abbots || [])).slice(0, 4).map((a, i) => {
              const da = (dce.abbots && dce.abbots[i]) || { x: i === 0 ? 290 : 790, yFoot: 1480 };
              const aa = (a && typeof a === 'object') ? a : {};
              return {
                x: cNum(aa.x, 0, 1080, da.x),
                yFoot: cNum(aa.yFoot, 1000, 1920, da.yFoot),
                flip: typeof aa.flip === 'boolean' ? aa.flip : (i > 0)
              };
            }),
          };
          return {
            seatHeight: num(v, dv, 'seatHeight', 50, 300),
            maxVisible: Math.round(num(v, dv, 'maxVisible', 10, 100)),
            abbots,
            seats: { rows },
            labels: {
              recentMax: Math.round(num(lb, dlb, 'recentMax', 1, 100)),
              avatarPx: Math.round(num(lb, dlb, 'avatarPx', 16, 80)),
              nameMax: Math.round(num(lb, dlb, 'nameMax', 4, 20)),
              nameFontPx: Math.round(num(lb, dlb, 'nameFontPx', 10, 30))
            },
            nameTag,
            ceremony
          };
        })(),
        safeZones: (Array.isArray(L.safeZones) && L.safeZones.length ? L.safeZones.slice(0, 8) : D.safeZones).map((z, i) => {
          const dz = D.safeZones[i] || D.safeZones[0], zz = (z && typeof z === 'object') ? z : {};
          return { label: cStr(zz.label, dz.label, 40), x: cNum(zz.x, 0, 1080, dz.x), y: cNum(zz.y, 0, 1920, dz.y), w: cNum(zz.w, 0, 1080, dz.w), h: cNum(zz.h, 0, 1920, dz.h) }; }),
        floor: { yTop, yBot, halfTop: n(fl, df, 'halfTop', 50, 540), halfBot: n(fl, df, 'halfBot', 50, 540) },
        altarSpot: {
          x: n(as, das, 'x', 120, 960),
          y: n(as, das, 'y', 900, 1850),
          scale: n(as, das, 'scale', 0.15, 1.5),
        },
      };
    })(),
    meritScroll: (() => { const m = o('meritScroll'), dm = D.meritScroll;
      return { title: cStr(m.title, dm.title, 60), namePrefix: cStr(m.namePrefix, dm.namePrefix, 20), offering: cStr(m.offering, dm.offering, 120),
               blessing: cStr(m.blessing, dm.blessing, 80), sealTop: cStr(m.sealTop, dm.sealTop, 8), sealBottom: cStr(m.sealBottom, dm.sealBottom, 8),
               x: cNum(m.x, 0, 1080, dm.x), halfW: cNum(m.halfW, 100, 540, dm.halfW), height: cNum(m.height, 120, 400, dm.height) }; })(),
    credit: { enabled: typeof cr.enabled === 'boolean' ? cr.enabled : D.credit.enabled, text: cStr(cr.text, D.credit.text, 120),
              everyMin: [Math.min(lo, hi), Math.max(lo, hi)], showSec: cNum(cr.showSec, 1, 60, 7), y: cNum(cr.y, 0, 1920, D.credit.y), fontPx: cNum(cr.fontPx, 10, 60, 22) },
  };
}
const CONTENT = loadContent();
// Bố cục v3 dùng chung với overlay (js/layout.js): 100 chỗ ngồi hai bên lối giữa, 8 bồ đoàn lễ, đường đi
await import('./js/layout.js');
const LV3 = globalThis.LayoutV3;
const V3 = CONTENT.layout.v3, V4 = CONTENT.layout.v4, UI = CONTENT.layout.ui;
const V3_SPOTS = LV3.buildSpots(V3);
const V3_SEATS = (V4 && LV3.buildSeatsV4) ? LV3.buildSeatsV4(V4) : LV3.buildSeats(V3, [UI.tips, UI.merit]);
const MAX_SEATS = Math.min(V4?.maxVisible || 50, V3_SEATS.length);
if (MAX_SEATS < (V3.maxVisibleSeats || 2 * V3.seats.perSide)) console.warn(`Bố cục chỉ xếp được ${MAX_SEATS}/${V3.maxVisibleSeats || 2 * V3.seats.perSide} chỗ ngồi, kiểm tra layout.v3.seats`);
const CLIENT_CONTENT = {
  labels: CONTENT.labels, scene: CONTENT.scene, avatar: CONTENT.avatar, guide: CONTENT.guide, plaque: CONTENT.plaque, layout: CONTENT.layout, share: CONTENT.share,
  milestone: { text: CONTENT.milestone.text, showSec: CONTENT.milestone.showSec },
  gift: { what: CONTENT.gift.what, timesShown: CONTENT.gift.timesShown },
  zoom: CONTENT.zoom,
  ceremony: CONTENT.ceremony,
  credit: CONTENT.credit,
  meritScroll: CONTENT.meritScroll,
};
const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m);

/* ------------------------------------------------------------------ state */
const settings = {
  title: CONTENT.channel.title,
  subtitle: CONTENT.channel.subtitle,
  voice: 'vi-VN-NamMinhNeural',      // vi-VN-NamMinhNeural | vi-VN-HoaiMyNeural
  pitch: -18,                        // Hz — đúng cấu hình gốc kentjuno/chanh-dien-online
  rate: -20,                         // %  — đúng cấu hình gốc kentjuno/chanh-dien-online
  music: true, mo: true, moBpm: 52,
  autoChant: true, chantEveryMin: 3,
  seatMode: 'auto',                  // auto | 24 | 36 | 64 | 100
  scene: 'auto',                     // auto (ngày/đêm theo giờ thực) | lunar (theo lịch âm: Rằm / Phật Đản / Vu Lan, còn lại ngày/đêm) | day | dawn | night | ram | phatdan | vulan | old (Chánh điện cũ)
  musicTrack: 'shuffle',             // 'shuffle' (ngẫu nhiên, không lặp tới khi hết 5 bài) | '1'…'5' (lặp một bài)
  safeZone: false,                   // phủ đỏ các vùng TikTok che (chỉ để canh bố cục, không dùng khi phát)
  zoomEnabled: CONTENT.zoom.enabled, // bật/tắt zoom vào Phật tử khi quà ≥99 xu hoặc follow
  joinOnEnter: false,                // also seat viewers who only enter the room
  readMemberJoin: false,             // xướng tên chào đón người mới vào phòng (khi bật joinOnEnter)
  gifts: { readAll: true, minDiamonds: 1 },
};
const viewers = new Map();           // id -> { id, rawName, name, skin, avatar, coins, joinedAt, lastAt, lastText, lastTextAt, demo }
const startedAt = Date.now();
const LOGS_DIR = path.join(ROOT, 'logs');
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch {}
const STARTUP_LOG = path.join(LOGS_DIR, 'startup.log');
const recordedMilestones = new Set();
function recordStartupMilestone(name, ms, extra = '') {
  if (recordedMilestones.has(name)) return;
  recordedMilestones.add(name);
  const line = `[startup] ${name}: ${ms}ms${extra ? ' ' + extra : ''}`;
  console.log(line);
  try {
    fs.appendFileSync(STARTUP_LOG, `[${new Date().toISOString()}] ${line}\n`);
  } catch (e) {
    console.error('Lỗi ghi startup.log:', e?.message);
  }
}

// VIỆC 4: Ghi log cho buổi live 2 giờ (mỗi 60s ghi 1 dòng JSON vào logs/live_YYYYMMDD_HHmm.jsonl)
let lastRecordedError = null;
let eventCountWindow = 0;
let overlayStats = { fps: 30, heapMb: null, domNodes: null, updatedAt: 0 };
let overlayState = { status: 'offline', clients: 0 };
function trackEvent() { eventCountWindow++; }

const pad2 = n => String(n).padStart(2, '0');
const liveStartD = new Date();
const liveLogFilename = `live_${liveStartD.getFullYear()}${pad2(liveStartD.getMonth() + 1)}${pad2(liveStartD.getDate())}_${pad2(liveStartD.getHours())}${pad2(liveStartD.getMinutes())}.jsonl`;
const LIVE_LOG_PATH = path.join(LOGS_DIR, liveLogFilename);

function writeLiveLogLine() {
  try {
    const mem = process.memoryUsage();
    const serverHeapMb = Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10;
    const nowMs = Date.now();
    const recentOverlay = (nowMs - overlayStats.updatedAt < 90_000);
    const lineObj = {
      time: new Date().toISOString(),
      fps: recentOverlay && Number.isFinite(overlayStats.fps) ? overlayStats.fps : 30,
      heap: {
        serverMb: serverHeapMb,
        overlayMb: recentOverlay && overlayStats.heapMb !== null ? overlayStats.heapMb : null
      },
      domNodes: recentOverlay && overlayStats.domNodes !== null ? overlayStats.domNodes : 0,
      seated: viewers.size,
      waiting: overflow.size,
      ttsQueueLen: ttsQueue.length,
      eventsPerMin: eventCountWindow,
      lastError: lastRecordedError || null
    };
    eventCountWindow = 0;
    fs.appendFileSync(LIVE_LOG_PATH, JSON.stringify(lineObj) + '\n');
  } catch (e) {
    console.error('Lỗi ghi live log:', e?.message);
  }
}
setInterval(writeLiveLogLine, 60_000).unref?.();
let silentUntil = 0;                 // trạng thái chung toàn hệ thống (thiền im lặng)
let silentEndTimer = null;
let tiktok = null, tiktokState = { status: 'idle', uniqueId: '', error: '' };
const log = []; const LOG_MAX = 500;   // nhật ký vòng: giữ tối đa 500 dòng mới nhất
function addLog(s){ const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${s}`; log.push(line); if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX); broadcast({ t:'log', line }, 'control'); console.log(line); }

const CAPS = [24, 36, 64, 100];
function capacity(){ if (settings.scene !== 'old') return MAX_SEATS; if (settings.seatMode !== 'auto') return +settings.seatMode; const n = viewers.size; return CAPS.find(c => n <= c) || 100; }

/* ----------------------------------------------------- text sanitization */
// Lọc bớt tên dài, emoji, ký tự đặc biệt để đọc TTS mượt mà & hiển thị đẹp
function sanitizeDisplayName(raw){
  const clean = String(raw || '')
    .normalize('NFC')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[^\p{L}\p{N}\s._·-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (clean || CONTENT.labels.anonymous).slice(0, 20);
}
// Chuẩn hóa tên đọc trong câu: bỏ emoji, ký tự đặc biệt, gạch dưới, số đứng riêng;
// giữ nguyên tên chữ Latin không dấu; tên dài quá 3 từ cắt còn 3 từ đầu.
function spoken(raw){
  const words = String(raw || '')
    .normalize('NFC')
    .replace(/·bot\b/gi, ' ')
    .replace(/[_@.·-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w && !/^\d+$/.test(w))
    .slice(0, 3);
  const result = words.join(' ').slice(0, 48).trim();
  return result || CONTENT.labels.anonymous;
}
function sanitizeGiftName(raw){
  const clean = String(raw || '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (clean || CONTENT.labels.defaultGift).slice(0, 32);
}

/* skins: sprites that exist in /assets. */
const SKIN_WORDS = [
  ['master', ['cao tăng','cao tang']], ['monk', ['sư','su','sư thầy','su thay','thầy','thay']], ['nun', ['ni','ni cô','ni co','sư cô','su co']],
  ['child', ['tiểu','tieu','chú tiểu','chu tieu','bé','be']], ['granny', ['bà','ba','áo nâu','ao nau','cụ','cu']],
  ['woman', ['nữ','nu','chị','chi','gái','gai']], ['man', ['nam','anh','trai']],
];
function skinFromText(t){
  const w = String(t).toLowerCase().normalize('NFC').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!w || w.split(' ').length > 3) return null;
  for (const [skin, words] of SKIN_WORDS) if (words.some(k => w === k || w.startsWith(k + ' '))) return skin;
  return null;
}
const DEFAULT_SKINS = ['man', 'woman', 'woman', 'man', 'granny'];

/* ------------------------------------------- Rút Quẻ Cầu An & Lời Phật Dạy */
const ORACLE_TRIGGERS = ['!xinquẻ', '!xinque', 'xin quẻ', 'xin que', 'cầu an', 'cau an', 'tĩnh tâm', 'tinh tam', '!loiphatday'];
const oracleCooldown = new Map();
let lastOracleIdx = -1;

function isOracleRequest(text){
  const norm = String(text || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!norm) return false;
  return ORACLE_TRIGGERS.some(kw => norm.includes(kw));
}
function pickOracle(){
  const list = CONTENT.oracles;
  if (!list.length) return { title: 'Quẻ Đại An', verse: 'Tâm tịnh tức cõi Phật tịnh.', advice: 'Giữ tâm an nhiên, vạn sự cát tường.' };
  let idx = Math.floor(Math.random() * list.length);
  if (list.length > 1 && idx === lastOracleIdx) idx = (idx + 1) % list.length;
  lastOracleIdx = idx;
  return list[idx];
}
let lastGlobalOracleAt = 0;
function triggerOracle(id, name, avatar, bypassCooldown = false){
  const now = Date.now();
  const userCooldownMs = (CONTENT.oracle?.userCooldownSec || 600) * 1000;
  const globalCooldownMs = (CONTENT.oracle?.globalCooldownSec || 20) * 1000;

  if (!bypassCooldown){
    if (now - lastGlobalOracleAt < globalCooldownMs) return false;
    const prev = oracleCooldown.get(id) || 0;
    if (now - prev < userCooldownMs) return false;
  }
  lastGlobalOracleAt = now;
  oracleCooldown.set(id, now);
  const oracle = pickOracle();
  const safeName = sanitizeDisplayName(name);
  broadcast({
    t: 'oracle',
    id,
    name: safeName,
    avatar: avatar || '',
    title: oracle.title || `Pháp ngữ hôm nay · ${oracle.topic || ''}`,
    verse: oracle.teaching || oracle.verse,
    advice: oracle.advice || '',
    showSec: 8,
  });
  addLog(`📜 Pháp ngữ hôm nay cho ${safeName}: ${oracle.topic || oracle.title}`);

  // TTS reads ONLY "Pháp ngữ gửi Phật tử {name}", never the full text! Priority = 1 (oracle)
  const spokenName = spoken(name);
  const ttsTpl = CONTENT.oracle?.tts || 'Pháp ngữ gửi Phật tử {name}.';
  const ttsText = fill(ttsTpl, { name: spokenName });
  say(ttsText, { tag: 'oracle' }, 1);

  return true;
}

/* ------------------------------------------- High-tier gift detection */
const HIGH_GIFT_RE = /hoa\s*sen|sen\s*vàng|đèn\s*hoa\s*sen|rồng|dragon|kim\s*cương|diamond|chuông|sư\s*tử|lion|phượng|vàng|trầm\s*hương|universe/i;
function isHighTierGift(giftName, coins, tier){
  return tier >= 2 || coins >= 20 || HIGH_GIFT_RE.test(giftName);
}

// Ảnh đại diện chỉ nhận https + máy chủ CDN của TikTok (danh sách trong content.json → avatar.hosts); còn lại bỏ, overlay vẽ chữ cái đầu thay thế.
function safeAvatar(u){
  try {
    const url = new URL(String(u || '').slice(0, 400));
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    const h = url.hostname.toLowerCase();
    return CONTENT.avatar.hosts.some(x => h === x || h.endsWith('.' + x)) ? url.href : '';
  } catch { return ''; }
}
function pub(v){ return { id:v.id, name:v.name, skin:v.skin, avatar:v.avatar||'', coins:v.coins, demo:!!v.demo, seat:v.seat }; }
function snapshot(){ scanPoseSkins(); return { t:'state', poseSkins: [...POSE_SKINS], poseFiles: POSE_FILES, settings, viewers:[...viewers.values()].map(pub), more: overflow.size, cap: capacity(), startedAt, ttsWarmupDone, silentUntil, tiktok: tiktokState, vieneu: { ...vieneuState, queueLen: ttsQueue.length }, overlay: overlayState, content: CLIENT_CONTENT }; }

/* ------------------------------------------- Silent mode, Altar Ceremony & Camera Zoom */
const zoomQueue = [];
let zoomNextAt = 0, zoomTimer = null;

// Lên lễ Phật (!thắp nhang, !cúng bái, !quỳ lạy): tối đa 8 người cùng lúc, mỗi người một bồ đoàn (hàng trước trước),
// hàng chờ tối đa ceremony.maxQueue, cooldown 5 phút/người (chỉ tính từ lúc người đó BẮT ĐẦU hành lễ),
// các lượt bắt đầu cách nhau tối thiểu gapSec. Chánh điện cũ (scene "old") chỉ có 1 điểm lễ (altarSpot).
// Server là nguồn thời gian duy nhất: overlay chỉ chạy theo bản tin 'ceremony', không gửi lệnh ngược.
const ceremonies = new Map();      // id -> { id, name, kind, spot, endsAt, timer }
const ceremonyQueue = [];          // [{ id, kind }]
const spotsBusy = new Set();       // chỉ số bồ đoàn đang có người
const ceremonyCooldowns = new Map();
let ceremonyGapTimer = null, ceremonyNextAt = 0;

const OLD_SPOT = () => { const a = CONTENT.layout.altarSpot; return { i: 0, row: 'front', x: a.x, y: a.y, cy: a.y, w: 0, scale: a.scale, gapX: a.x, legacy: true }; };
function getV4CeremonySpots() {
  const ce = CONTENT.layout?.v4?.ceremony;
  if (!ce || !Array.isArray(ce.rows) || !ce.rows.length) return null;
  const seatH = CONTENT.layout?.v4?.seatHeight || 115;
  const scale = seatH / 260;
  const spots = [];
  const sortedRows = [...ce.rows].sort((a, b) => b.yFoot - a.yFoot);
  const frontY = sortedRows[0].yFoot;
  for (const row of sortedRows) {
    const isFront = row.yFoot === frontY;
    const xs = [...row.xs].sort((a, b) => Math.abs(a - 540) - Math.abs(b - 540) || a - b);
    for (const x of xs) {
      spots.push({
        i: spots.length,
        row: isFront ? 'front' : 'back',
        x,
        y: row.yFoot,
        cy: row.yFoot,
        w: ce.cushion?.w || 76,
        scale,
        gapX: x,
        legacy: false,
      });
    }
  }
  return spots.length ? spots : null;
}
const spotList = () => {
  if (settings.scene === 'old') return [OLD_SPOT()];
  const v4Spots = getV4CeremonySpots();
  if (v4Spots) return v4Spots;
  return V3_SPOTS;
};
function takeSpot(){ for (const s of spotList()) if (!spotsBusy.has(s.i)) return s; return null; }

function isAtAltarSpot(id){
  return ceremonies.has(id);
}

// Giữ chỗ ngồi của người đang lên lễ (và trong hàng chờ lễ), không nhường cho người mới
function isProtectedCeremonyViewer(id){
  return isAtAltarSpot(id) || ceremonyQueue.some(q => q.id === id);
}

function stripAccents(str){
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd');
}

function parseCeremonyCommand(text){
  const norm = stripAccents(text).toLowerCase().replace(/\s+/g, ' ').trim();
  if (/(?:^|\s)!\s*thap\s*nhang(?:\b|$)/.test(norm)) return 'incense';
  if (/(?:^|\s)!\s*cung\s*bai(?:\b|$)/.test(norm)) return 'worship';
  if (/(?:^|\s)!\s*quy\s*lay(?:\b|$)/.test(norm)) return 'prostrate';
  return null;
}

// Skin có đủ bộ ảnh tư thế assets/pose_<skin>_{stand,walkL,walkR}.png thì được đứng dậy đi bộ lên bồ đoàn
const POSE_SKINS = new Set();
let POSE_FILES = [];   // các file pose_<skin>_<pose>.png có thật trong assets/ (overlay chỉ nạp đúng những file này)
function scanPoseSkins(){
  POSE_SKINS.clear();
  let files = []; try { files = fs.readdirSync(path.join(ROOT, 'assets')); } catch {}
  const SK = ['man', 'woman', 'granny', 'monk', 'nun', 'child'];
  POSE_FILES = files.filter(f => new RegExp('^pose_(' + SK.join('|') + ')_(stand|walkL|walkR|kneel|prostrate)\\.png$').test(f)).sort();
  for (const sk of SK){
    if (['stand', 'walkL', 'walkR'].every(p => files.includes(`pose_${sk}_${p}.png`))) POSE_SKINS.add(sk);
  }
}
scanPoseSkins();

// Thời gian đi bộ MỘT chiều: độ dài đường đi (cùng hàm route với overlay) / tốc độ, kẹp trong [minSec, maxSec].
function ceremonyWalkInfo(v, spot){
  const w = CONTENT.ceremony.walk;
  if (!POSE_SKINS.has(v.skin)) return null;
  const seat = V3_SEATS[v.seat];
  if (!seat) return null;
  const len = spot.legacy ? Math.abs(seat.x - 540) + Math.abs(seat.y - spot.y) + 80 : LV3.pathLen(LV3.route(V3, seat, spot));
  return { sec: Math.min(w.maxSec, Math.max(w.minSec, len / w.speedPxPerSec)), laneFrac: w.laneFrac, stepSec: w.stepSec, riseSec: w.riseSec, bobPx: w.bobPx };
}

// Tổng thời gian 1 lượt lễ (giây): không có ảnh pose = 4 lần mờ + hành lễ; có ảnh pose = đứng dậy + đi lên + hành lễ + đi về + ngồi xuống
// Quỳ + lạy bằng ảnh kneel/prostrate (chỉ !cúng bái, !quỳ lạy, skin có đi bộ và đủ 2 ảnh): các đoạn mờ chéo cũng được cộng vào tổng thời gian.
function kneelCapable(v, kind){
  return kind !== 'incense' && POSE_SKINS.has(v.skin) && POSE_FILES.includes(`pose_${v.skin}_kneel.png`) && POSE_FILES.includes(`pose_${v.skin}_prostrate.png`);
}
function computeCeremonyDurationSec(kind, walk, kneel){
  const c = CONTENT.ceremony, b = c.bow;
  const bowSec = hold => b.downSec + hold + b.upSec;
  let perform;
  if (walk && kneel){
    const n = kind === 'worship' ? 3 : 1, hold = kind === 'worship' ? b.holdSec : b.prostrateHoldSec;
    perform = kneel.downSec + n * (2 * kneel.prostrateFadeSec + hold) + (n - 1) * b.pauseSec + kneel.upSec;
  }
  else if (kind === 'incense') perform = c.incenseHoldSec + bowSec(b.holdSec);
  else if (kind === 'worship') perform = bowSec(b.holdSec) * 3 + b.pauseSec * 2;
  else perform = bowSec(b.prostrateHoldSec);
  if (walk) return 2 * walk.riseSec + 2 * walk.sec + perform + c.tailSec;
  return c.fadeSec * 4 + perform + c.tailSec;
}

function resetCeremony(){
  for (const c of ceremonies.values()) clearTimeout(c.timer);
  ceremonies.clear();
  spotsBusy.clear();
  ceremonyQueue.length = 0;
  ceremonyCooldowns.clear();
  ceremonyNextAt = 0;
  clearTimeout(ceremonyGapTimer); ceremonyGapTimer = null;
}

function startCeremony(v, kind, spot){
  // Xoá mọi mục zoom đang chờ của người này (không zoom vào người đang ở điểm lễ)
  for (let i = zoomQueue.length - 1; i >= 0; i--){
    if (zoomQueue[i].id === v.id) zoomQueue.splice(i, 1);
  }
  const c = CONTENT.ceremony;
  const walk = ceremonyWalkInfo(v, spot);
  const kneel = walk && kneelCapable(v, kind) ? c.kneel : null;
  const totalSec = computeCeremonyDurationSec(kind, walk, kneel);
  const now = Date.now();
  spotsBusy.add(spot.i);
  const run = { id: v.id, name: v.name, kind, spot: spot.i, endsAt: now + totalSec * 1000, timer: null };
  ceremonies.set(v.id, run);
  ceremonyCooldowns.set(v.id, now); // cooldown chỉ tính khi bắt đầu hành lễ
  ceremonyNextAt = now + c.gapSec * 1000;

  const labelMap = { incense: '!thắp nhang', worship: '!cúng bái', prostrate: '!quỳ lạy' };
  addLog(`🙏 Mời Phật tử ${v.name} lên lễ Phật (${labelMap[kind] || kind}) · bồ đoàn ${spot.i + 1}/${spotList().length}`);

  broadcast({
    t: 'ceremony',
    id: v.id,
    name: v.name,
    kind,
    spot: { i: spot.i, x: spot.x, y: spot.y, scale: spot.scale, row: spot.row, gapX: spot.gapX, legacy: !!spot.legacy },
    inviteText: fill(c.inviteText, { name: v.name }),
    inviteSec: c.inviteSec,
    fadeSec: c.fadeSec,
    incenseBoostSec: c.incenseBoostSec,
    incenseHoldSec: c.incenseHoldSec,
    tailSec: c.tailSec,
    bow: c.bow,
    stand: c.stand,
    walk,
    kneel,
    prostrateExtraDrop: kneel ? c.prostrateExtraDrop : undefined,
    totalSec,
  });

  run.timer = setTimeout(() => finishCeremony(v.id), Math.round(totalSec * 1000));
  run.timer.unref?.();
}

function finishCeremony(id){
  const run = ceremonies.get(id);
  if (!run) return;
  clearTimeout(run.timer);
  ceremonies.delete(id);
  spotsBusy.delete(run.spot);
  scheduleNextCeremony();
}

// Lấy người kế tiếp trong hàng chờ khi còn bồ đoàn trống; các lượt bắt đầu cách nhau tối thiểu gapSec
function scheduleNextCeremony(){
  clearTimeout(ceremonyGapTimer); ceremonyGapTimer = null;
  if (!ceremonyQueue.length || !spotList().some(s => !spotsBusy.has(s.i))) return;
  const wait = Math.max(0, ceremonyNextAt - Date.now());
  ceremonyGapTimer = setTimeout(() => {
    ceremonyGapTimer = null;
    while (ceremonyQueue.length){
      const spot = takeSpot();
      if (!spot) return;
      const next = ceremonyQueue.shift();
      const v = viewers.get(next.id);
      if (v){ startCeremony(v, next.kind, spot); break; } // người đã rời phòng thì bỏ qua, không tính cooldown
    }
    scheduleNextCeremony();
  }, wait);
  ceremonyGapTimer.unref?.();
}

function requestCeremony(id, kind, bypassUserCooldown = false){
  const v = viewers.get(id);
  if (!v || !['incense', 'worship', 'prostrate'].includes(kind)) return false;
  if (isProtectedCeremonyViewer(id)) return false;

  const now = Date.now();
  if (!bypassUserCooldown){
    const last = ceremonyCooldowns.get(id) || 0;
    if (now - last < CONTENT.ceremony.cooldownSec * 1000) return false;
  }

  const spot = !ceremonyQueue.length && now >= ceremonyNextAt ? takeSpot() : null;
  if (spot){
    startCeremony(v, kind, spot);
    return true;
  }

  if (ceremonyQueue.length >= CONTENT.ceremony.maxQueue) return false;
  ceremonyQueue.push({ id, kind });
  addLog(`🙏 ${v.name} vào hàng chờ lễ Phật (${ceremonyQueue.length}/${CONTENT.ceremony.maxQueue})`);
  scheduleNextCeremony();
  return true;
}

// Dọn bảng cooldown đã hết hạn để treo nhiều giờ không phình bộ nhớ
setInterval(() => {
  const now = Date.now(), cd = CONTENT.ceremony.cooldownSec * 1000;
  for (const [id, at] of ceremonyCooldowns) if (now - at >= cd) ceremonyCooldowns.delete(id);
  for (const [id, at] of oracleCooldown) if (now - at >= (CONTENT.oracle?.userCooldownSec || 600) * 1000) oracleCooldown.delete(id);
}, 60_000).unref?.();

function setSilentUntil(untilMs){
  clearTimeout(silentEndTimer); silentEndTimer = null;
  silentUntil = Math.max(0, Math.round(+untilMs || 0));
  if (silentUntil > Date.now()){
    resetZoom();
    silentEndTimer = setTimeout(() => {
      silentUntil = 0;
      broadcast({ t:'silent', silentUntil: 0 });
      addLog('🔔 Kết thúc 5 phút thiền im lặng');
    }, silentUntil - Date.now());
    silentEndTimer.unref?.();
  } else {
    silentUntil = 0;
  }
  broadcast({ t:'silent', silentUntil });
}

function resetZoom(){
  zoomQueue.length = 0;
  zoomNextAt = 0;
  clearTimeout(zoomTimer);
  zoomTimer = null;
}

function scheduleNextZoom(){
  clearTimeout(zoomTimer); zoomTimer = null;
  if (!zoomQueue.length) return;
  const wait = Math.max(50, zoomNextAt - Date.now());
  zoomTimer = setTimeout(pumpZoom, wait);
  zoomTimer.unref?.();
}

function fireZoom(id, reason){
  const v = viewers.get(id);
  if (!v || isProtectedCeremonyViewer(id)) return;
  const cycleMs = (CONTENT.zoom.holdSec + CONTENT.zoom.outSec + CONTENT.zoom.cooldownSec) * 1000;
  zoomNextAt = Date.now() + cycleMs;
  broadcast({
    t: 'zoom',
    id: v.id,
    name: v.name,
    reason,
    scaleFrom: CONTENT.zoom.scaleFrom,
    scaleTo: CONTENT.zoom.scaleTo,
    holdSec: CONTENT.zoom.holdSec,
    outSec: CONTENT.zoom.outSec,
  });
  if (zoomQueue.length) scheduleNextZoom();
}

function pumpZoom(){
  zoomTimer = null;
  if (!settings.zoomEnabled || Date.now() < silentUntil){ zoomQueue.length = 0; return; }
  if (Date.now() < zoomNextAt){ scheduleNextZoom(); return; }
  while (zoomQueue.length){
    const item = zoomQueue.shift();
    if (viewers.has(item.id) && !isProtectedCeremonyViewer(item.id)){
      fireZoom(item.id, item.reason);
      return;
    }
  }
}

function enqueueZoom(id, reason){
  if (!settings.zoomEnabled) return;
  if (Date.now() < silentUntil) return;              // không zoom trong 5 phút thiền im lặng
  if (!viewers.has(id) || isProtectedCeremonyViewer(id)) return; // không zoom vào người đang/đang chờ lên lễ
  const now = Date.now();
  if (now >= zoomNextAt && zoomQueue.length === 0){
    fireZoom(id, reason);
    return;
  }
  if (zoomQueue.some(q => q.id === id)) return;
  if (zoomQueue.length >= CONTENT.zoom.maxQueue) return; // xếp hàng tối đa 3, quá thì bỏ
  zoomQueue.push({ id, reason });
  scheduleNextZoom();
}

// Chỗ ngồi do server cấp (chỉ số 0…MAX_SEATS-1 theo thứ tự ưu tiên của LayoutV3.buildSeats), overlay chỉ vẽ theo chỉ số này.
// Hết chỗ: người bình luận mới thay người im lặng lâu nhất (quá limits.rotateAfterMin phút, không đang lên lễ, ưu tiên người chưa dâng quà);
// quà/follow (opts.force) thì thay người im lặng lâu nhất bất kể bao lâu. Không thay được → vào danh sách "đang thiền" (chip +N).
const seatOwner = new Array(MAX_SEATS).fill(null);
const overflow = new Map();          // id -> lastAt: người đã tương tác nhưng không có chỗ ngồi
let moreSent = 0;
function syncMore(){ if (overflow.size !== moreSent){ moreSent = overflow.size; broadcast({ t:'more', n: moreSent }); } }
function removeViewer(id){
  const v = viewers.get(id); if (!v) return;
  viewers.delete(id);
  if (v.seat != null && seatOwner[v.seat] === id) seatOwner[v.seat] = null;
  broadcast({ t:'leave', id });
}
function clearAllViewers(){ viewers.clear(); seatOwner.fill(null); overflow.clear(); moreSent = 0; }
function evictCandidate(force){
  const pool = [...viewers.values()].filter(x => !isProtectedCeremonyViewer(x.id)), oldest = l => l.reduce((b, x) => (!b || x.lastAt < b.lastAt) ? x : b, null);
  const c = oldest(pool.filter(x => x.coins === 0)) || (force ? oldest(pool) : null);
  if (!c) return null;
  if (!force && Date.now() - c.lastAt < CONTENT.limits.rotateAfterMin * 60_000) return null;
  return c;
}
function seat(id, name, opts = {}){
  let v = viewers.get(id);
  if (v){ v.lastAt = Date.now(); if (name) v.rawName = String(name).slice(0, 80); if (opts.avatar) v.avatar = safeAvatar(opts.avatar); return { v, isNew:false }; }
  let idx = seatOwner.indexOf(null);
  if (idx < 0){
    const c = evictCandidate(!!opts.force);
    if (!c){ overflow.set(id, Date.now()); syncMore(); return { v:null, isNew:false }; }
    overflow.set(c.id, c.lastAt);               // người bị thay vẫn đang xem: tính vào "đang thiền"
    removeViewer(c.id); idx = seatOwner.indexOf(null);
  }
  overflow.delete(id);
  const rawName = String(name || id).slice(0, 80);
  v = { id, rawName, name: sanitizeDisplayName(rawName), skin: opts.skin || DEFAULT_SKINS[viewers.size % DEFAULT_SKINS.length],
        avatar: safeAvatar(opts.avatar), coins: 0, joinedAt: Date.now(), lastAt: Date.now(), demo: !!opts.demo, seat: idx };
  viewers.set(id, v); seatOwner[idx] = id;
  broadcast({ t:'join', v: pub(v), cap: capacity() });
  syncMore();
  return { v, isNew:true };
}
// Dọn danh sách "đang thiền" (không chỗ ngồi): bỏ người im quá 30 phút, giữ tối đa 20000 người
setInterval(() => {
  const cut = Date.now() - 30 * 60_000;
  for (const [id, at] of overflow) if (at < cut || overflow.size > 20000) overflow.delete(id);
  syncMore();
}, 60_000).unref?.();

/* ------------------------------------------------------------- events in */
// Giới hạn bình luận: mỗi người tối đa 1 bình luận mỗi limits.chatGapSec giây (bình luận dồn dập bị bỏ); lệnh thử từ bảng điều khiển (sim_) không bị giới hạn
const chatLast = new Map();
function chatAllowed(id){
  if (String(id).startsWith('sim_')) return true;
  const now = Date.now();
  if (now - (chatLast.get(id) || 0) < CONTENT.limits.chatGapSec * 1000) return false;
  chatLast.set(id, now);
  return true;
}
setInterval(() => {
  const cut = Date.now() - Math.max(10_000, CONTENT.limits.chatGapSec * 2000);
  for (const [id, at] of chatLast) if (at < cut) chatLast.delete(id);
}, 30_000).unref?.();

function onChat(id, name, text, avatar){
  trackEvent();
  text = String(text || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 120);
  if (!text) return;
  if (!chatAllowed(id)) return;
  const want = skinFromText(text);
  const { v, isNew } = seat(id, name, { avatar, skin: want || undefined });
  if (!v) return;
  if (!isNew && want && want !== v.skin){ v.skin = want; broadcast({ t:'skin', id, skin: want }); }

  const ceremonyKind = parseCeremonyCommand(text);
  const askOracle = !ceremonyKind && isOracleRequest(text);
  if (!ceremonyKind && !askOracle && !want){
    v.lastText = text;
    v.lastTextAt = Date.now();
  }
  broadcast({ t:'chat', id, name: v.name, text });
  if (ceremonyKind){
    requestCeremony(v.id, ceremonyKind, false);
  } else if (askOracle){
    triggerOracle(v.id, v.name, v.avatar, String(id).startsWith('sim_'));
  }
}

// Gom combo quà trước khi đọc: cùng người + cùng quà liên tiếp trong limits.giftComboMs thì đọc MỘT câu với tổng số lượng (tối đa giftComboMaxMs).
// Hàng đợi giọng đọc đang bận (≥ tts.busyQueueLen câu): quà dưới tts.minGiftWhenBusy xu không đọc tên, chỉ phát câu chung đã lưu sẵn (tối đa 1 câu chờ).
const giftCombos = new Map();
function queueGiftTts(v, gift, count, coins, prayer){
  const L = CONTENT.limits, key = v.id + '|' + gift, now = Date.now();
  let c = giftCombos.get(key);
  if (!c){ c = { id: v.id, gift, count: 0, coins: 0, first: now, timer: null }; giftCombos.set(key, c); }
  c.count += count; c.coins += coins; c.prayer = prayer; c.name = v.rawName || v.name;
  clearTimeout(c.timer);
  c.timer = setTimeout(() => { giftCombos.delete(key); try { sayGiftCombo(c); } catch (e) { addLog('Đọc quà lỗi: ' + String(e?.message || e).slice(0, 160)); } },
    Math.max(50, Math.min(L.giftComboMs, c.first + L.giftComboMaxMs - now)));
  c.timer.unref?.();
}
function sayGiftCombo(c){
  const v = viewers.get(c.id), big = c.coins >= 99;
  if (ttsQueue.length >= CONTENT.tts.busyQueueLen && c.coins < CONTENT.tts.minGiftWhenBusy){
    if (ttsQueue.some(q => q.meta?.generic)) return;                // đã có một câu chung đang chờ, không chất thêm
    say(getFallbackTextWithoutName({ tag: 'gift' }), { tag: 'gift', fixed: true, generic: true, small: true, names: [] }, 2);
    return;
  }
  const spokenName = spoken(c.name || v?.name);
  const giftTpl = big ? (CONTENT.gift.bigLine || CONTENT.gift.line) : (CONTENT.gift.smallLine || CONTENT.gift.line);
  const line = fill(giftTpl, { name: spokenName, gift: c.gift, count: c.count, total: v ? v.coins : c.coins, prayer: c.prayer,
    times: c.count > 1 ? fill(CONTENT.gift.timesSpoken, { count: c.count }) : '' });
  say(line, { tag: 'gift', small: !big, names: [spokenName] }, big ? 4 : 2);
}

function onGift(id, name, giftName, count, diamonds, avatar){
  trackEvent();
  const cleanGift = sanitizeGiftName(giftName);
  count = Math.max(1, Math.min(9999, +count || 1));
  const { v } = seat(id, name, { avatar, force: true });
  if (!v) return;
  const coins = Math.max(1, (diamonds || 1) * (count || 1));
  v.coins += coins;

  const hasCustomPrayer = v.lastText && (Date.now() - v.lastTextAt < 90_000) && v.lastText.length > 6 && !isOracleRequest(v.lastText);
  const prayer = hasCustomPrayer ? v.lastText : (CONTENT.gift.defaultPrayer || 'Nguyện cầu bình an, phước báu vô lượng');
  const tier = coins >= 99 ? 3 : coins >= 20 ? 2 : 1;
  const highGift = isHighTierGift(cleanGift, coins, tier);
  const scrollMerit = tier >= 3;               // quà ≥ 99 xu: chỉ hiện Sổ Vàng; quà nhỏ: chỉ khung #gift

  broadcast({
    t: 'gift',
    id,
    name: v.name,
    giftName: cleanGift,
    count,
    coins,
    total: v.coins,
    tier,
    prayer,
    incenseBoost: highGift,
    scrollMerit,
  });

  if (coins >= CONTENT.zoom.minCoins){
    enqueueZoom(v.id, 'gift');
  }

  if (settings.gifts.readAll || coins >= settings.gifts.minDiamonds){
    queueGiftTts(v, cleanGift, count, coins, prayer);
  }
}

let lastMemberTtsAt = 0;
function onMember(id, name, avatar){
  if (!settings.joinOnEnter) return;
  const { v, isNew } = seat(id, name, { avatar });
  if (!v || !isNew) return;
  if (settings.readMemberJoin && ttsQueue.length < 3 && Date.now() - lastMemberTtsAt > 12_000){
    lastMemberTtsAt = Date.now();
    const spokenName = spoken(v.rawName || name || v.name);
    const line = fill(CONTENT.member.line, { name: spokenName });
    say(line, { tag: 'member' }, 0);
  }
}

/* follow / share / mốc tim. "Buổi" = từ lúc chạy server đến lúc kết nối sang phòng khác. */
const followed = new Set(); const FOLLOWED_MAX = 5000; let likeTotal = 0, mileDone = null;   // followed có trần: đầy thì bỏ người cũ nhất
function resetSession(){ followed.clear(); likeTotal = 0; mileDone = null; resetZoom(); resetCeremony(); }
function onFollow(id, name, avatar){
  id = String(id || '').slice(0, 64); if (!id) return;
  if (followed.has(id)) return;
  if (followed.size >= FOLLOWED_MAX) followed.delete(followed.values().next().value);
  followed.add(id);
  const { v } = seat(id, name, { avatar, force: true });
  const who = v ? v.name : sanitizeDisplayName(name);
  broadcast({ t:'follow', id, name: who });
  if (v && CONTENT.zoom.onFollow) enqueueZoom(v.id, 'follow');
  say(fill(CONTENT.follow.line, { name: spoken(v?.rawName || name || who) }), { tag:'follow' }, 3);
}
function onShare(name){
  const who = sanitizeDisplayName(name);
  broadcast({ t:'share', name: who });
}
function onLikes(id, n, total){
  trackEvent();
  n = Math.max(1, Math.min(100000, +n || 1));
  broadcast({ t:'like', id, n });
  const before = likeTotal;
  likeTotal = (Number.isFinite(total) && total > likeTotal) ? total : likeTotal + n;
  const every = CONTENT.milestone.every, m = Math.floor(likeTotal / every);
  if (mileDone === null) mileDone = Math.floor(Math.max(0, Math.min(before, likeTotal - n)) / every);
  if (m > mileDone){
    mileDone = m; const count = m * every;
    broadcast({ t:'milestone', n: count });
    say(fill(CONTENT.milestone.line, { n: count }), { tag:'milestone' }, 3);
  }
}

/* ------------------------------------------------------------------ TTS Queue, VieNeu Sidecar & Disk Cache */
const VIENEU_PORT = process.env.VIENEU_PORT || '8765';
const VIENEU_BASE = (process.env.VIENEU_URL || `http://127.0.0.1:${VIENEU_PORT}`).replace(/\/+$/, '');

let ttsWarmupDone = false;
let isWarmingUp = false;

async function warmupTTS() {
  if (isWarmingUp || ttsWarmupDone) return;
  isWarmingUp = true;
  const pollHealthMax = 180_000;
  const t0 = Date.now();
  let device = 'unknown';
  let healthOk = false;

  addLog('🎙️ Đang đợi VieNeu TTS sidecar sẵn sàng (poll /health mỗi 2s, tối đa 180s)...');

  // Bước 1: Trước tiên chỉ poll GET /health mỗi 2 s (timeout 2 s) tới khi ok:true, tối đa 180 s
  while (Date.now() - t0 < pollHealthMax) {
    try {
      const res = await fetch(`${VIENEU_BASE}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) {
          healthOk = true;
          device = String(data.device || 'cpu').toLowerCase();
          vieneuState = {
            online: true,
            device,
            voice: String(data.voice || CONTENT.tts?.vieneuVoice || 'Thiền Tâm Đức'),
            url: VIENEU_BASE,
          };
          broadcast({ t: 'vieneu', ...vieneuState, queueLen: ttsQueue.length }, 'control');
          const elapsed = Date.now() - startedAt;
          recordStartupMilestone('sidecar health ok', elapsed, `(${device})`);
          addLog(`🎙️ VieNeu sidecar health OK (${device.toUpperCase()}) sau ${Date.now() - t0}ms`);
          break;
        }
      }
    } catch {}
    await sleep(2000);
  }

  if (!healthOk) {
    addLog('⚠️ VieNeu TTS sidecar quá hạn 180s kiểm tra health (offline/chưa khởi động), KHÔNG gửi thêm request');
    recordStartupMilestone('sidecar health ok', 180_000, '(quá hạn 180s, offline)');
    ttsWarmupDone = true;
    isWarmingUp = false;
    broadcast({ t: 'warmup_done', ok: false, ms: 180_000 });
    return;
  }

  // Bước 2: Sau đó gửi ĐÚNG 1 request POST /tts warm-up, timeout 60 s. Không lặp lại khi đang có request warm-up chưa xong.
  addLog(`🎙️ Gửi đúng 1 request POST /tts warm-up (${device.toUpperCase()}, timeout 60s)...`);
  const tWarmupStart = Date.now();
  try {
    const res = await fetch(`${VIENEU_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Nam Mô A Di Đà Phật',
        voice: CONTENT.tts?.vieneuVoice || 'Thiền Tâm Đức',
        speed: 0.9,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const buf = await res.arrayBuffer();
      if (buf && buf.byteLength > 0) {
        const elapsed = Date.now() - startedAt;
        const dur = Date.now() - tWarmupStart;
        recordStartupMilestone('sidecar warm-up xong', elapsed, `(${device}, ${dur}ms)`);
        ttsWarmupDone = true;
        isWarmingUp = false;
        broadcast({ t: 'warmup_done', ok: true, ms: elapsed });
        addLog(`🎙️ VieNeu TTS warm-up xong sau ${dur}ms (${device.toUpperCase()}, không phát tiếng)`);
        return;
      } else {
        throw new Error('Dữ liệu âm thanh trả về rỗng');
      }
    } else {
      const errText = await res.text().catch(() => '');
      throw new Error(`VieNeu HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    addLog(`⚠️ VieNeu TTS warm-up thất bại: ${err?.message || err}`);
    recordStartupMilestone('sidecar warm-up xong', elapsed, `(thất bại: ${err?.message || err}, ${device})`);
    ttsWarmupDone = true;
    isWarmingUp = false;
    broadcast({ t: 'warmup_done', ok: false, ms: elapsed });
  }
}

let vieneuState = {
  online: false,
  device: 'unknown',
  voice: '',
  url: VIENEU_BASE,
};

async function checkVieNeuHealth() {
  try {
    const res = await fetch(`${VIENEU_BASE}/health`, { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      const wasOnline = vieneuState.online;
      vieneuState = {
        online: true,
        device: String(data.device || 'cpu'),
        voice: String(data.voice || CONTENT.tts?.vieneuVoice || 'Thiền Tâm Đức'),
        url: VIENEU_BASE,
      };
      if (!wasOnline) {
        addLog(`🎙️ VieNeu TTS Sidecar kết nối thành công (${vieneuState.device.toUpperCase()} · ${vieneuState.voice})`);
      }
      broadcast({ t: 'vieneu', ...vieneuState, queueLen: ttsQueue.length }, 'control');
      return true;
    }
  } catch {}
  const wasOnline = vieneuState.online;
  vieneuState = {
    online: false,
    device: 'unknown',
    voice: '',
    url: VIENEU_BASE,
  };
  if (wasOnline) {
    addLog(`⚠️ VieNeu TTS Sidecar mất kết nối (${VIENEU_BASE})`);
  }
  broadcast({ t: 'vieneu', ...vieneuState, queueLen: ttsQueue.length }, 'control');
  return false;
}
setInterval(checkVieNeuHealth, 8000);
setTimeout(checkVieNeuHealth, 1000);

const ttsQueue = []; let ttsBusy = false, ttsSeq = 0, lastTtsEndTime = 0, ttsFailCount = 0;
const TTS_FAIL_DELAYS = [5000, 10000, 30000];
const MAX_Q = 8, MERGE_OVER = 5;

function esc(s){ return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }

// Khóa lưu đĩa cho các câu cố định (pháp ngữ, kinh, lời chào): key = hash(text+voice)
function getTtsCacheKey(text, voice) {
  const normText = String(text || '').trim().replace(/\s+/g, ' ');
  const v = voice || CONTENT.tts?.vieneuVoice || settings.voice || 'Thiền Tâm Đức';
  return crypto.createHash('sha1').update(`${normText}|${v}`).digest('hex').slice(0, 16);
}

function getCachedTtsFile(text, voice) {
  const key = getTtsCacheKey(text, voice);
  for (const ext of ['mp3', 'wav']) {
    const fileName = `cache_${key}.${ext}`;
    const filePath = path.join(TTS_DIR, fileName);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      try {
        const now = new Date();
        fs.utimesSync(filePath, now, now);
      } catch {}
      return { fileName, filePath, ext };
    }
  }
  return null;
}

function saveCachedTtsFile(text, buf, ext = 'mp3', voice) {
  try {
    const key = getTtsCacheKey(text, voice);
    const fileName = `cache_${key}.${ext}`;
    const filePath = path.join(TTS_DIR, fileName);
    fs.writeFileSync(filePath, buf);
    return fileName;
  } catch (e) {
    console.error('Lỗi ghi cache TTS:', e?.message);
    return null;
  }
}

function getFallbackTextWithoutName(meta) {
  const tag = meta?.tag || '';
  if (tag === 'gift') return 'Tùy hỷ công đức Phật tử đã cúng dường.';
  if (tag === 'follow') return 'Tùy hỷ Phật tử đã kết duyên lành.';
  if (tag === 'oracle') return 'Pháp ngữ hôm nay gửi đến Phật tử.';
  if (tag === 'member') return 'Chào mừng Phật tử đã đến chánh điện.';
  return 'Nam Mô A Di Đà Phật.';
}

function getCachedFallbackWithoutName(meta) {
  const fbText = getFallbackTextWithoutName(meta);
  const cached = getCachedTtsFile(fbText);
  if (cached) return { ...cached, text: fbText };
  return null;
}

// Thang ưu tiên: 5 say thủ công > 4 quà lớn (≥99 xu) > 3 follow / mốc tim > 2 quà nhỏ (<99 xu) > 1 oracle > 0 tụng kinh / member.
// Khi đầy (max 8): bỏ câu cũ nhất trong nhóm ưu tiên thấp nhất.
function say(text, meta = {}, prio = 1){
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!cleanText) return;
  const item = { text: cleanText, meta, prio, at: Date.now() };

  if (ttsQueue.length >= MAX_Q){
    const minPrio = Math.min(...ttsQueue.map(q => q.prio));
    if (prio < minPrio){
      addLog(`Hàng đợi giọng đọc đầy (8/8), bỏ qua câu mới do ưu tiên thấp hơn (${meta.tag || 'tts'})`);
      return;
    }
    let oldestIdx = -1, oldestTime = Infinity;
    for (let i = 0; i < ttsQueue.length; i++){
      if (ttsQueue[i].prio === minPrio && ttsQueue[i].at < oldestTime){
        oldestTime = ttsQueue[i].at;
        oldestIdx = i;
      }
    }
    if (oldestIdx >= 0){
      const dropped = ttsQueue.splice(oldestIdx, 1)[0];
      addLog(`Hàng đợi giọng đọc đầy (8/8), bỏ câu cũ nhất ưu tiên thấp (${dropped.meta?.tag || 'tts'}, prio ${minPrio})`);
    }
  }

  let at = ttsQueue.length;
  while (at > 0 && ttsQueue[at - 1].prio < prio) at--;
  ttsQueue.splice(at, 0, item);
  if (ttsQueue.length > MERGE_OVER) mergeSmallGifts();
  pumpTTS();
}

function mergeSmallGifts(){
  const idx = ttsQueue.map((q, i) => q.meta.small && !q.meta.generic ? i : -1).filter(i => i >= 0);
  if (idx.length < 2) return;
  const names = [...new Set(idx.flatMap(i => ttsQueue[i].meta.names || []))];
  const shown = names.slice(0, 3).join(', '), more = names.length - 3;
  const text = more > 0 ? fill(CONTENT.gift.merged, { names: shown, more }) : fill(CONTENT.gift.mergedAll, { names: shown });
  const merged = { text: text.slice(0, 500), meta: { tag: 'gift', small: true, names }, prio: 1 };
  const first = idx[0];
  for (let k = idx.length - 1; k >= 0; k--) ttsQueue.splice(idx[k], 1);
  ttsQueue.splice(first, 0, merged);
  addLog(`Gộp ${idx.length} câu quà nhỏ thành 1 (${names.length} người)`);
}

// 1. Backend VieNeu: timeout 30s cho 3 câu đầu sau khởi động, sau đó 15s
let vieneuSentCount = 0;
async function synthesizeViaVieNeu(text){
  const clean = String(text || '').slice(0, 300).trim();
  const timeoutMs = (vieneuSentCount < 3) ? 30_000 : 15_000;
  vieneuSentCount++;

  let res;
  try {
    res = await fetch(`${VIENEU_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        voice: CONTENT.tts?.vieneuVoice || 'Thiền Tâm Đức',
        speed: CONTENT.tts?.vieneuSpeed || 0.9,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = `VieNeu TTS lỗi mạng/timeout (${timeoutMs / 1000}s): ${err?.message || err}`;
    console.error(`[VieNeu] ${reason}`);
    addLog(`⚠️ ${reason}`);
    throw err;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const reason = `VieNeu HTTP ${res.status}: ${errText.slice(0, 200)}`;
    console.error(`[VieNeu] ${reason}`);
    addLog(`⚠️ ${reason}`);
    throw new Error(reason);
  }

  const ct = res.headers.get('content-type') || '';
  const ext = ct.includes('wav') ? 'wav' : 'mp3';
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) {
    const reason = 'VieNeu không trả về dữ liệu âm thanh';
    console.error(`[VieNeu] ${reason}`);
    addLog(`⚠️ ${reason}`);
    throw new Error(reason);
  }
  return { buf, ext };
}

// 2. Backend Edge: tạo giọng qua Edge TTS
const TTS_TIMEOUT_MS = 20_000;
function synthesizeOnceEdge(text){
  return new Promise((resolve, reject) => {
    let tts = null, done = false, timer = null;
    const finish = (err, buf) => {
      if (done) return; done = true; clearTimeout(timer);
      try { tts?.close(); } catch {}
      if (err) reject(err); else if (!buf?.length) reject(new Error('Edge TTS không trả về âm thanh')); else resolve(buf);
    };
    timer = setTimeout(() => finish(new Error(`Hết thời gian chờ Edge TTS (${TTS_TIMEOUT_MS / 1000} giây)`)), TTS_TIMEOUT_MS);
    (async () => {
      tts = new MsEdgeTTS();
      await tts.setMetadata(settings.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(esc(text), {
        pitch: `${settings.pitch >= 0 ? '+' : ''}${settings.pitch}Hz`,
        rate: `${settings.rate >= 0 ? '+' : ''}${settings.rate}%`,
      });
      const chunks = [];
      audioStream.on('data', c => chunks.push(c));
      audioStream.on('close', () => finish(null, Buffer.concat(chunks)));
      audioStream.on('error', e => finish(e instanceof Error ? e : new Error(String(e))));
    })().catch(e => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function explainTTSError(e){
  const msg = String(e?.message || e);
  if (/Hết thời gian/i.test(msg)) return 'Dịch vụ giọng đọc phản hồi quá chậm (hết thời gian chờ).';
  if (/Stream closed|turn\.end|truncated/i.test(msg)) return 'Dịch vụ giọng đọc ngắt kết nối giữa chừng.';
  if (/ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|network|socket|getaddrinfo/i.test(msg)) return 'Không kết nối được dịch vụ TTS, kiểm tra mạng hoặc sidecar.';
  if (/không trả về âm thanh/i.test(msg)) return 'Dịch vụ TTS không trả về âm thanh.';
  return msg.replace(/\s+/g, ' ').slice(0, 200);
}

let edgeChain = Promise.resolve();
function synthesizeViaEdge(text){
  const run = async () => {
    try { return await synthesizeOnceEdge(text); }
    catch (e1) { addLog('Edge TTS lỗi, thử lại 1 lần: ' + explainTTSError(e1)); await sleep(600); return await synthesizeOnceEdge(text); }
  };
  const p = edgeChain.then(run, run);
  edgeChain = p.catch(() => {});
  return p;
}

function reportTTSFail(e, what){
  const reason = explainTTSError(e);
  addLog(`${what}: ${reason}`);
  try { broadcast({ t: 'tts_error', reason }, 'control'); } catch {}
  return reason;
}

// Giới hạn dung lượng thư mục live/tts/ theo LRU (mặc định 200MB, cấu hình qua content.json tts.cacheMaxMB)
function pruneTtsFiles(){
  const maxBytes = (CONTENT.tts?.cacheMaxMB || 200) * 1024 * 1024;
  try {
    const fileEntries = fs.readdirSync(TTS_DIR).map(name => {
      const filePath = path.join(TTS_DIR, name);
      try {
        const st = fs.statSync(filePath);
        return { name, filePath, size: st.size, atimeMs: st.atimeMs || st.mtimeMs };
      } catch {
        return null;
      }
    }).filter(Boolean);

    let totalBytes = fileEntries.reduce((s, f) => s + f.size, 0);
    if (totalBytes <= maxBytes) return;

    // Sắp xếp theo LRU: xóa file ít được dùng nhất trước (atimeMs nhỏ nhất).
    // Ưu tiên xóa file tạm (không bắt đầu bằng cache_) trước, sau đó mới đến file cache_
    fileEntries.sort((a, b) => {
      const aTemp = !a.name.startsWith('cache_');
      const bTemp = !b.name.startsWith('cache_');
      if (aTemp !== bTemp) return aTemp ? -1 : 1;
      return a.atimeMs - b.atimeMs;
    });

    for (const f of fileEntries) {
      if (totalBytes <= maxBytes) break;
      try {
        fs.unlinkSync(f.filePath);
        totalBytes -= f.size;
      } catch {}
    }
  } catch (e) {
    console.error('Lỗi dọn dẹp cache TTS LRU:', e?.message);
  }
}

// Tổng hợp giọng đọc theo thứ tự tts.order: vieneu -> edge -> cached (với fallback không tên)
async function synthesizeForQueue(text, meta){
  const order = CONTENT.tts?.order || ['vieneu', 'cached'];
  let lastError = null;
  if (meta?.fixed){                                  // câu cố định (kinh, câu chung): đã có trên đĩa thì phát luôn, không tạo lại
    const hit = getCachedTtsFile(text);
    if (hit) return { file: hit.fileName, backend: 'cached' };
  }

  for (const backend of order){
    if (backend === 'vieneu'){
      try {
        const t0 = performance.now();
        const res = await synthesizeViaVieNeu(text);
        const ms = Math.round(performance.now() - t0);
        addLog(`🎙️ VieNeu tổng hợp thành công (${ms}ms): "${text.slice(0, 30)}…"`);
        return { buf: res.buf, ext: res.ext, backend: 'vieneu', durationMs: ms };
      } catch (e) {
        lastError = e;
      }
    } else if (backend === 'edge'){
      try {
        const buf = await synthesizeViaEdge(text);
        return { buf, ext: 'mp3', backend: 'edge' };
      } catch (e) {
        lastError = e;
      }
    } else if (backend === 'cached'){
      const exact = getCachedTtsFile(text);
      if (exact) return { file: exact.fileName, backend: 'cached' };
      const fb = getCachedFallbackWithoutName(meta);
      if (fb) {
        addLog(`Dùng giọng lưu sẵn không tên cho [${meta?.tag || 'tts'}]: "${fb.text}"`);
        return { file: fb.fileName, backend: 'cached_fallback' };
      }
    }
  }

  // Thử disk cache lần cuối nếu cả vieneu và edge đều lỗi
  const exact = getCachedTtsFile(text);
  if (exact) return { file: exact.fileName, backend: 'cached' };
  const fb = getCachedFallbackWithoutName(meta);
  if (fb) {
    addLog(`Dùng giọng lưu sẵn không tên dự phòng cho [${meta?.tag || 'tts'}]: "${fb.text}"`);
    return { file: fb.fileName, backend: 'cached_fallback' };
  }

  throw (lastError || new Error('Không tạo được giọng đọc từ các backend trong cấu hình'));
}

async function pumpTTS(){
  if (ttsBusy || !ttsQueue.length) return;
  ttsBusy = true;

  const minGap = CONTENT.tts?.minGapMs || 2000;
  const backoff = ttsFailCount > 0 ? TTS_FAIL_DELAYS[Math.min(ttsFailCount - 1, TTS_FAIL_DELAYS.length - 1)] : 0;
  const waitMs = Math.max(minGap, backoff);
  const elapsed = Date.now() - lastTtsEndTime;
  if (elapsed < waitMs) {
    ttsBusy = false;
    setTimeout(pumpTTS, waitMs - elapsed);
    return;
  }

  const { text, meta } = ttsQueue.shift();
  broadcast({ t: 'tts_queue', queueLen: ttsQueue.length }, 'control');
  try {
    const res = await synthesizeForQueue(text, meta);
    let file = '';
    if (res.file) {
      file = res.file;
    } else if (res.buf) {
      const isFixed = meta.fixed || meta.tag === 'chant' || (CONTENT.chants && CONTENT.chants.includes(text));
      if (isFixed) {
        file = saveCachedTtsFile(text, res.buf, res.ext) || `tts_${Date.now()}_${++ttsSeq}.${res.ext}`;
      } else {
        file = `tts_${Date.now()}_${++ttsSeq}.${res.ext}`;
        fs.writeFileSync(path.join(TTS_DIR, file), res.buf);
      }
      pruneTtsFiles();
    }
    ttsFailCount = 0; // reset on success
    lastTtsEndTime = Date.now();
    broadcast({ t: 'tts', url: `/live/tts/${file}`, text, tag: meta.tag });
  } catch (e) {
    ttsFailCount++;
    lastTtsEndTime = Date.now();
    reportTTSFail(e, `Không tạo được giọng đọc (lỗi lần ${ttsFailCount}), bỏ câu này`);
  }
  ttsBusy = false;
  setTimeout(pumpTTS, 100);
}

// Nghe thử giọng VieNeu trực tiếp từ bảng điều khiển
async function previewVieNeuTTS(ws){
  const sampleText = 'Tùy hỷ Phật tử Hải Đăng, Ngọc Hữu đã dâng hoa sen.';
  try {
    const res = await synthesizeViaVieNeu(sampleText);
    const file = `tts_preview_vieneu_${Date.now()}_${++ttsSeq}.${res.ext}`;
    fs.writeFileSync(path.join(TTS_DIR, file), res.buf);
    pruneTtsFiles();
    if (ws && ws.readyState === 1){
      ws.send(JSON.stringify({ t: 'preview_vieneu', url: `/live/tts/${file}`, text: sampleText }));
    }
  } catch (e) {
    const reason = reportTTSFail(e, 'Nghe thử VieNeu lỗi');
    if (ws && ws.readyState === 1){
      ws.send(JSON.stringify({ t: 'preview_vieneu', error: reason, text: sampleText }));
    }
  }
}

// Tạo file nghe thử cách đọc tên khó riêng trên bảng điều khiển
async function previewNameTTS(rawName, ws){
  const raw = String(rawName || '').slice(0, 80);
  const spokenName = spoken(raw);
  const giftName = sanitizeGiftName(CONTENT.labels.defaultGift || 'Hoa Sen');
  const prayer = CONTENT.gift.defaultPrayer || CONTENT.prayers[0] || '';
  const text = fill(CONTENT.gift.line, {
    name: spokenName,
    gift: giftName,
    count: 1,
    total: 1,
    prayer,
    times: '',
  }).slice(0, 300);
  try {
    const res = await synthesizeForQueue(text, { tag: 'gift' });
    let file = res.file;
    if (!file && res.buf) {
      file = `tts_preview_${Date.now()}_${++ttsSeq}.${res.ext || 'mp3'}`;
      fs.writeFileSync(path.join(TTS_DIR, file), res.buf);
      pruneTtsFiles();
    }
    if (ws && ws.readyState === 1){
      ws.send(JSON.stringify({ t: 'preview_tts', url: `/live/tts/${file}`, rawName: raw, spokenName, text }));
    }
  } catch (e) {
    const reason = reportTTSFail(e, 'Nghe thử lỗi');
    if (ws && ws.readyState === 1){
      ws.send(JSON.stringify({ t: 'preview_tts', error: reason, rawName: raw, spokenName, text }));
    }
  }
}

// Các câu cố định được lưu đĩa (kinh, lời nguyện, pháp ngữ, câu chung không tên). Chỉ những file cache_* ứng với các câu này (theo giọng hiện hành) được giữ.
function fixedTtsTexts(){
  return [
    ...(CONTENT.chants || []),
    ...(CONTENT.prayers || []),
    ...((CONTENT.oracles || []).map(o => o.teaching || o.verse).filter(Boolean)),
    'Tùy hỷ công đức Phật tử đã cúng dường.',
    'Tùy hỷ Phật tử đã kết duyên lành.',
    'Pháp ngữ hôm nay gửi đến Phật tử.',
    'Chào mừng Phật tử đã đến chánh điện.',
    'Nam Mô A Di Đà Phật.',
  ].filter(Boolean);
}
// Xoá file cache_* cũ không còn khớp câu cố định nào (đổi nội dung kinh/lời nguyện hoặc đổi giọng). Chạy lúc khởi động; trả về số file đã xoá.
function pruneStaleTtsCache(){
  const keep = new Set(fixedTtsTexts().map(t => getTtsCacheKey(t)));
  let removed = 0;
  try {
    for (const f of fs.readdirSync(TTS_DIR)){
      const m = /^cache_([0-9a-f]{16})\.(mp3|wav)$/.exec(f);
      if (m && !keep.has(m[1])){ try { fs.unlinkSync(path.join(TTS_DIR, f)); removed++; } catch {} }
    }
  } catch {}
  return removed;
}
{ const n = pruneStaleTtsCache(); if (n) console.log(`Đã xoá ${n} file cache giọng đọc cũ không còn khớp câu cố định nào`); }

async function pregenerateFixedTts(){
  const fixed = fixedTtsTexts();

  for (const text of fixed){
    const cached = getCachedTtsFile(text);
    if (!cached){
      try {
        let buf = null, ext = 'mp3';
        const order = CONTENT.tts?.order || ['vieneu', 'edge'];
        for (const engine of order){
          if (engine === 'vieneu'){
            try {
              const res = await synthesizeViaVieNeu(text);
              buf = res.buf; ext = res.ext; break;
            } catch {}
          } else if (engine === 'edge'){
            try {
              buf = await synthesizeViaEdge(text);
              ext = 'mp3'; break;
            } catch {}
          }
        }
        if (buf) {
          saveCachedTtsFile(text, buf, ext);
          addLog(`🎙️ Đã lưu đĩa câu cố định: "${text.slice(0, 30)}…"`);
        }
      } catch (e) {
        // bỏ qua lỗi nếu không nối được lúc khởi động
      }
      await sleep(2500);
    }
  }
}
setTimeout(pregenerateFixedTts, 3000);

let chantIdx = 0, chantTimer = null;
function chant(){ const text = CONTENT.chants[chantIdx++ % CONTENT.chants.length]; broadcast({ t:'chant', text }); say(text, { tag:'chant', fixed: true }, 0); }
function scheduleChant(){ clearInterval(chantTimer); if (settings.autoChant) chantTimer = setInterval(chant, Math.max(1, settings.chantEveryMin) * 60_000); }
scheduleChant();



/* --------------------------------------------------------------- TikTok */
let TikTokLib = null;
// Dịch lỗi của thư viện/EulerStream ra nguyên nhân dễ hiểu cho bảng điều khiển (không bao giờ chứa key).
function explainTikTokError(e, step, hasKey){
  const name = e?.constructor?.name || e?.name || '', msg = String(e?.message || e);
  if (name === 'UserOfflineError' || /isn't online|not online/i.test(msg)) return 'Kênh chưa bật LIVE (hoặc phòng đã kết thúc).';
  if (/Business plan/i.test(msg)) return `Bước "${step}" cần gói EulerStream Business, gói Community không dùng được bước này.`;
  if (name === 'SignatureRateLimitError' || /rate.?limit|too many|\b429\b/i.test(msg)) {
    const wait = Number.isFinite(+e?.retryAfter) && +e.retryAfter > 0 ? ` Thử lại sau khoảng ${Math.ceil(+e.retryAfter)} giây.` : '';
    return `Hết lượt hoặc quá tần suất của EulerStream (giới hạn gói).${wait}${hasKey ? '' : ' Thêm EULER_API_KEY vào live/.env để có hạn mức riêng.'}`;
  }
  if (name === 'PremiumFeatureError' || /premium|\b402\b|payment|upgrade/i.test(msg)) return `Bước "${step}" cần gói EulerStream trả phí (vượt giới hạn gói hiện tại).`;
  if (/\b401\b|\b403\b|unauthor|forbidden|invalid.*key|api key/i.test(msg)) return hasKey ? 'EulerStream từ chối API key (sai key, hết hạn hoặc không đủ quyền).' : 'Thiếu EULER_API_KEY: tạo live/.env với dòng EULER_API_KEY=... rồi chạy lại server.';
  if (/Failed to retrieve Room ID|Room ID/i.test(msg)) return 'Không tra được phòng: sai username, kênh không live, hoặc TikTok chặn tạm thời.';
  return msg.slice(0, 300);
}
/* Tự nối lại: người dùng bấm "Kết nối" thì ttDesired = username và server giữ kết nối đó; mất kết nối hoặc lần nối thất bại (kể cả lần đầu)
   thì thử lại với thời gian chờ tăng dần 5→10→20→40→60 giây (giữ ở 60). Bấm "Ngắt" thì dừng hẳn. ttGen đánh số lần nối để bỏ kết quả của lần đã bị thay thế/ngắt. */
let ttDesired = null, ttGen = 0, ttAttempt = 0, ttUnknownAttempt = 0, ttRetryTimer = null;
const TT_BACKOFF_SEC = [5, 10, 20, 40, 60];
function scheduleTikTokReconnect(uniqueId, gen, extra = {}, delaySec = null){
  if (gen !== ttGen || ttDesired !== uniqueId) return;
  clearTimeout(ttRetryTimer);
  ttAttempt++;
  const sec = delaySec != null ? delaySec : TT_BACKOFF_SEC[Math.min(ttAttempt - 1, TT_BACKOFF_SEC.length - 1)];
  tiktokState = { ...extra, status: 'reconnecting', uniqueId, attempt: ttAttempt, retryAt: Date.now() + sec * 1000 };
  broadcast({ t:'tiktok', ...tiktokState });
  const retryLabel = extra.unknownAttempt ? ` (lỗi lạ lần ${extra.unknownAttempt}/5)` : '';
  addLog(`🔁 TikTok: nối lại lần ${ttAttempt}${retryLabel} sau ${sec} giây`);
  ttRetryTimer = setTimeout(() => { ttRetryTimer = null; bg('Nối lại TikTok lỗi', connectTikTok(uniqueId, { auto: true })); }, sec * 1000);
}
async function teardownTikTok(){
  if (!tiktok) return;
  const c = tiktok; tiktok = null;
  try { c.removeAllListeners?.(); } catch {}
  try { await c.disconnect(); } catch {}
}
// Phân loại lỗi TikTok:
// - 'fatal': Auth/key/quota/rate-limit error: dừng ngay lập tức, không thử lại
// - 'network': mất mạng hoặc kênh chưa live: thử lại theo backoff (5→60s)
// - 'unknown': lỗi lạ khác: thử lại tối đa 5 lần cách nhau 60s; nếu vẫn thất bại thì dừng hẳn
function categorizeTikTokError(e){
  const name = e?.constructor?.name || e?.name || '', msg = String(e?.message || e);
  if (name === 'SignatureRateLimitError' || name === 'PremiumFeatureError') return 'fatal';
  if (/rate.?limit|too many|\b429\b|quota|premium|\b402\b|payment|upgrade|Business plan|\b401\b|\b403\b|unauthor|forbidden|invalid.*key|api key/i.test(msg)) {
    return 'fatal';
  }
  if (name === 'UserOfflineError' || /isn't online|not online/i.test(msg)) return 'network';
  if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|network|socket|fetch failed|getaddrinfo|timed? ?out/i.test(msg)) return 'network';
  if (/Failed to retrieve Room ID|Room ID/i.test(msg)) return 'network';
  return 'unknown';
}
async function connectTikTok(uniqueId, opts = {}){
  uniqueId = String(uniqueId || '').trim().replace(/^.*tiktok\.com\/@?/i, '').replace(/^@/, '').replace(/\/.*$/, '');
  if (!uniqueId) return;
  if (opts.auto){ if (ttDesired !== uniqueId) return; }          // lần tự nối lại: chỉ chạy khi người dùng vẫn muốn kết nối kênh này
  else { ttDesired = uniqueId; ttAttempt = 0; ttUnknownAttempt = 0; resetSession(); }  // người dùng bấm Kết nối: phiên mới
  clearTimeout(ttRetryTimer); ttRetryTimer = null;
  const gen = ++ttGen;
  await teardownTikTok();
  if (gen !== ttGen) return;
  tiktokState = { status: 'connecting', uniqueId, error: '', ...(ttAttempt ? { attempt: ttAttempt } : {}) }; broadcast({ t:'tiktok', ...tiktokState });
  let step = 'khởi tạo', conn = null;
  const abandon = async () => { if (conn){ try { conn.removeAllListeners?.(); } catch {} try { await conn.disconnect(); } catch {} } };
  try {
    TikTokLib ||= await import('tiktok-live-connector');
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = TikTokLib;
    // enableExtendedGiftInfo = false: bật lên thì thư viện tải danh sách quà (gift/list/), request này Euler chỉ ký cho gói Business.
    // Tên quà + kim cương lấy thẳng từ sự kiện GIFT (d.gift), xem gift-event.mjs.
    const { SignConfig, RoomIdRouteConfig } = TikTokLib;
    RoomIdRouteConfig.skipFetchRoomIdFromEulerRoute = true;       // tra phòng bằng trang/API TikTok, không tốn lượt Euler
    const apiKey = process.env.EULER_API_KEY || '';
    if (apiKey) SignConfig.apiKey = apiKey;
    tiktokState.key = !!apiKey;
    conn = new TikTokLiveConnection(uniqueId, { enableExtendedGiftInfo: false, fetchRoomInfoOnConnect: false, processInitialData: false, ...(apiKey ? { signApiKey: apiKey } : {}) });
    const on = (ev, fn) => conn.on(ev, guard('Sự kiện TikTok lỗi', fn));       // lỗi trong một sự kiện chỉ ghi log, không phá kết nối
    const av = u => u?.profilePicture?.url?.[0] || u?.profilePicture?.urlList?.[0] || u?.avatarThumb?.urlList?.[0] || u?.avatarThumb?.url?.[0] || '';
    const nm = u => u?.nickname || u?.uniqueId || CONTENT.labels.anonymous;
    on(WebcastEvent.CHAT, d => onChat(d.user?.uniqueId || d.user?.userId, nm(d.user), d.comment, av(d.user)));
    on(WebcastEvent.GIFT, d => {
      const g = readGift(d, CONTENT.labels.defaultGift);
      if (g.streaking) return;                                      // streak still running
      if (!g.known) addLog('⚠ Sự kiện quà không có diamondCount, tính 1 xu');
      onGift(d.user?.uniqueId || d.user?.userId, nm(d.user), g.name, g.count, g.diamonds, av(d.user));
      addLog(`🎁 ${sanitizeDisplayName(nm(d.user))} cúng dường ${sanitizeGiftName(g.name)} x${g.count} (${g.diamonds} xu)`);
    });
    on(WebcastEvent.MEMBER, d => onMember(d.user?.uniqueId || d.user?.userId, nm(d.user), av(d.user)));
    on(WebcastEvent.LIKE, d => onLikes(d.user?.uniqueId, d.likeCount || 1, d.totalLikeCount));
    on(WebcastEvent.FOLLOW, d => onFollow(d.user?.uniqueId || d.user?.userId, nm(d.user), av(d.user)));
    on(WebcastEvent.SHARE, d => onShare(nm(d.user)));
    on(ControlEvent.DISCONNECTED, () => {
      if (gen !== ttGen) return;
      tiktokState = { ...tiktokState, status: 'disconnected' }; broadcast({ t:'tiktok', ...tiktokState }); addLog('TikTok: mất kết nối');
      scheduleTikTokReconnect(uniqueId, gen, { error: 'Mất kết nối với phòng live.', key: tiktokState.key });
    });
    on(ControlEvent.ERROR, e => addLog('TikTok lỗi: ' + (e?.info || e?.message || e)));
    // 3 bước, log từng bước để biết bước nào bị từ chối
    step = 'tra phòng';
    const roomId = await conn.fetchRoomId();
    if (gen !== ttGen) return await abandon();
    addLog(`🔎 [1/3] Tra phòng xong (roomId ${String(roomId).slice(0, 6)}…)`);
    step = 'thông tin phòng';
    try {
      const info = await conn.fetchRoomInfo(roomId);
      if (info?.data?.status === 4) throw Object.assign(new Error('The requested user isn\'t online :('), { name: 'UserOfflineError' });
      addLog('🔎 [2/3] Thông tin phòng: đang live');
    } catch (e) {
      if (e?.name === 'UserOfflineError' || /isn't online/i.test(String(e?.message))) throw e;
      addLog(`⚠ [2/3] Bỏ qua thông tin phòng (${String(e?.message || e).slice(0, 160)}), vẫn thử mở WebSocket`);
    }
    if (gen !== ttGen) return await abandon();
    step = 'mở WebSocket';
    const st = await conn.connect(roomId);
    if (gen !== ttGen) return await abandon();
    tiktok = conn;
    ttAttempt = 0;
    ttUnknownAttempt = 0;
    tiktokState = { status: 'connected', uniqueId, error: '', roomId: st?.roomId || roomId || '', key: tiktokState.key, stopped: false };
    recordStartupMilestone('kết nối TikTok', Date.now() - startedAt);
    addLog(`✅ [3/3] Đã kết nối live @${uniqueId}`);
  } catch (e) {
    await abandon();
    if (gen !== ttGen) return;                                      // lần nối này đã bị thay thế hoặc người dùng bấm Ngắt
    const hasKey = !!process.env.EULER_API_KEY;
    const err = { error: explainTikTokError(e, step, hasKey), step, key: hasKey };
    addLog(`❌ Không kết nối được @${uniqueId} (bước: ${step}): ${err.error}`);
    if (e?.message && err.error !== String(e.message).slice(0, 300)) addLog(`   chi tiết gốc: ${String(e.message).replace(/\s+/g, ' ').slice(0, 200)}`);
    const cat = categorizeTikTokError(e);
    if (cat === 'fatal') {
      ttDesired = null; ttAttempt = 0; ttUnknownAttempt = 0;
      tiktokState = { status: 'error', uniqueId, ...err, fatal: true, stopped: true };
      addLog(`⛔ Lỗi xác thực/quota/rate-limit: dừng ngay, không tự nối lại: ${err.error}`);
      broadcast({ t:'tiktok', ...tiktokState });
    } else if (cat === 'unknown') {
      ttUnknownAttempt++;
      if (ttUnknownAttempt > 5) {
        ttDesired = null; ttAttempt = 0; ttUnknownAttempt = 0;
        tiktokState = { status: 'error', uniqueId, ...err, fatal: true, stopped: true };
        addLog(`⛔ Lỗi lạ đã thử lại 5 lần cách nhau 60s vẫn thất bại. Đã dừng hẳn: ${err.error}`);
        broadcast({ t:'tiktok', ...tiktokState });
      } else {
        tiktokState = { status: 'error', uniqueId, ...err, unknownAttempt: ttUnknownAttempt };
        scheduleTikTokReconnect(uniqueId, gen, { ...err, unknownAttempt: ttUnknownAttempt }, 60);
      }
    } else {
      // network / offline
      tiktokState = { status: 'error', uniqueId, ...err };
      scheduleTikTokReconnect(uniqueId, gen, err);
    }
    return;
  }
  broadcast({ t:'tiktok', ...tiktokState });
}
// Người dùng bấm Ngắt: dừng hẳn, không tự nối lại.
async function disconnectTikTok(){
  ttDesired = null; ttGen++; ttAttempt = 0; ttUnknownAttempt = 0; clearTimeout(ttRetryTimer); ttRetryTimer = null;
  await teardownTikTok();
  tiktokState = { status:'idle', uniqueId:'', error:'', stopped: false }; broadcast({ t:'tiktok', ...tiktokState });
}

/* ------------------------------------------------------------- test data */
const DEMO_NAMES = CONTENT.demo.names;
function fillDemo(n){
  const have = [...viewers.values()].filter(v => v.demo).length;
  for (let i = have; i < n && viewers.size < MAX_SEATS; i++){
    const name = DEMO_NAMES[i % DEMO_NAMES.length] + (i >= DEMO_NAMES.length ? ' ' + (Math.floor(i / DEMO_NAMES.length) + 1) : '');
    seat('demo_' + i, name, { demo: true, skin: ['man','woman','woman','man','granny','monk','nun','child'][i % 8] });
  }
}
function clearSeats(){ clearAllViewers(); resetZoom(); resetCeremony(); broadcast(snapshot()); addLog('Đã làm trống bồ đoàn'); }

/* ------------------------------------------------------------- control */
function onControl(m, ws){
  switch (m.cmd){
    case 'connect': if (typeof m.uniqueId === 'string') bg('Kết nối TikTok lỗi', connectTikTok(m.uniqueId)); else addLog('Lệnh kết nối thiếu username'); break;
    case 'disconnect': bg('Ngắt TikTok lỗi', disconnectTikTok()); addLog('Đã ngắt kết nối TikTok'); break;
    case 'chat': { const raw = String(m.name || 'Khách').slice(0, 80); onChat('sim_' + sanitizeDisplayName(raw), raw, String(m.text || 'Nam mô A Di Đà Phật').slice(0, 120)); break; }
    case 'oracle': { const raw = String(m.name || 'Khách').slice(0, 80); const { v } = seat('sim_' + sanitizeDisplayName(raw), raw); if (v) triggerOracle(v.id, v.name, v.avatar, true); break; }
    case 'ceremony': {
      const raw = String(m.name || 'Khách').slice(0, 80);
      const kind = ['incense', 'worship', 'prostrate'].includes(m.kind) ? m.kind : 'incense';
      const { v } = seat('sim_' + sanitizeDisplayName(raw), raw);
      if (v) requestCeremony(v.id, kind, true);
      break;
    }
    case 'gift': { const raw = String(m.name || 'Khách').slice(0, 80); onGift('sim_' + sanitizeDisplayName(raw), raw, String(m.gift || 'Hoa Sen').slice(0, 30), clamp(m.count, 1, 99), clamp(m.diamonds, 1, 50000)); break; }
    case 'follow': { const raw = String(m.name || 'Khách').slice(0, 80); onFollow('sim_' + sanitizeDisplayName(raw), raw); break; }
    case 'test_zoom': { const raw = String(m.name || 'Khách').slice(0, 80); const { v } = seat('sim_' + sanitizeDisplayName(raw), raw); if (v) enqueueZoom(v.id, 'test'); break; }
    case 'silent_meditation': setSilentUntil(Date.now() + 5 * 60_000); addLog('🧘 Bắt đầu 5 phút thiền im lặng'); break;
    case 'silent_cancel': setSilentUntil(0); addLog('🔔 Đã kết thúc sớm chế độ thiền im lặng'); break;
    case 'share': onShare(m.name || 'Khách'); break;
    case 'likes': onLikes('sim_' + sanitizeDisplayName(m.name || 'Khách'), clamp(m.n, 1, 5000)); break;
    case 'fill': fillDemo(clamp(m.n, 1, 100)); addLog(`Đổ người mẫu: ${viewers.size} người`); break;
    case 'clear': clearSeats(); break;
    case 'bell': broadcast({ t:'bell' }); break;
    case 'music_next':     // Bài tiếp: chế độ ngẫu nhiên thì overlay lấy bài kế trong túi; chế độ chọn bài thì chuyển sang bài số kế (vòng 1→5)
      if (settings.musicTrack !== 'shuffle'){ settings.musicTrack = String(+settings.musicTrack % 5 + 1); broadcast({ t:'settings', settings, cap: capacity() }); }
      else broadcast({ t:'music_next' });
      break;
    case 'mo': broadcast({ t:'mo1' }); break;
    case 'chant': chant(); break;
    case 'say': if (m.text) say(String(m.text).slice(0, 400), { tag:'say' }, 5); break;
    case 'test_name': bg('Nghe thử lỗi', previewNameTTS(m.name, ws)); break;
    case 'test_vieneu': bg('Nghe thử VieNeu lỗi', previewVieNeuTTS(ws)); break;
    case 'settings': {
      const wasOld = settings.scene === 'old';
      applySettings(m.settings || {});
      if ((settings.scene === 'old') !== wasOld) resetCeremony();       // hai bố cục khác số bồ đoàn: đặt lại các lượt lễ đang chạy

      if (!settings.zoomEnabled) resetZoom();
      scheduleChant(); broadcast({ t:'settings', settings, cap: capacity() }); break;
    }
    case 'bots': setBots(!!m.on, +m.n || 12, typeof m.pace === 'string' ? m.pace : 'mid'); break;
  }
}

// Only known keys, right types, sane ranges: the panel is local, but nothing from the socket is trusted blindly.
const SETTING_RULES = {
  title: v => String(v).slice(0, 40), subtitle: v => String(v).slice(0, 60),
  voice: v => ['vi-VN-NamMinhNeural', 'vi-VN-HoaiMyNeural'].includes(v) ? v : settings.voice,
  pitch: v => clamp(v, -50, 50), rate: v => clamp(v, -50, 50), moBpm: v => clamp(v, 20, 120), chantEveryMin: v => clamp(v, 1, 60),
  music: Boolean, mo: Boolean, autoChant: Boolean, zoomEnabled: Boolean, joinOnEnter: Boolean, readMemberJoin: Boolean, safeZone: Boolean,
  musicTrack: v => ['shuffle', '1', '2', '3', '4', '5'].includes(String(v)) ? String(v) : 'shuffle',
  scene: v => ['auto', 'lunar', 'day', 'dawn', 'night', 'ram', 'phatdan', 'vulan', 'old'].includes(v) ? v : 'auto',
  gifts: v => ({ readAll: !!(v && v.readAll), minDiamonds: clamp(v && v.minDiamonds, 1, 50000) }),
  seatMode: v => ['auto', '24', '36', '64', '100'].includes(String(v)) ? String(v) : 'auto',
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
function applySettings(o){ for (const [k, fn] of Object.entries(SETTING_RULES)) if (k in o) settings[k] = fn(o[k]); }

/* ----------------------------------------------------------------- bots */
let botTimer = null, botCount = 0;
const BOT_LINES = CONTENT.demo.botLines;
// n bot (tối đa 300): 100 người đầu có chỗ ngồi, phần còn lại vào "đang thiền" và thay chỗ theo luật xoay vòng khi bình luận
function setBots(on, n, pace){
  clearInterval(botTimer); botTimer = null;
  if (on){
    n = clamp(n, 1, 300); botCount = n;
    for (let i = 0; i < n; i++) seat('bot_' + i, DEMO_NAMES[(i + 7) % DEMO_NAMES.length] + ' ·bot', { demo: true });
    const every = { slow: 4000, mid: 1800, fast: 700 }[pace] || 1800;
    botTimer = setInterval(() => {
      const i = Math.floor(Math.random() * botCount), id = 'bot_' + i, name = DEMO_NAMES[(i + 7) % DEMO_NAMES.length] + ' ·bot', r = Math.random();
      if (r < .62) onChat(id, name, BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]);
      else if (r < .88) onLikes(id, 1 + Math.floor(Math.random() * 4));
      else if (r < .96) onGift(id, name, 'Hoa hồng', 1 + Math.floor(Math.random() * 3), 1);
      else onGift(id, name, 'Đèn hoa sen', 1, 99);
    }, every);
    addLog(`🤖 Bật ${n} bot, nhịp ${pace}`);
  } else {
    for (const id of [...viewers.keys()]) if (id.startsWith('bot_') && !isProtectedCeremonyViewer(id)) removeViewer(id);
    for (const id of [...overflow.keys()]) if (id.startsWith('bot_')) overflow.delete(id);
    syncMore();
    addLog('🤖 Tắt bot');
  }
  broadcast({ t:'bots', on }, 'control');
}

/* -------------------------------------------------------------- server */
const HOST = process.env.HOST || '127.0.0.1';
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp',
  '.mp3':'audio/mpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain; charset=utf-8',
};
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const normAddr = a => { a = String(a || ''); return a.startsWith('::ffff:') ? a.slice(7) : a; };
const isLoopbackAddr = a => a === '::1' || /^127\./.test(a);
// → 'local' | null
function clientKind(req){
  const host = String(req.headers.host || '').toLowerCase(), addr = normAddr(req.socket.remoteAddress);
  if (ALLOWED_HOSTS.has(host)) return isLoopbackAddr(addr) ? 'local' : null;
  return null;
}
const SEP = path.sep;
function resolveStatic(urlPath){
  let p = urlPath === '/' ? '/live/control.html' : urlPath;
  if (!/^\/(assets|live)\//.test(p)) return null;
  if (p.split('/').some(seg => seg.startsWith('.') || seg === 'node_modules')) return null;
  if (/\.(mjs|json|md|log)$/i.test(p) && !p.startsWith('/assets/')) return null;      // never serve server code / package files
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + SEP)) return null;
  return file;
}
const server = http.createServer((req, res) => {
  const kind = clientKind(req);
  if (!kind) { res.writeHead(421).end('wrong host'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  const file = resolveStatic(p);
  if (!file) { res.writeHead(404).end('not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    const isAppCode = ext === '.html' || ext === '.js' || ext === '.css' || /(?:overlay|control)\.html$/i.test(file);
    const cacheCtrl = p.startsWith('/live/tts/') ? 'no-store' : (isAppCode ? 'no-cache' : 'public, max-age=3600');
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheCtrl, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024,
  verifyClient: ({ origin, req }, cb) => {
    const kind = clientKind(req);
    if (!kind) return cb(false, 401, 'wrong host');
    if (origin) {                                               // OBS / non-browser clients send no Origin
      let oh; try { oh = new URL(origin).host.toLowerCase(); } catch { return cb(false, 401, 'bad origin'); }
      const ok = ALLOWED_HOSTS.has(oh);
      if (!ok) return cb(false, 401, 'bad origin');
    }
    req.kind = kind; cb(true);
  } });
// Bảng điều khiển nhận ngay từng bản tin; overlay nhận gói gom mỗi limits.batchMs (100 ms): một lần gửi / client / nhịp thay vì từng sự kiện,
// các bản tin 'like' cùng một người trong nhịp được cộng dồn thành một.
let batch = [];
function flushBatch(){
  if (!batch.length) return;
  const likes = new Map(), out = [];
  for (const m of batch){
    if (m.t === 'like'){ const k = likes.get(m.id); if (k){ k.n = Math.min(100000, k.n + m.n); continue; } const c = { ...m }; likes.set(m.id, c); out.push(c); }
    else out.push(m);
  }
  batch = [];
  const s = JSON.stringify(out.length === 1 ? out[0] : { t: 'batch', msgs: out });
  for (const c of wss.clients) if (c.readyState === 1 && c.role !== 'control' && c.live !== false) { try { c.send(s); } catch (e) { console.error('[broadcast] gửi lỗi:', e?.message); } }
}
function broadcast(msg, only){
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1 && c.role === 'control' && (!only || only === 'control')) { try { c.send(s); } catch (e) { console.error('[broadcast] gửi lỗi:', e?.message); } }
  if (only !== 'control') { batch.push(msg); if (batch.length > 5000) batch.splice(0, batch.length - 5000); }
}
setInterval(flushBatch, CONTENT.limits.batchMs).unref?.();
wss.on('error', e => survive('wss error', e));
server.on('error', e => survive('server error', e));
server.on('clientError', (e, socket) => { try { socket.destroy(); } catch {} });
wss.on('connection', (ws, req) => {
  ws.on('error', e => console.error('[ws client] lỗi:', e?.message));            // không có listener thì lỗi socket làm sập tiến trình
  ws.role = req.kind === 'local' && new URL(req.url, 'http://x').searchParams.get('role') === 'control' ? 'control' : 'overlay';
  ws.live = false;                                             // chưa nhận gói gom cho tới khi đã nhận snapshot
  if (ws.role === 'overlay') {
    let count = 0;
    for (const c of wss.clients) if (c.readyState === 1 && c.role === 'overlay') count++;
    overlayState.clients = count;
    if (overlayState.status === 'offline') overlayState.status = 'preparing';
    broadcast({ t: 'overlay_status', ...overlayState }, 'control');
  }
  ws.on('close', () => {
    if (ws.role === 'overlay') {
      let count = 0;
      for (const c of wss.clients) if (c !== ws && c.readyState === 1 && c.role === 'overlay') count++;
      overlayState.clients = count;
      if (count === 0) {
        overlayState.status = 'offline';
        broadcast({ t: 'overlay_status', ...overlayState }, 'control');
      }
    }
  });
  try {
    flushBatch();                                              // gói cũ gửi cho các client khác trước, để snapshot không bị sự kiện cũ chồng lên
    ws.send(JSON.stringify(snapshot()));
    ws.live = true;
    if (ws.role === 'control') ws.send(JSON.stringify({ t:'logs', lines: log }));
  } catch (e) { console.error('[ws] gửi snapshot lỗi:', e?.message); }
  ws.on('message', buf => {
    try {
      const m = JSON.parse(buf);
      if (m && m.t === 'startup_metric') {
        recordStartupMilestone(m.name, m.ms, m.extra || '');
        return;
      }
      if (m && m.t === 'overlay_status') {
        overlayState = { status: m.status || 'ready', clients: Math.max(1, overlayState.clients) };
        broadcast({ t: 'overlay_status', ...overlayState }, 'control');
        return;
      }
      if (m && m.t === 'overlay_stats') {
        overlayStats = {
          fps: Number.isFinite(m.fps) ? m.fps : 30,
          heapMb: Number.isFinite(m.heapMb) ? m.heapMb : null,
          domNodes: Number.isFinite(m.domNodes) ? m.domNodes : null,
          updatedAt: Date.now()
        };
        return;
      }
      if (ws.role !== 'control') return;                          // overlays only listen
      if (m && m.t === 'ctl') { const r = onControl(m, ws); if (r?.catch) r.catch(e => addLog('Lệnh lỗi: ' + (e?.message || e))); }
    } catch (e) { addLog('Lệnh lỗi: ' + (e?.message || e)); }
  });
});
server.listen(PORT, HOST, () => {
  const readyMs = Date.now() - startedAt;
  recordStartupMilestone('server sẵn sàng', readyMs);
  addLog(`Server chạy tại http://localhost:${PORT}  ·  Bảng điều khiển: http://localhost:${PORT}/live/control.html  ·  Overlay: http://localhost:${PORT}/live/overlay.html`);
  setTimeout(warmupTTS, 100);
});

export { onChat, onGift, viewers, ttsQueue, server, warmupTTS, ceremonies, ceremonyQueue };
