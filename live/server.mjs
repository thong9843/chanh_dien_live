// Chánh Điện Tịnh Tâm — live server
// Runs on the streaming PC. Serves the overlay + control panel, listens to a TikTok LIVE room,
// keeps the list of seated viewers, generates Vietnamese voice lines with Edge TTS and pushes
// everything to the overlay over WebSocket.
//
//   cd live && npm install && npm start        → http://localhost:3000/live/control.html
//
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import DEFAULT_CONTENT from './content.defaults.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');            // repo root: serves /assets, /live
const TTS_DIR = path.join(__dirname, 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });
for (const f of fs.readdirSync(TTS_DIR)) { try { fs.unlinkSync(path.join(TTS_DIR, f)); } catch {} }
const PORT = +process.env.PORT || 3000;

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
    guide: { lines: cArr(o('guide').lines, D.guide.lines, 160, 6) },
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
      maxQueue: Math.round(cNum(ce.maxQueue, 1, 20, dce.maxQueue)),
      cooldownSec: cNum(ce.cooldownSec, 0, 3600, dce.cooldownSec),
      bannerTop: cNum(ce.bannerTop, 0, 1850, dce.bannerTop),
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
        toast: { top: cNum(sub('toast').top, 0, 1800, D.toast.top) },
        gift: { top: cNum(sub('gift').top, 0, 1800, D.gift.top) }, chant: { top: cNum(sub('chant').top, 0, 1800, D.chant.top) },
        floor: { yTop, yBot, halfTop: n(fl, df, 'halfTop', 50, 540), halfBot: n(fl, df, 'halfBot', 50, 540) },
        altarSpot: {
          x: n(as, das, 'x', 120, 960),
          y: n(as, das, 'y', 900, 1850),
          scale: n(as, das, 'scale', 0.15, 1.5),
        },
      };
    })(),
    credit: { enabled: typeof cr.enabled === 'boolean' ? cr.enabled : D.credit.enabled, text: cStr(cr.text, D.credit.text, 120),
              everyMin: [Math.min(lo, hi), Math.max(lo, hi)], showSec: cNum(cr.showSec, 1, 60, 7), y: cNum(cr.y, 0, 1920, 1890), fontPx: cNum(cr.fontPx, 10, 60, 22) },
  };
}
const CONTENT = loadContent();
const CLIENT_CONTENT = {
  labels: CONTENT.labels, guide: CONTENT.guide, layout: CONTENT.layout, share: CONTENT.share,
  milestone: { text: CONTENT.milestone.text, showSec: CONTENT.milestone.showSec },
  gift: { what: CONTENT.gift.what, timesShown: CONTENT.gift.timesShown },
  zoom: CONTENT.zoom,
  ceremony: CONTENT.ceremony,
  credit: CONTENT.credit,
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
  lightingMode: 'auto',              // auto (theo giờ thực) | day | night
  zoomEnabled: CONTENT.zoom.enabled, // bật/tắt zoom vào Phật tử khi quà ≥99 xu hoặc follow
  joinOnEnter: false,                // also seat viewers who only enter the room
  readMemberJoin: false,             // xướng tên chào đón người mới vào phòng (khi bật joinOnEnter)
  gifts: { readAll: true, minDiamonds: 1 },
};
const viewers = new Map();           // id -> { id, rawName, name, skin, avatar, coins, joinedAt, lastAt, lastText, lastTextAt, demo }
const startedAt = Date.now();
let silentUntil = 0;                 // trạng thái chung toàn hệ thống (thiền im lặng)
let silentEndTimer = null;
let tiktok = null, tiktokState = { status: 'idle', uniqueId: '', error: '' };
const log = [];
function addLog(s){ const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${s}`; log.push(line); if (log.length > 300) log.shift(); broadcast({ t:'log', line }, 'control'); console.log(line); }

const CAPS = [24, 36, 64, 100];
function capacity(){ if (settings.seatMode !== 'auto') return +settings.seatMode; const n = viewers.size; return CAPS.find(c => n <= c) || 100; }

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
function triggerOracle(id, name, avatar, bypassCooldown = false){
  const now = Date.now();
  if (!bypassCooldown){
    const prev = oracleCooldown.get(id) || 0;
    if (now - prev < 15_000) return false;
  }
  oracleCooldown.set(id, now);
  const oracle = pickOracle();
  const safeName = sanitizeDisplayName(name);
  broadcast({
    t: 'oracle',
    id,
    name: safeName,
    avatar: avatar || '',
    title: oracle.title,
    verse: oracle.verse,
    advice: oracle.advice,
    showSec: 8,
  });
  addLog(`📜 Quẻ Cầu An cho ${safeName}: ${oracle.title}`);
  return true;
}

/* ------------------------------------------- High-tier gift detection */
const HIGH_GIFT_RE = /hoa\s*sen|sen\s*vàng|đèn\s*hoa\s*sen|rồng|dragon|kim\s*cương|diamond|chuông|sư\s*tử|lion|phượng|vàng|trầm\s*hương|universe/i;
function isHighTierGift(giftName, coins, tier){
  return tier >= 2 || coins >= 20 || HIGH_GIFT_RE.test(giftName);
}

function pub(v){ return { id:v.id, name:v.name, skin:v.skin, avatar:v.avatar||'', coins:v.coins, demo:!!v.demo }; }
function snapshot(){ scanPoseSkins(); return { t:'state', poseSkins: [...POSE_SKINS], poseFiles: POSE_FILES, settings, viewers:[...viewers.values()].map(pub), cap: capacity(), startedAt, silentUntil, tiktok: tiktokState, content: CLIENT_CONTENT }; }

/* ------------------------------------------- Silent mode, Altar Ceremony & Camera Zoom */
const zoomQueue = [];
let zoomNextAt = 0, zoomTimer = null;

// Trạng thái Lên lễ Phật (!thắp nhang, !cúng bái, !quỳ lạy): mỗi lúc 1 người, hàng chờ tối đa 5,
// cooldown 5 phút/người (chỉ tính từ lúc người đó BẮT ĐẦU hành lễ), nghỉ gapSec giữa 2 người.
// Server là nguồn thời gian duy nhất: overlay chỉ chạy theo bản tin 'ceremony', không gửi lệnh ngược.
let ceremonyActive = null; // { id, name, kind, endsAt }
const ceremonyQueue = [];  // [{ id, kind }]
const ceremonyCooldowns = new Map();
let ceremonyTimer = null, ceremonyGapTimer = null, ceremonyNextAt = 0;

function isAtAltarSpot(id){
  return !!(ceremonyActive && ceremonyActive.id === id);
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

// Skin có đủ bộ ảnh tư thế assets/pose_<skin>_{stand,walkL,walkR}.png thì được đứng dậy đi bộ lên bàn thờ
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

// Toạ độ chỗ ngồi theo đúng cách overlay xếp (cùng công thức layout() ở overlay.html) để ước lượng quãng đường đi bộ
const SEAT_GRID = { 24: [6, 4], 36: [6, 6], 64: [8, 8], 100: [10, 10] };
function seatLayout(cap){
  const fl = CONTENT.layout.floor, [cols, rows] = SEAT_GRID[cap] || SEAT_GRID[24], seats = [];
  for (let r = 0; r < rows; r++){
    const t = rows === 1 ? .5 : r / (rows - 1);
    const y = fl.yTop + (fl.yBot - fl.yTop) * t, half = fl.halfTop + (fl.halfBot - fl.halfTop) * t;
    for (let k = 0; k < cols; k++){
      let u = (k - (cols - 1) / 2) / ((cols - 1) / 2); u = Math.sign(u) * (.14 + .86 * Math.abs(u));
      seats.push({ x: 540 + u * half, y, r });
    }
  }
  seats.sort((a, b) => (b.r - a.r) || (Math.abs(a.x - 540) - Math.abs(b.x - 540)));
  return { seats, rowGap: rows > 1 ? (fl.yBot - fl.yTop) / (rows - 1) : 0 };
}

// Thời gian đi bộ của 1 người: tốc độ cố định, kẹp trong [minSec, maxSec].
// Đường đi: ghế → bước ra phía trước hàng (laneFrac × khoảng cách hàng) → ngang tới lối giữa x=540 → thẳng lên altarSpot.
function ceremonyWalkInfo(v){
  const w = CONTENT.ceremony.walk;
  if (!POSE_SKINS.has(v.skin)) return null;
  const { seats, rowGap } = seatLayout(capacity());
  const seat = seats[[...viewers.keys()].indexOf(v.id)];
  if (!seat) return null;
  const dy = rowGap * w.laneFrac, altar = CONTENT.layout.altarSpot;
  const len = dy + Math.abs(altar.x - seat.x) + Math.abs(seat.y + dy - altar.y);
  return { sec: Math.min(w.maxSec, Math.max(w.minSec, len / w.speedPxPerSec)), laneFrac: w.laneFrac, stepSec: w.stepSec, riseSec: w.riseSec, bobPx: w.bobPx };
}

// Tổng thời gian 1 lượt lễ (giây): ngồi tại chỗ = 4 lần mờ + hành lễ; có ảnh pose = đứng dậy + đi bộ + hành lễ + 2 lần mờ
function computeCeremonyDurationSec(kind, walk){
  const c = CONTENT.ceremony, b = c.bow;
  const bowSec = hold => b.downSec + hold + b.upSec;
  let perform;
  if (kind === 'incense') perform = c.incenseHoldSec + bowSec(b.holdSec);
  else if (kind === 'worship') perform = bowSec(b.holdSec) * 3 + b.pauseSec * 2;
  else perform = bowSec(b.prostrateHoldSec);
  if (walk) return walk.riseSec + walk.sec + perform + c.tailSec + c.fadeSec * 2;
  return c.fadeSec * 4 + perform + c.tailSec;
}

function resetCeremony(){
  ceremonyActive = null;
  ceremonyQueue.length = 0;
  ceremonyCooldowns.clear();
  ceremonyNextAt = 0;
  clearTimeout(ceremonyTimer); ceremonyTimer = null;
  clearTimeout(ceremonyGapTimer); ceremonyGapTimer = null;
}

function startCeremony(v, kind){
  // Xoá mọi mục zoom đang chờ của người này (không zoom vào người đang ở điểm lễ)
  for (let i = zoomQueue.length - 1; i >= 0; i--){
    if (zoomQueue[i].id === v.id) zoomQueue.splice(i, 1);
  }
  const c = CONTENT.ceremony;
  const walk = ceremonyWalkInfo(v);
  const totalSec = computeCeremonyDurationSec(kind, walk);
  const now = Date.now();
  ceremonyActive = { id: v.id, name: v.name, kind, endsAt: now + totalSec * 1000 };
  ceremonyCooldowns.set(v.id, now); // cooldown chỉ tính khi bắt đầu hành lễ

  const labelMap = { incense: '!thắp nhang', worship: '!cúng bái', prostrate: '!quỳ lạy' };
  addLog(`🙏 Mời Phật tử ${v.name} lên lễ Phật (${labelMap[kind] || kind})`);

  broadcast({
    t: 'ceremony',
    id: v.id,
    name: v.name,
    kind,
    inviteText: fill(c.inviteText, { name: v.name }),
    inviteSec: c.inviteSec,
    fadeSec: c.fadeSec,
    incenseBoostSec: c.incenseBoostSec,
    incenseHoldSec: c.incenseHoldSec,
    tailSec: c.tailSec,
    bow: c.bow,
    stand: c.stand,
    walk,
    totalSec,
  });

  clearTimeout(ceremonyTimer);
  ceremonyTimer = setTimeout(finishCeremony, Math.round(totalSec * 1000));
  ceremonyTimer.unref?.();
}

function finishCeremony(){
  ceremonyTimer = null;
  ceremonyActive = null;
  ceremonyNextAt = Date.now() + CONTENT.ceremony.gapSec * 1000; // nghỉ giữa 2 người lên lễ
  scheduleNextCeremony();
}

function scheduleNextCeremony(){
  clearTimeout(ceremonyGapTimer); ceremonyGapTimer = null;
  if (ceremonyActive || !ceremonyQueue.length) return;
  const wait = Math.max(0, ceremonyNextAt - Date.now());
  ceremonyGapTimer = setTimeout(() => {
    ceremonyGapTimer = null;
    while (ceremonyQueue.length){
      const next = ceremonyQueue.shift();
      const v = viewers.get(next.id);
      if (v){ startCeremony(v, next.kind); return; } // người đã rời phòng thì bỏ qua, không tính cooldown
    }
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

  if (!ceremonyActive && !ceremonyQueue.length && now >= ceremonyNextAt){
    startCeremony(v, kind);
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
  for (const [id, at] of oracleCooldown) if (now - at >= 15_000) oracleCooldown.delete(id);
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

function seat(id, name, opts = {}){
  let v = viewers.get(id);
  if (v){ v.lastAt = Date.now(); if (name) v.rawName = String(name).slice(0, 80); if (opts.avatar) v.avatar = opts.avatar; return { v, isNew:false }; }
  if (viewers.size >= 100){                     // full: the longest-quiet non-donor (not in ceremony) stands up
    const quiet = [...viewers.values()].filter(x => x.coins === 0 && !isProtectedCeremonyViewer(x.id)).sort((a,b) => a.lastAt - b.lastAt)[0];
    if (!quiet) return { v:null, isNew:false };
    viewers.delete(quiet.id); broadcast({ t:'leave', id: quiet.id });
  }
  const rawName = String(name || id).slice(0, 80);
  v = { id, rawName, name: sanitizeDisplayName(rawName), skin: opts.skin || DEFAULT_SKINS[viewers.size % DEFAULT_SKINS.length],
        avatar: opts.avatar || '', coins: 0, joinedAt: Date.now(), lastAt: Date.now(), demo: !!opts.demo };
  viewers.set(id, v);
  broadcast({ t:'join', v: pub(v), cap: capacity() });
  return { v, isNew:true };
}

/* ------------------------------------------------------------- events in */
function onChat(id, name, text, avatar){
  text = String(text || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 120);
  if (!text) return;
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

function onGift(id, name, giftName, count, diamonds, avatar){
  const cleanGift = sanitizeGiftName(giftName);
  count = Math.max(1, Math.min(9999, +count || 1));
  const { v } = seat(id, name, { avatar });
  if (!v) return;
  const coins = Math.max(1, (diamonds || 1) * (count || 1));
  v.coins += coins;

  const hasCustomPrayer = v.lastText && (Date.now() - v.lastTextAt < 90_000) && v.lastText.length > 6 && !isOracleRequest(v.lastText);
  const prayer = hasCustomPrayer ? v.lastText : (CONTENT.gift.defaultPrayer || 'Nguyện cầu bình an, phước báu vô lượng');
  const tier = coins >= 99 ? 3 : coins >= 20 ? 2 : 1;
  const highGift = isHighTierGift(cleanGift, coins, tier);
  const scrollMerit = tier >= 2 || coins >= 25 || highGift;

  const spokenName = spoken(v.rawName || name || v.name);
  const line = fill(CONTENT.gift.line, {
    name: spokenName,
    gift: cleanGift,
    count,
    total: v.coins,
    prayer,
    times: count > 1 ? fill(CONTENT.gift.timesSpoken, { count }) : '',
  });

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
    say(line, { tag: 'gift', small: tier < 3, names: [spokenName] }, tier >= 3 ? 3 : 1);
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
const followed = new Set(); let likeTotal = 0, mileDone = null;
function resetSession(){ followed.clear(); likeTotal = 0; mileDone = null; resetZoom(); resetCeremony(); }
function onFollow(id, name, avatar){
  id = String(id || '').slice(0, 64); if (!id) return;
  if (followed.has(id)) return;
  followed.add(id);
  const { v } = seat(id, name, { avatar });
  const who = v ? v.name : sanitizeDisplayName(name);
  broadcast({ t:'follow', id, name: who });
  if (v && CONTENT.zoom.onFollow) enqueueZoom(v.id, 'follow');
  say(fill(CONTENT.follow.line, { name: spoken(v?.rawName || name || who) }), { tag:'follow' }, 2);
}
function onShare(name){
  const who = sanitizeDisplayName(name);
  broadcast({ t:'share', name: who });
}
function onLikes(id, n, total){
  n = Math.max(1, Math.min(100000, +n || 1));
  broadcast({ t:'like', id, n });
  const before = likeTotal;
  likeTotal = (Number.isFinite(total) && total > likeTotal) ? total : likeTotal + n;
  const every = CONTENT.milestone.every, m = Math.floor(likeTotal / every);
  if (mileDone === null) mileDone = Math.floor(Math.max(0, Math.min(before, likeTotal - n)) / every);
  if (m > mileDone){
    mileDone = m; const count = m * every;
    broadcast({ t:'milestone', n: count });
    say(fill(CONTENT.milestone.line, { n: count }), { tag:'milestone' }, 2);
  }
}

/* ------------------------------------------------------------------ Edge TTS Queue */
const ttsQueue = []; let ttsBusy = false, ttsSeq = 0;
function esc(s){ return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
const MAX_Q = 15, MERGE_OVER = 8;

// Thang ưu tiên: 4 say thủ công > 3 quà lớn > 2 follow / mốc tim > 1 quà nhỏ > 0 tụng định kỳ / member.
function say(text, meta = {}, prio = 1){
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!cleanText) return;
  const item = { text: cleanText, meta, prio };
  if (ttsQueue.length >= MAX_Q){
    const low = Math.min(...ttsQueue.map(q => q.prio));
    if (prio <= low){ addLog('Hàng đợi giọng đọc đầy, bỏ qua 1 câu'); return; }
    const i = ttsQueue.map(q => q.prio).lastIndexOf(low); ttsQueue.splice(i, 1);
    addLog('Hàng đợi giọng đọc đầy, bỏ 1 câu ưu tiên thấp');
  }
  let at = ttsQueue.length; while (at > 0 && ttsQueue[at - 1].prio < prio) at--;
  ttsQueue.splice(at, 0, item);
  if (ttsQueue.length > MERGE_OVER) mergeSmallGifts();
  pumpTTS();
}

function mergeSmallGifts(){
  const idx = ttsQueue.map((q, i) => q.meta.small ? i : -1).filter(i => i >= 0);
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

async function synthesizeViaEdge(text){
  const tts = new MsEdgeTTS();
  await tts.setMetadata(settings.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(esc(text), {
    pitch: `${settings.pitch >= 0 ? '+' : ''}${settings.pitch}Hz`,
    rate: `${settings.rate >= 0 ? '+' : ''}${settings.rate}%`,
  });
  const chunks = [];
  await new Promise((res, rej) => {
    audioStream.on('data', c => chunks.push(c));
    audioStream.on('close', res);
    audioStream.on('error', rej);
  });
  try { tts.close(); } catch {}
  return Buffer.concat(chunks);
}

function pruneTtsFiles(){
  const old = fs.readdirSync(TTS_DIR).sort();
  while (old.length > 40) {
    try { fs.unlinkSync(path.join(TTS_DIR, old.shift())); } catch {}
  }
}

async function pumpTTS(){
  if (ttsBusy || !ttsQueue.length) return;
  ttsBusy = true;
  const { text, meta } = ttsQueue.shift();
  try {
    const buf = await synthesizeViaEdge(text);
    const file = `tts_${Date.now()}_${++ttsSeq}.mp3`;
    fs.writeFileSync(path.join(TTS_DIR, file), buf);
    broadcast({ t: 'tts', url: `/live/tts/${file}`, text, tag: meta.tag });
    pruneTtsFiles();
  } catch (e) {
    addLog('TTS lỗi: ' + (e?.message || e));
  }
  ttsBusy = false;
  setTimeout(pumpTTS, 80);
}

// Tạo file nghe thử cách đọc tên khó riêng trên bảng điều khiển (đọc nguyên câu quà từ content.json, không phát lên overlay)
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
  }).slice(0, 500);
  try {
    const buf = await synthesizeViaEdge(text);
    const file = `tts_preview_${Date.now()}_${++ttsSeq}.mp3`;
    fs.writeFileSync(path.join(TTS_DIR, file), buf);
    pruneTtsFiles();
    if (ws && ws.readyState === 1){
      ws.send(JSON.stringify({ t: 'preview_tts', url: `/live/tts/${file}`, rawName: raw, spokenName, text }));
    }
  } catch (e) {
    addLog('Nghe thử lỗi: ' + (e?.message || e));
    if (ws && ws.readyState === 1){
      ws.send(JSON.stringify({ t: 'preview_tts', error: String(e?.message || e), rawName: raw, spokenName, text }));
    }
  }
}

let chantIdx = 0, chantTimer = null;
function chant(){ const text = CONTENT.chants[chantIdx++ % CONTENT.chants.length]; broadcast({ t:'chant', text }); say(text, { tag:'chant' }, 0); }
function scheduleChant(){ clearInterval(chantTimer); if (settings.autoChant) chantTimer = setInterval(chant, Math.max(1, settings.chantEveryMin) * 60_000); }
scheduleChant();

/* --------------------------------------------------------------- TikTok */
let TikTokLib = null;
async function connectTikTok(uniqueId){
  uniqueId = String(uniqueId || '').trim().replace(/^.*tiktok\.com\/@?/i, '').replace(/^@/, '').replace(/\/.*$/, '');
  if (!uniqueId) return;
  await disconnectTikTok(); resetSession();
  tiktokState = { status: 'connecting', uniqueId, error: '' }; broadcast({ t:'tiktok', ...tiktokState });
  try {
    TikTokLib ||= await import('tiktok-live-connector');
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = TikTokLib;
    const conn = new TikTokLiveConnection(uniqueId, { enableExtendedGiftInfo: true, processInitialData: false });
    const av = u => u?.profilePicture?.url?.[0] || u?.profilePicture?.urlList?.[0] || u?.avatarThumb?.urlList?.[0] || u?.avatarThumb?.url?.[0] || '';
    const nm = u => u?.nickname || u?.uniqueId || CONTENT.labels.anonymous;
    conn.on(WebcastEvent.CHAT, d => onChat(d.user?.uniqueId || d.user?.userId, nm(d.user), d.comment, av(d.user)));
    conn.on(WebcastEvent.GIFT, d => {
      const type = d.giftDetails?.giftType ?? d.extendedGiftInfo?.type;
      if (type === 1 && !d.repeatEnd) return;                       // streak still running
      const gname = d.giftDetails?.giftName || d.extendedGiftInfo?.name || CONTENT.labels.defaultGift;
      const dia = d.giftDetails?.diamondCount ?? d.extendedGiftInfo?.diamond_count ?? 1;
      onGift(d.user?.uniqueId || d.user?.userId, nm(d.user), gname, d.repeatCount || 1, dia, av(d.user));
      addLog(`🎁 ${sanitizeDisplayName(nm(d.user))} cúng dường ${sanitizeGiftName(gname)} x${d.repeatCount || 1}`);
    });
    conn.on(WebcastEvent.MEMBER, d => onMember(d.user?.uniqueId || d.user?.userId, nm(d.user), av(d.user)));
    conn.on(WebcastEvent.LIKE, d => onLikes(d.user?.uniqueId, d.likeCount || 1, d.totalLikeCount));
    conn.on(WebcastEvent.FOLLOW, d => onFollow(d.user?.uniqueId || d.user?.userId, nm(d.user), av(d.user)));
    conn.on(WebcastEvent.SHARE, d => onShare(nm(d.user)));
    conn.on(ControlEvent.DISCONNECTED, () => { tiktokState = { ...tiktokState, status: 'disconnected' }; broadcast({ t:'tiktok', ...tiktokState }); addLog('TikTok: mất kết nối'); });
    conn.on(ControlEvent.ERROR, e => addLog('TikTok lỗi: ' + (e?.info || e?.message || e)));
    const st = await conn.connect();
    tiktok = conn;
    tiktokState = { status: 'connected', uniqueId, error: '', roomId: st?.roomId || '' };
    addLog(`✅ Đã kết nối live @${uniqueId}`);
  } catch (e) {
    tiktokState = { status: 'error', uniqueId, error: String(e?.message || e) };
    addLog(`❌ Không kết nối được @${uniqueId}: ${tiktokState.error}`);
  }
  broadcast({ t:'tiktok', ...tiktokState });
}
async function disconnectTikTok(){ if (tiktok){ try { await tiktok.disconnect(); } catch {} tiktok = null; } tiktokState = { status:'idle', uniqueId:'', error:'' }; broadcast({ t:'tiktok', ...tiktokState }); }

/* ------------------------------------------------------------- test data */
const DEMO_NAMES = CONTENT.demo.names;
function fillDemo(n){
  const have = [...viewers.values()].filter(v => v.demo).length;
  for (let i = have; i < n && viewers.size < 100; i++){
    const name = DEMO_NAMES[i % DEMO_NAMES.length] + (i >= DEMO_NAMES.length ? ' ' + (Math.floor(i / DEMO_NAMES.length) + 1) : '');
    seat('demo_' + i, name, { demo: true, skin: ['man','woman','woman','man','granny','monk','nun','child'][i % 8] });
  }
}
function clearSeats(){ viewers.clear(); resetZoom(); resetCeremony(); broadcast(snapshot()); addLog('Đã làm trống bồ đoàn'); }

/* ------------------------------------------------------------- control */
function onControl(m, ws){
  switch (m.cmd){
    case 'connect': connectTikTok(m.uniqueId); break;
    case 'disconnect': disconnectTikTok(); addLog('Đã ngắt kết nối TikTok'); break;
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
    case 'mo': broadcast({ t:'mo1' }); break;
    case 'chant': chant(); break;
    case 'say': if (m.text) say(String(m.text).slice(0, 400), { tag:'say' }, 4); break;
    case 'test_name': previewNameTTS(m.name, ws); break;
    case 'settings':
      applySettings(m.settings || {});
      if (!settings.zoomEnabled) resetZoom();
      scheduleChant(); broadcast({ t:'settings', settings, cap: capacity() }); break;
    case 'bots': setBots(!!m.on, +m.n || 12, m.pace); break;
  }
}

// Only known keys, right types, sane ranges: the panel is local, but nothing from the socket is trusted blindly.
const SETTING_RULES = {
  title: v => String(v).slice(0, 40), subtitle: v => String(v).slice(0, 60),
  voice: v => ['vi-VN-NamMinhNeural', 'vi-VN-HoaiMyNeural'].includes(v) ? v : settings.voice,
  pitch: v => clamp(v, -50, 50), rate: v => clamp(v, -50, 50), moBpm: v => clamp(v, 20, 120), chantEveryMin: v => clamp(v, 1, 60),
  music: Boolean, mo: Boolean, autoChant: Boolean, zoomEnabled: Boolean, joinOnEnter: Boolean, readMemberJoin: Boolean,
  lightingMode: v => ['auto', 'day', 'night'].includes(v) ? v : 'auto',
  gifts: v => ({ readAll: !!(v && v.readAll), minDiamonds: clamp(v && v.minDiamonds, 1, 50000) }),
  seatMode: v => ['auto', '24', '36', '64', '100'].includes(String(v)) ? String(v) : 'auto',
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
function applySettings(o){ for (const [k, fn] of Object.entries(SETTING_RULES)) if (k in o) settings[k] = fn(o[k]); }

/* ----------------------------------------------------------------- bots */
let botTimer = null;
const BOT_LINES = CONTENT.demo.botLines;
function setBots(on, n, pace){
  clearInterval(botTimer); botTimer = null;
  if (on){
    n = clamp(n, 1, 100);
    for (let i = 0; i < n; i++) seat('bot_' + i, DEMO_NAMES[(i + 7) % DEMO_NAMES.length] + ' ·bot', { demo: true });
    const every = { slow: 4000, mid: 1800, fast: 700 }[pace] || 1800;
    botTimer = setInterval(() => {
      const ids = [...viewers.keys()].filter(id => id.startsWith('bot_')); if (!ids.length) return;
      const id = ids[Math.floor(Math.random() * ids.length)], v = viewers.get(id), r = Math.random();
      if (r < .62) onChat(id, v.name, BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]);
      else if (r < .88) onLikes(id, 1 + Math.floor(Math.random() * 4));
      else if (r < .96) onGift(id, v.name, 'Hoa hồng', 1 + Math.floor(Math.random() * 3), 1);
      else onGift(id, v.name, 'Đèn hoa sen', 1, 99);
    }, every);
    addLog(`🤖 Bật ${n} bot, nhịp ${pace}`);
  } else {
    for (const id of [...viewers.keys()]) if (id.startsWith('bot_') && !isProtectedCeremonyViewer(id)) { viewers.delete(id); broadcast({ t:'leave', id }); }
    addLog('🤖 Tắt bot');
  }
  broadcast({ t:'bots', on }, 'control');
}

/* -------------------------------------------------------------- server */
// LAN=1 (xem overlay trên điện thoại cùng WiFi): nghe 0.0.0.0, nhưng quyền do ĐỊA CHỈ NGUỒN kết nối quyết định, không do client tự khai.
//   • 'local' : kết nối từ loopback + Host là localhost  → toàn quyền (control.html, lệnh WebSocket)
//   • 'lan'   : kết nối từ dải riêng (10/8, 172.16/12, 192.168/16) + Host là IP của chính máy này → chỉ xem overlay
//   • còn lại (IP công cộng, Host lạ)                    → từ chối
const LAN = process.env.LAN === '1';
const HOST = LAN ? '0.0.0.0' : (process.env.HOST || '127.0.0.1');
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp',
  '.mp3':'audio/mpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon',
};
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const normAddr = a => { a = String(a || ''); return a.startsWith('::ffff:') ? a.slice(7) : a; };
const isLoopbackAddr = a => a === '::1' || /^127\./.test(a);
function isPrivateV4(a){
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a); if (!m) return false;
  const x = +m[1], y = +m[2];
  return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
}
let lanCache = { at: 0, ips: [] };
function lanIPs(){
  if (Date.now() - lanCache.at < 10_000) return lanCache.ips;
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal && isPrivateV4(i.address)) ips.push(i.address);
  lanCache = { at: Date.now(), ips }; return ips;
}
const lanHostSet = () => new Set(lanIPs().map(ip => `${ip}:${PORT}`));
// → 'local' | 'lan' | null
function clientKind(req){
  const host = String(req.headers.host || '').toLowerCase(), addr = normAddr(req.socket.remoteAddress);
  if (ALLOWED_HOSTS.has(host)) return isLoopbackAddr(addr) ? 'local' : null;
  if (LAN && lanHostSet().has(host) && (isPrivateV4(addr) || isLoopbackAddr(addr))) return 'lan';
  return null;
}
// Chỉ cho client LAN lấy đúng những gì overlay cần.
const lanPathOk = p => p === '/live/overlay.html' || p.startsWith('/live/js/') || p.startsWith('/assets/') || p.startsWith('/live/tts/');
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
  if (kind === 'lan' && !lanPathOk(p)) { res.writeHead(403).end('chỉ xem overlay qua LAN'); return; }
  const file = resolveStatic(p);
  if (!file) { res.writeHead(404).end('not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': p.startsWith('/live/tts/') ? 'no-store' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
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
      const ok = kind === 'local' ? ALLOWED_HOSTS.has(oh) : oh === String(req.headers.host).toLowerCase();
      if (!ok) return cb(false, 401, 'bad origin');
    }
    if (kind === 'lan' && new URL(req.url, 'http://x').searchParams.get('role') === 'control') return cb(false, 403, 'control chỉ từ localhost');
    req.kind = kind; cb(true);
  } });
function broadcast(msg, only){ const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === 1 && (!only || c.role === only)) c.send(s); }
wss.on('connection', (ws, req) => {
  ws.role = req.kind === 'local' && new URL(req.url, 'http://x').searchParams.get('role') === 'control' ? 'control' : 'overlay';
  ws.send(JSON.stringify(snapshot()));
  if (ws.role === 'control') ws.send(JSON.stringify({ t:'logs', lines: log }));
  ws.on('message', buf => {
    if (ws.role !== 'control') return;                          // overlays only listen
    try { const m = JSON.parse(buf); if (m && m.t === 'ctl') onControl(m, ws); } catch (e) { addLog('Lệnh lỗi: ' + e.message); }
  });
});
server.listen(PORT, HOST, () => {
  addLog(`Server chạy tại http://localhost:${PORT}  ·  Bảng điều khiển: http://localhost:${PORT}/live/control.html  ·  Overlay: http://localhost:${PORT}/live/overlay.html`);
  if (!LAN) return;
  const ips = lanIPs();
  addLog('📱 Chế độ LAN đang BẬT: điện thoại cùng WiFi chỉ xem được overlay (control vẫn chỉ ở localhost).');
  if (!ips.length) addLog('📱 Không tìm thấy IP mạng LAN nào (192.168.x.x / 10.x.x.x / 172.16-31.x.x).');
  for (const ip of ips) {
    addLog(`📱 Vừa khung (contain): http://${ip}:${PORT}/live/overlay.html`);
    addLog(`📱 Lấp đầy màn hình (cover): http://${ip}:${PORT}/live/overlay.html?fit=cover`);
  }
  addLog('⚠ Không có mật khẩu: ai trong cùng WiFi cũng xem được overlay (tên, avatar, bình luận người xem). Chỉ dùng WiFi tin cậy.');
});
