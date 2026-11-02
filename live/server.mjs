// Chánh Điện Tịnh Tâm — live server (Upgraded v2.0)
// Runs on the streaming PC. Serves the overlay + control panel, listens to a TikTok LIVE room,
// keeps the list of seated viewers, generates Vietnamese voice lines via VieNeu TTS Sidecar (:5000)
// (with automatic Edge TTS fallback) and pushes everything to the overlay over WebSocket.
//
//   cd live && npm install && npm run dev        → http://localhost:3000/live/control.html
//
import http from 'node:http';
import fs from 'node:fs';
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
const VIENEU_BASE = (process.env.VIENEU_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');

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
    layout: (() => {
      const L = o('layout'), D = DEFAULT_CONTENT.layout, sub = k => (L[k] && typeof L[k] === 'object' && !Array.isArray(L[k])) ? L[k] : {};
      const n = (src, def, k, lo, hi) => cNum(src[k], lo, hi, def[k]);
      const fl = sub('floor'), df = D.floor;
      let yTop = n(fl, df, 'yTop', 0, 1920), yBot = n(fl, df, 'yBot', 0, 1920); if (yTop >= yBot){ yTop = df.yTop; yBot = df.yBot; }
      const g = sub('candleGlow'), dg = D.candleGlow, h = sub('halo'), dh = D.halo;
      const tl = Array.isArray(L.teachers) && L.teachers.length ? L.teachers.slice(0, 8) : D.teachers;
      return {
        halo: { y: n(h, dh, 'y', -500, 2500), scale: n(h, dh, 'scale', .05, 5), alpha: n(h, dh, 'alpha', 0, 1) },
        candleGlow: { x: n(g, dg, 'x', -1080, 1080), y: n(g, dg, 'y', 0, 1920), w: n(g, dg, 'w', 0, 2160), h: n(g, dg, 'h', 0, 1920) },
        incense: { y: n(sub('incense'), D.incense, 'y', 0, 1920) },
        teachers: tl.map((t, i) => { const dt = D.teachers[i] || D.teachers[0], tt = (t && typeof t === 'object') ? t : {};
          return { name: cStr(tt.name, dt.name, 30), skin: ['monk','nun','granny','man','woman','child'].includes(tt.skin) ? tt.skin : dt.skin,
                   x: cNum(tt.x, 0, 1080, dt.x), y: cNum(tt.y, 0, 1920, dt.y), s: cNum(tt.s, .05, 5, dt.s), master: !!tt.master }; }),
        toast: { top: cNum(sub('toast').top, 0, 1800, D.toast.top) },
        gift: { top: cNum(sub('gift').top, 0, 1800, D.gift.top) }, chant: { top: cNum(sub('chant').top, 0, 1800, D.chant.top) },
        floor: { yTop, yBot, halfTop: n(fl, df, 'halfTop', 50, 540), halfBot: n(fl, df, 'halfBot', 50, 540) },
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
  credit: CONTENT.credit,
};
const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m);

/* ------------------------------------------------------------------ state */
const settings = {
  title: CONTENT.channel.title,
  subtitle: CONTENT.channel.subtitle,
  ttsEngine: 'edge',                 // Mặc định: 'edge' (bản gốc Nam Minh) | 'vieneu' (chỉ gọi :5000 khi bật)
  voice: 'vi-VN-NamMinhNeural',      // vi-VN-NamMinhNeural | vi-VN-HoaiMyNeural
  pitch: -18,                        // Hz — đúng cấu hình gốc kentjuno/chanh-dien-online
  rate: -20,                         // %  — đúng cấu hình gốc kentjuno/chanh-dien-online
  vieneuVoice: 'nam_trang_nghiem',   // Chỉ dùng khi bật ttsEngine = 'vieneu'
  vieneuSpeed: 1.0,
  music: true, mo: true, moBpm: 52,
  autoChant: true, chantEveryMin: 3,
  seatMode: 'auto',                  // auto | 24 | 36 | 64 | 100
  lightingMode: 'auto',              // auto (theo giờ thực) | day | night
  joinOnEnter: false,                // also seat viewers who only enter the room
  readMemberJoin: false,             // xướng tên chào đón người mới vào phòng (khi bật joinOnEnter)
  gifts: { readAll: true, minDiamonds: 1 },
};
const viewers = new Map();           // id -> { id, name, skin, avatar, coins, joinedAt, lastAt, lastText, lastTextAt, demo }
const startedAt = Date.now();
let tiktok = null, tiktokState = { status: 'idle', uniqueId: '', error: '' };
let vieneuState = { enabled: false, online: false, backend: 'disabled', presetVoice: '', url: VIENEU_BASE };
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
function snapshot(){ return { t:'state', settings, viewers:[...viewers.values()].map(pub), cap: capacity(), startedAt, tiktok: tiktokState, vieneu: vieneuState, content: CLIENT_CONTENT }; }

function seat(id, name, opts = {}){
  let v = viewers.get(id);
  if (v){ v.lastAt = Date.now(); if (name) v.rawName = String(name).slice(0, 80); if (opts.avatar) v.avatar = opts.avatar; return { v, isNew:false }; }
  if (viewers.size >= 100){                     // full: the longest-quiet non-donor stands up
    const quiet = [...viewers.values()].filter(x => x.coins === 0).sort((a,b) => a.lastAt - b.lastAt)[0];
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

  const askOracle = isOracleRequest(text);
  if (!askOracle && !want){
    v.lastText = text;
    v.lastTextAt = Date.now();
  }
  broadcast({ t:'chat', id, name: v.name, text });
  if (askOracle){
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

  if (settings.gifts.readAll || coins >= settings.gifts.minDiamonds){
    say(line, { tag: 'gift', small: tier < 3, names: [spokenName], voice_id: settings.vieneuVoice }, tier >= 3 ? 3 : 1);
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
    say(line, { tag: 'member', voice_id: settings.vieneuVoice }, 0);
  }
}

/* follow / share / mốc tim. "Buổi" = từ lúc chạy server đến lúc kết nối sang phòng khác. */
const followed = new Set(); let likeTotal = 0, mileDone = null;
function resetSession(){ followed.clear(); likeTotal = 0; mileDone = null; }
function onFollow(id, name, avatar){
  id = String(id || '').slice(0, 64); if (!id) return;
  if (followed.has(id)) return;
  followed.add(id);
  const { v } = seat(id, name, { avatar });
  const who = v ? v.name : sanitizeDisplayName(name);
  broadcast({ t:'follow', id, name: who });
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

/* ------------------------------------------------------------------ TTS Queue & VieNeu Sidecar */
const ttsQueue = []; let ttsBusy = false, ttsSeq = 0, warnedVieNeuOffline = false;
function esc(s){ return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
const MAX_Q = 15, MERGE_OVER = 8;

async function checkVieNeuHealth(){
  if (settings.ttsEngine !== 'vieneu'){
    if (vieneuState.enabled || vieneuState.online || vieneuState.backend !== 'disabled'){
      vieneuState = { enabled: false, online: false, backend: 'disabled', presetVoice: '', url: VIENEU_BASE };
      broadcast({ t: 'vieneu', ...vieneuState }, 'control');
    }
    return false;
  }
  try {
    const res = await fetch(`${VIENEU_BASE}/health`, { signal: AbortSignal.timeout(2200) });
    if (res.ok){
      const data = await res.json();
      vieneuState = {
        enabled: true,
        online: !!data.ok,
        backend: String(data.backend || 'vieneu'),
        presetVoice: String(data.preset_voice || ''),
        url: VIENEU_BASE,
      };
      warnedVieNeuOffline = false;
      broadcast({ t: 'vieneu', ...vieneuState }, 'control');
      return true;
    }
  } catch {}
  vieneuState = { enabled: true, online: false, backend: 'offline', presetVoice: '', url: VIENEU_BASE };
  broadcast({ t: 'vieneu', ...vieneuState }, 'control');
  return false;
}

// Thang ưu tiên: 4 say thủ công > 3 quà lớn > 2 follow / mốc tim > 1 quà nhỏ > 0 tụng định kỳ / member.
function say(text, meta = {}, prio = 1){
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!cleanText) return;
  const item = { text: cleanText, payload: meta, meta, prio };
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
  const merged = { text: text.slice(0, 500), payload: { tag: 'gift', small: true, names }, meta: { tag: 'gift', small: true, names }, prio: 1 };
  const first = idx[0];
  for (let k = idx.length - 1; k >= 0; k--) ttsQueue.splice(idx[k], 1);
  ttsQueue.splice(first, 0, merged);
  addLog(`Gộp ${idx.length} câu quà nhỏ thành 1 (${names.length} người)`);
}

async function synthesizeViaVieNeu(text, voiceId){
  const res = await fetch(`${VIENEU_BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voice_id: voiceId || settings.vieneuVoice || 'nam_trang_nghiem',
      speed: settings.vieneuSpeed || 0.96,
      response_format: 'json',
    }),
    signal: AbortSignal.timeout(18_000),
  });
  if (!res.ok) throw new Error(`VieNeu HTTP ${res.status}`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('audio/')){
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = ct.includes('mpeg') ? 'mp3' : 'wav';
    return { buf, ext, engine: 'vieneu' };
  }
  const data = await res.json();
  if (!data || !data.audio_base64) throw new Error('Payload VieNeu thiếu audio_base64');
  const buf = Buffer.from(data.audio_base64, 'base64');
  const ext = data.ext === 'mp3' ? 'mp3' : 'wav';
  return { buf, ext, engine: data.backend || 'vieneu' };
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
  return { buf: Buffer.concat(chunks), ext: 'mp3', engine: 'edge' };
}

function pruneTtsFiles(){
  const old = fs.readdirSync(TTS_DIR).sort();
  while (old.length > 40) {
    try { fs.unlinkSync(path.join(TTS_DIR, old.shift())); } catch {}
  }
}

async function synthesizeCurrentEngine(text, voiceId){
  let result = null;
  if (settings.ttsEngine === 'vieneu'){
    try {
      result = await synthesizeViaVieNeu(text, voiceId);
      if (!vieneuState.online){
        vieneuState = { enabled: true, online: true, backend: result.engine, presetVoice: vieneuState.presetVoice || '', url: VIENEU_BASE };
        broadcast({ t: 'vieneu', ...vieneuState }, 'control');
      }
      warnedVieNeuOffline = false;
    } catch (err) {
      if (!warnedVieNeuOffline){
        warnedVieNeuOffline = true;
        addLog(`ℹ️ VieNeu Sidecar (${VIENEU_BASE}) không phản hồi (${err.message}) → tạm dùng Edge TTS.`);
      }
      if (vieneuState.online){
        vieneuState = { enabled: true, online: false, backend: 'offline', presetVoice: '', url: VIENEU_BASE };
        broadcast({ t: 'vieneu', ...vieneuState }, 'control');
      }
    }
  }
  if (!result){
    result = await synthesizeViaEdge(text);
  }
  return result;
}

async function pumpTTS(){
  if (ttsBusy || !ttsQueue.length) return;
  ttsBusy = true;
  const { text, meta } = ttsQueue.shift();
  try {
    const result = await synthesizeCurrentEngine(text, meta?.voice_id);
    const file = `tts_${Date.now()}_${++ttsSeq}.${result.ext}`;
    fs.writeFileSync(path.join(TTS_DIR, file), result.buf);
    broadcast({ t: 'tts', url: `/live/tts/${file}`, text, tag: meta.tag, engine: result.engine });
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
    const result = await synthesizeCurrentEngine(text, settings.vieneuVoice);
    const file = `tts_preview_${Date.now()}_${++ttsSeq}.${result.ext}`;
    fs.writeFileSync(path.join(TTS_DIR, file), result.buf);
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
function clearSeats(){ viewers.clear(); broadcast(snapshot()); addLog('Đã làm trống bồ đoàn'); }

/* ------------------------------------------------------------- control */
function onControl(m, ws){
  switch (m.cmd){
    case 'connect': connectTikTok(m.uniqueId); break;
    case 'disconnect': disconnectTikTok(); addLog('Đã ngắt kết nối TikTok'); break;
    case 'chat': { const raw = String(m.name || 'Khách').slice(0, 80); onChat('sim_' + sanitizeDisplayName(raw), raw, String(m.text || 'Nam mô A Di Đà Phật').slice(0, 120)); break; }
    case 'oracle': { const raw = String(m.name || 'Khách').slice(0, 80); const { v } = seat('sim_' + sanitizeDisplayName(raw), raw); if (v) triggerOracle(v.id, v.name, v.avatar, true); break; }
    case 'gift': { const raw = String(m.name || 'Khách').slice(0, 80); onGift('sim_' + sanitizeDisplayName(raw), raw, String(m.gift || 'Hoa Sen').slice(0, 30), clamp(m.count, 1, 99), clamp(m.diamonds, 1, 50000)); break; }
    case 'follow': { const raw = String(m.name || 'Khách').slice(0, 80); onFollow('sim_' + sanitizeDisplayName(raw), raw); break; }
    case 'share': onShare(m.name || 'Khách'); break;
    case 'likes': onLikes('sim_' + sanitizeDisplayName(m.name || 'Khách'), clamp(m.n, 1, 5000)); break;
    case 'fill': fillDemo(clamp(m.n, 1, 100)); addLog(`Đổ người mẫu: ${viewers.size} người`); break;
    case 'clear': clearSeats(); break;
    case 'bell': broadcast({ t:'bell' }); break;
    case 'mo': broadcast({ t:'mo1' }); break;
    case 'chant': chant(); break;
    case 'say': if (m.text) say(String(m.text).slice(0, 400), { tag:'say', voice_id: settings.vieneuVoice }, 4); break;
    case 'test_name': previewNameTTS(m.name, ws); break;
    case 'settings': {
      const prevEngine = settings.ttsEngine;
      applySettings(m.settings || {});
      if (settings.ttsEngine !== prevEngine) checkVieNeuHealth();
      scheduleChant(); broadcast({ t:'settings', settings, cap: capacity() }); break;
    }
    case 'bots': setBots(!!m.on, +m.n || 12, m.pace); break;
  }
}

// Only known keys, right types, sane ranges: the panel is local, but nothing from the socket is trusted blindly.
const SETTING_RULES = {
  title: v => String(v).slice(0, 40), subtitle: v => String(v).slice(0, 60),
  ttsEngine: v => ['edge', 'vieneu'].includes(v) ? v : settings.ttsEngine,
  vieneuVoice: v => ['nam_trang_nghiem', 'duc_tri_nam', 'adam_nam', 'minh_triet_nam', 'nu_thanh_thoat', 'my_duyen_nu'].includes(v) ? v : settings.vieneuVoice,
  vieneuSpeed: v => Number.isFinite(+v) ? Math.min(1.3, Math.max(0.65, +(+v).toFixed(2))) : 1.0,
  voice: v => ['vi-VN-NamMinhNeural', 'vi-VN-HoaiMyNeural'].includes(v) ? v : settings.voice,
  pitch: v => clamp(v, -50, 50), rate: v => clamp(v, -50, 50), moBpm: v => clamp(v, 20, 120), chantEveryMin: v => clamp(v, 1, 60),
  music: Boolean, mo: Boolean, autoChant: Boolean, joinOnEnter: Boolean, readMemberJoin: Boolean,
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
    for (const id of [...viewers.keys()]) if (id.startsWith('bot_')) { viewers.delete(id); broadcast({ t:'leave', id }); }
    addLog('🤖 Tắt bot');
  }
  broadcast({ t:'bots', on }, 'control');
}

/* -------------------------------------------------------------- server */
const HOST = process.env.HOST || '127.0.0.1';
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.svg':'image/svg+xml', '.ico':'image/x-icon',
};
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const okHost = h => ALLOWED_HOSTS.has(String(h || '').toLowerCase());
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
  if (!okHost(req.headers.host)) { res.writeHead(421).end('wrong host'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
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
  verifyClient: ({ origin, req }) => {
    if (!okHost(req.headers.host)) return false;
    if (!origin) return true;                                   // OBS / non-browser clients send no Origin
    try { return okHost(new URL(origin).host); } catch { return false; }
  } });
function broadcast(msg, only){ const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === 1 && (!only || c.role === only)) c.send(s); }
wss.on('connection', (ws, req) => {
  ws.role = new URL(req.url, 'http://x').searchParams.get('role') === 'control' ? 'control' : 'overlay';
  ws.send(JSON.stringify(snapshot()));
  if (ws.role === 'control') ws.send(JSON.stringify({ t:'logs', lines: log }));
  ws.on('message', buf => {
    if (ws.role !== 'control') return;                          // overlays only listen
    try { const m = JSON.parse(buf); if (m && m.t === 'ctl') onControl(m, ws); } catch (e) { addLog('Lệnh lỗi: ' + e.message); }
  });
});
server.listen(PORT, HOST, () => addLog(`Server chạy tại http://localhost:${PORT}  ·  Bảng điều khiển: http://localhost:${PORT}/live/control.html  ·  Overlay: http://localhost:${PORT}/live/overlay.html`));
