/**
 * Chánh Điện Tịnh Tâm — 2.5D Canvas Animation & Exclusive FX Engine
 * =================================================================
 * Bao gồm:
 *  - Hạng mục 2.1: Hàm nội suy mượt lerp() + Character class + Perspective Scaling
 *  - Hạng mục 2.2: 12-Frame Bowing Sequence (Quỳ lạy 12 khung hình đồng bộ deltaTime 60fps)
 *  - Hạng mục 3.1: Lư Hương Lửa & Khói Trầm Tương Tác (Perlin/Value Noise + Sine Drift)
 *  - Hạng mục 3.2: Sổ Vàng Công Đức Cuộn Thư Pháp 2.5D (Silk Merit Scroll)
 *  - Hạng mục 3.3: Ánh Sáng & Thời Tiết Chánh Điện Realtime (Day Light Beams / Night Candles & Oil Lamps)
 *  - Hạng mục 3.4: Thẻ Thư Pháp "Rút Quẻ Cầu An & Lời Phật Dạy" (8 giây)
 *  - Hạng mục 3.5: Vòng Hào Quang Hoa Sen Cúng Dường (Lotus Glow Aura 5 phút dưới chân bồ đoàn)
 */

(function (global) {
  'use strict';

  /* =========================================================================
   * 1. TOÁN HỌC NỘI SUY & PERLIN / VALUE NOISE 2D
   * ========================================================================= */

  // Hàm Lerp chuẩn theo kế hoạch giúp di chuyển & co giãn mượt mà
  function lerp(start, end, t) {
    return start + (end - start) * t;
  }

  // Lerp độc lập tốc độ khung hình (chuẩn hóa theo t ở 60fps dựa trên deltaTime)
  function lerpDt(start, end, t60, dt) {
    const k = 1 - Math.pow(1 - t60, Math.min(dt * 60, 4));
    return lerp(start, end, k);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function easeOutCubic(x) {
    const t = clamp(x, 0, 1);
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOutSine(x) {
    const t = clamp(x, 0, 1);
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }

  /* -------------------------------------------------------------------------
   * Sprite vẽ sẵn: thay gradient mỗi hạt / shadowBlur mỗi khung bằng ảnh dựng một lần rồi drawImage.
   * ------------------------------------------------------------------------- */
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // Bộ nhớ đệm LRU nhỏ cho sprite phụ thuộc kích thước (đã làm tròn)
  class SpriteCache {
    constructor(max) { this.max = max; this.map = new Map(); }
    get(key, build) {
      let v = this.map.get(key);
      if (v) { this.map.delete(key); this.map.set(key, v); return v; }
      v = build();
      this.map.set(key, v);
      if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
      return v;
    }
  }

  // Perlin-style smooth 2D Value Noise cho khói trầm uốn lượn tự nhiên
  const PERM = new Uint8Array(512);
  (function initNoise() {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let seed = 1082026;
    for (let i = 255; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const j = seed % (i + 1);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  })();

  function fadeNoise(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function grad2D(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2.0 * v : 2.0 * v);
  }

  function perlin2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fadeNoise(xf);
    const v = fadeNoise(yf);
    const aa = PERM[PERM[X] + Y];
    const ab = PERM[PERM[X] + Y + 1];
    const ba = PERM[PERM[X + 1] + Y];
    const bb = PERM[PERM[X + 1] + Y + 1];
    const x1 = lerp(grad2D(aa, xf, yf), grad2D(ba, xf - 1, yf), u);
    const x2 = lerp(grad2D(ab, xf, yf - 1), grad2D(bb, xf - 1, yf - 1), u);
    return clamp(lerp(x1, x2, v) * 0.5, -1, 1);
  }

  /* =========================================================================
   * 2. CÚI LẠY ĐƠN GIẢN (3 thao tác nhẹ trên nguyên ảnh nhân vật, KHÔNG warp)
   *    - Hạ cả người xuống tối đa dropPct chiều cao ảnh (bồ đoàn giữ nguyên chỗ).
   *    - Nén dọc phần thân (từ thắt lưng đến vai) tối đa squashPct; vùng đầu KHÔNG nén,
   *      chỉ dịch xuống theo vai nên đầu luôn nhìn thấy đủ.
   *    - Ngả nhẹ về phía bàn thờ: nửa trên dịch lên leanPx (xa camera).
   *    Mọi biên độ & thời gian lấy từ content.json → ceremony.bow (setBowConfig).
   * ========================================================================= */

  const BOW_DEFAULT = {
    dropPct: 0.11, squashPct: 0.10, leanPx: 2,
    downSec: 0.9, holdSec: 0.6, upSec: 0.9, prostrateHoldSec: 1.5, pauseSec: 0.3,
  };
  const BOW_LIMITS = {
    dropPct: [0, 0.12], squashPct: [0, 0.15], leanPx: [0, 12],
    downSec: [0.2, 5], holdSec: [0, 6], upSec: [0.2, 5], prostrateHoldSec: [0, 8], pauseSec: [0, 3],
  };
  const BOW_CFG = Object.assign({}, BOW_DEFAULT);

  function setBowConfig(c) {
    if (!c || typeof c !== 'object') return;
    for (const k of Object.keys(BOW_DEFAULT)) {
      const v = +c[k];
      if (Number.isFinite(v)) BOW_CFG[k] = clamp(v, BOW_LIMITS[k][0], BOW_LIMITS[k][1]);
    }
  }

  const HEAD_RATIO = 0.27; // phần đầu + vai trên (từ đỉnh ảnh xuống), không bị nén
  const HIP_RATIO = 0.70;  // từ đây xuống: chân xếp bằng + bồ đoàn, giữ nguyên chỗ
  const BOW_PAD = 24;
  let bowScratch = null;

  // Vẽ các mảnh ảnh theo toạ độ ảnh gốc: gốc (0,0) = góc trên trái ảnh. Trả về cao độ đỉnh đầu (đơn vị ảnh).
  function paintBowed(c, img, pose, leanSrc) {
    const sw = img.naturalWidth, sh = img.naturalHeight;
    const headY = Math.round(sh * HEAD_RATIO), hipY = Math.round(sh * HIP_RATIO);
    const drop = sh * BOW_CFG.dropPct * pose;
    const squash = (hipY - headY) * BOW_CFG.squashPct * pose;
    const lean = leanSrc * pose;
    // thân: từ vai tới thắt lưng, nén dọc `squash`, vai hạ xuống `drop`
    const torsoTop = headY + drop - lean;
    // đáy thân luôn chạm tới thắt lưng (+1px chồng dưới bồ đoàn) để không hở khe khi ngả lên
    const torsoBottom = Math.max(hipY + 1, torsoTop + (hipY - headY) - squash);
    c.drawImage(img, 0, headY - 0.5, sw, hipY - headY + 0.5, 0, torsoTop, sw, torsoBottom - torsoTop);
    // đầu: giữ nguyên kích thước, chỉ dịch xuống theo vai
    c.drawImage(img, 0, 0, sw, headY + 1, 0, drop - lean, sw, headY + 1);
    // bồ đoàn + chân: giữ nguyên chỗ, vẽ sau để che mép thân
    c.drawImage(img, 0, hipY, sw, sh - hipY, 0, hipY, sw, sh - hipY);
    return drop - lean;
  }

  /**
   * Vẽ nhân vật đang cúi (pose 0..1). ctx đã translate tới chân nhân vật.
   * Trả về chiều cao đỉnh đầu tính theo ws (để đặt thẻ tên).
   */
  function drawBowedCharacter(ctx, img, drawScale, ws, pose, alpha) {
    const sw = img.naturalWidth, sh = img.naturalHeight;
    const leanSrc = BOW_CFG.leanPx / drawScale; // leanPx tính theo pixel màn hình
    let headTop;
    if (alpha >= 0.98) {
      ctx.save();
      ctx.scale(drawScale, drawScale);
      ctx.translate(-sw / 2, -sh);
      headTop = paintBowed(ctx, img, pose, leanSrc);
      ctx.restore();
    } else {
      // đang mờ dần: gộp các mảnh ở alpha 1 rồi mới vẽ mờ, tránh vệt chồng mép
      if (!bowScratch) bowScratch = document.createElement('canvas');
      if (bowScratch.width < sw || bowScratch.height < sh + BOW_PAD) {
        bowScratch.width = Math.max(bowScratch.width, sw);
        bowScratch.height = Math.max(bowScratch.height, sh + BOW_PAD);
      }
      const sc = bowScratch.getContext('2d');
      sc.clearRect(0, 0, bowScratch.width, bowScratch.height);
      sc.save();
      sc.translate(0, BOW_PAD);
      headTop = paintBowed(sc, img, pose, leanSrc);
      sc.restore();
      ctx.drawImage(bowScratch, 0, 0, sw, sh + BOW_PAD, -sw * drawScale / 2, -(sh + BOW_PAD) * drawScale, sw * drawScale, (sh + BOW_PAD) * drawScale);
    }
    return (sh - headTop) * ws;
  }

  // Tiến trình cúi (0 → 1 → 0) theo thời gian của một lần lạy
  function bowPoseAt(t, holdSec) {
    const { downSec, upSec } = BOW_CFG;
    if (t < downSec) return easeInOutSine(clamp(t / downSec, 0, 1));
    if (t < downSec + holdSec) return 1;
    return 1 - easeInOutSine(clamp((t - downSec - holdSec) / upSec, 0, 1));
  }
  function bowTotalSec(holdSec) { return BOW_CFG.downSec + holdSec + BOW_CFG.upSec; }

  /* -------------------------------------------------------------------------
   * 2b. ẢNH TƯ THẾ ĐỨNG / ĐI BỘ (assets/pose_<skin>_{stand,walkL,walkR}.png)
   *     Vái đứng: hạ người dropPct + nén nửa trên squashPct, đầu KHÔNG nén (chỉ dịch xuống).
   *     Nếu có thêm pose_<skin>_kneel + pose_<skin>_prostrate thì dùng quỳ + lạy thay vái đứng.
   * ------------------------------------------------------------------------- */
  const STAND_DEFAULT = { dropPct: 0.09, squashPct: 0.10, waistRatio: 0.46, headRatio: { man: 0.17, woman: 0.17, granny: 0.24 } };
  const STAND_CFG = { dropPct: STAND_DEFAULT.dropPct, squashPct: STAND_DEFAULT.squashPct, waistRatio: STAND_DEFAULT.waistRatio, headRatio: Object.assign({}, STAND_DEFAULT.headRatio) };

  function setStandConfig(c) {
    if (!c || typeof c !== 'object') return;
    if (Number.isFinite(+c.dropPct)) STAND_CFG.dropPct = clamp(+c.dropPct, 0, 0.12);
    if (Number.isFinite(+c.squashPct)) STAND_CFG.squashPct = clamp(+c.squashPct, 0, 0.15);
    if (Number.isFinite(+c.waistRatio)) STAND_CFG.waistRatio = clamp(+c.waistRatio, 0.3, 0.7);
    if (c.headRatio && typeof c.headRatio === 'object') {
      for (const k of Object.keys(c.headRatio)) if (Number.isFinite(+c.headRatio[k])) STAND_CFG.headRatio[k] = clamp(+c.headRatio[k], 0.05, 0.4);
    }
  }

  // Vẽ ảnh đứng đang vái theo toạ độ ảnh gốc (gốc = góc trên trái). Trả về mức đầu hạ xuống (đơn vị ảnh).
  function paintStandBowed(c, img, pose, skin) {
    const sw = img.naturalWidth, sh = img.naturalHeight;
    const headY = Math.round(sh * (STAND_CFG.headRatio[skin] || 0.17)), waistY = Math.round(sh * STAND_CFG.waistRatio);
    const drop = sh * STAND_CFG.dropPct * pose;
    const torsoH = waistY - headY;
    const squash = torsoH * STAND_CFG.squashPct * pose;
    const legsShrink = Math.max(0, drop - squash);        // hạ người: chân hơi chùng xuống
    const waistDst = waistY + legsShrink;
    const torsoTop = waistDst - (torsoH - squash);
    c.drawImage(img, 0, waistY, sw, sh - waistY, 0, waistDst, sw, sh - waistDst);                 // chân
    c.drawImage(img, 0, headY - 0.5, sw, torsoH + 0.5, 0, torsoTop - 0.5, sw, torsoH - squash + 1); // thân (nén)
    c.drawImage(img, 0, 0, sw, headY + 1, 0, torsoTop - headY, sw, headY + 1);                      // đầu (giữ nguyên)
    return torsoTop - headY;
  }

  // ctx đã translate tới chân nhân vật (giữa đáy ảnh). Trả về chiều cao đỉnh đầu theo ws.
  function drawStandCharacter(ctx, img, drawScale, ws, pose, alpha, skin) {
    const sw = img.naturalWidth, sh = img.naturalHeight;
    if (pose < 0.004) {
      ctx.drawImage(img, -sw * drawScale / 2, -sh * drawScale, sw * drawScale, sh * drawScale);
      return sh * ws;
    }
    let headTop;
    if (alpha >= 0.98) {
      ctx.save();
      ctx.scale(drawScale, drawScale);
      ctx.translate(-sw / 2, -sh);
      headTop = paintStandBowed(ctx, img, pose, skin);
      ctx.restore();
    } else {
      if (!bowScratch) bowScratch = document.createElement('canvas');
      if (bowScratch.width < sw || bowScratch.height < sh + BOW_PAD) {
        bowScratch.width = Math.max(bowScratch.width, sw);
        bowScratch.height = Math.max(bowScratch.height, sh + BOW_PAD);
      }
      const sc = bowScratch.getContext('2d');
      sc.clearRect(0, 0, bowScratch.width, bowScratch.height);
      sc.save();
      sc.translate(0, BOW_PAD);
      headTop = paintStandBowed(sc, img, pose, skin);
      sc.restore();
      ctx.drawImage(bowScratch, 0, 0, sw, sh + BOW_PAD, -sw * drawScale / 2, -(sh + BOW_PAD) * drawScale, sw * drawScale, (sh + BOW_PAD) * drawScale);
    }
    return (sh - headTop) * ws;
  }

  // Hạ thêm người ở pha lạy (prostrate) theo từng skin, tỉ lệ chiều cao ảnh; server kẹp 0–0.12 (content.json → ceremony.prostrateExtraDrop)
  const PROSTRATE_EXTRA = { man: 0, woman: 0.04, granny: 0.08 };
  // Hệ số thu nhỏ riêng cho ảnh quỳ/lạy (server gửi ceremony.kneel.scale, kẹp 0.5–1.2): ảnh quỳ gốc hơi lớn so với thầy ngồi cùng hàng
  let KNEEL_SCALE = 0.9;
  function setKneelScale(v) { if (Number.isFinite(+v)) KNEEL_SCALE = clamp(+v, 0.5, 1.2); }

  // Bóng elip mờ dưới chân/gối (vẽ sẵn một lần): bám chân nhân vật khi đứng, quỳ, lạy
  let footShadow = null;
  function getFootShadow() {
    if (footShadow) return footShadow;
    const c = makeCanvas(256, 64), x = c.getContext('2d');
    x.translate(128, 32); x.scale(1, 0.25);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 128);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, 128, 0, Math.PI * 2); x.fill();
    return (footShadow = c);
  }
  function setProstrateExtraDrop(c) {
    if (!c || typeof c !== 'object') return;
    for (const k of Object.keys(c)) {
      if (!/^[a-z]{2,12}$/.test(k)) continue;
      const v = +c[k];
      if (Number.isFinite(v)) PROSTRATE_EXTRA[k] = clamp(v, 0, 0.12);
    }
  }

  // Vẽ ảnh quỳ (kneel) nguyên khổ: ctx đã translate tới chân nhân vật. Trả về chiều cao ảnh theo ws.
  function drawKneelCharacter(ctx, img, drawScale, ws) {
    const sw = img.naturalWidth, sh = img.naturalHeight;
    ctx.drawImage(img, -sw * drawScale / 2, -sh * drawScale, sw * drawScale, sh * drawScale);
    return sh * ws;
  }

  // Vẽ ảnh lạy sát đất (prostrate). extra = phần hạ thêm (0..1) theo chiều cao ảnh: nửa trên (từ đỉnh đến hông) nén xuống,
  // đáy (gối, bàn chân) giữ nguyên chỗ.
  function drawProstrateCharacter(ctx, img, drawScale, ws, extra) {
    const sw = img.naturalWidth, sh = img.naturalHeight;
    const drop = Math.max(0, extra) * sh;
    if (drop < 0.5) {
      ctx.drawImage(img, -sw * drawScale / 2, -sh * drawScale, sw * drawScale, sh * drawScale);
      return sh * ws;
    }
    const hipY = Math.round(sh * 0.62);
    ctx.save();
    ctx.scale(drawScale, drawScale);
    ctx.translate(-sw / 2, -sh);
    ctx.drawImage(img, 0, hipY, sw, sh - hipY, 0, hipY, sw, sh - hipY);                    // gối + bàn chân: giữ nguyên
    ctx.drawImage(img, 0, 0, sw, hipY + 1, 0, drop, sw, hipY + 1 - drop);                  // lưng + đầu: hạ xuống, nén nhẹ
    ctx.restore();
    return (sh - drop) * ws;
  }

  const POSE_KEYS = ['stand', 'walkL', 'walkR'];
  function hasPoseSet(assets, skin) {
    return !!assets && POSE_KEYS.every(k => { const im = assets['pose_' + skin + '_' + k]; return im && im.naturalWidth > 0; });
  }
  function hasKneelSet(assets, skin) {
    return !!assets && ['kneel', 'prostrate'].every(k => { const im = assets['pose_' + skin + '_' + k]; return im && im.naturalWidth > 0; });
  }

  /* =========================================================================
   * 3. LỚP NHÂN VẬT CHÁNH ĐIỆN (CHARACTER CLASS — LERP + PERSPECTIVE + BOWING)
   * ========================================================================= */

  const LOTUS_AURA_DURATION_MS = 5 * 60 * 1000; // 5 phút tri ân dưới chân bồ đoàn

  // Điểm lễ trước bàn thờ: giá trị dự phòng DUY NHẤT phía trình duyệt; giá trị thật lấy từ content.json (layout.altarSpot).
  const ALTAR_DEFAULT = Object.freeze({ x: 540, y: 1350, scale: 0.4 });

  class Character {
    constructor(data, x = 540, y = 2020) {
      this.id = data.id;
      this.name = data.name || 'Phật tử';
      this.skin = data.skin || 'man';
      this.avatar = data.avatar || '';
      this.coins = data.coins || 0;
      this.demo = !!data.demo;

      // Tọa độ & Nội suy Lerp
      this.x = x;
      this.y = y;
      this.targetX = x;
      this.targetY = y;

      // Perspective Scaling
      this.scale = 0.4;
      this.targetScale = 0.4;

      // Trạng thái di chuyển & hành lễ
      this.state = 'walk'; // 'walk' | 'sit'
      this.seat = null;
      this.walkBob = Math.random() * Math.PI * 2;
      this.phase = Math.random() * Math.PI * 2;
      this.fade = 0;
      this.glow = 0;
      this.bubble = null;

      // Trạng thái lên lễ Phật trước bàn thờ (altarSpot)
      this.inCeremony = false;
      this.atAltarSpot = false;
      this.ceremonyAlpha = 1;
      this.ceremonyScale = ALTAR_DEFAULT.scale;
      this.ceremonyX = ALTAR_DEFAULT.x;
      this.ceremonyY = ALTAR_DEFAULT.y;
      this.ceremonyHoldPose = null; // mức cúi 0..1 giữ nguyên khi chắp tay dâng hương

      // Một lần lạy = cúi xuống → giữ → ngẩng lên (thời gian lấy từ ceremony.bow)
      this.bowT = 0;
      this.isBowing = false;
      this.bowQueue = 0;
      this.bowHoldSec = BOW_CFG.holdSec;
      this.bowPauseSec = 0;
      this.bowPauseRemain = 0;
      this.onFinalDeepBow = null;
      this.firedFinalDeepBow = false;
      this.pendingLotusTier = 0;
      this.bowPose = 0; // mức cúi hiện tại 0..1

      // Tư thế đứng/đi bộ khi lên lễ (chỉ dùng cho skin có ảnh pose_*)
      this.poseMix = 0;          // 0 = ảnh ngồi, 1 = ảnh đứng (mờ chéo)
      this.walkControlled = false; // đang đi bộ: CeremonyDirector điều khiển x, y, scale
      this.walkImgKey = 'stand';   // 'stand' | 'walkL' | 'walkR'
      this.walkBobPx = 0;          // nhún nhẹ theo bước chân
      this.kneelMix = 0;           // 0 = ảnh đứng, 1 = ảnh quỳ (mờ chéo); CeremonyDirector điều khiển
      this.prostrateMix = 0;       // 0 = ảnh quỳ, 1 = ảnh lạy sát đất (chỉ có nghĩa khi kneelMix > 0)

      // Hào quang hoa sen 5 phút dưới chân bồ đoàn
      this.lotusAuraUntil = 0;
      this.lotusAuraStart = 0;
      this.lotusAuraTier = 1;
    }

    getEffectiveAlpha() {
      return clamp(this.fade * this.ceremonyAlpha, 0, 1);
    }

    assignSeat(seat, instant = false, floor = { yTop: 1430, yBot: 1870 }, gridCols = 6) {
      this.seat = seat;
      if (!seat) return;
      if (!this.atAltarSpot) {
        this.targetX = seat.x;
        this.targetY = seat.y;
      }
      if (instant && !this.atAltarSpot) {
        this.x = seat.x;
        this.y = seat.y;
        this.state = 'sit';
        this.fade = 1;
        this.scale = this.computePerspectiveScale(floor, gridCols);
        this.targetScale = this.scale;
      }
    }

    triggerBow(count = 1, giftTierForLotus = 0) {
      if (giftTierForLotus > 0) {
        this.pendingLotusTier = Math.max(this.pendingLotusTier, giftTierForLotus);
      }
      // Khi đang hành lễ trên bàn thờ, CeremonyDirector điều khiển riêng nhịp lạy
      if (this.inCeremony) return;
      this.bowHoldSec = BOW_CFG.holdSec;
      this.bowPauseSec = 0;
      this.onFinalDeepBow = null;
      this.bowQueue = Math.min(6, Math.max(this.bowQueue, count));
      if (this.state === 'sit' && !this.isBowing && this.bowQueue > 0) {
        this.startNextBow();
      }
    }

    startCeremonyBows(count = 1, opts = {}) {
      this.bowQueue = Math.max(1, count);
      this.bowHoldSec = Number.isFinite(opts.holdSec) ? Math.max(0, opts.holdSec) : BOW_CFG.holdSec;
      this.bowPauseSec = Math.max(0, opts.pauseBetweenSec || 0);
      this.bowPauseRemain = 0;
      this.onFinalDeepBow = typeof opts.onFinalDeepBow === 'function' ? opts.onFinalDeepBow : null;
      this.firedFinalDeepBow = false;
      this.startNextBow();
    }

    startNextBow() {
      if (this.bowQueue <= 0) return;
      this.bowQueue--;
      this.isBowing = true;
      this.bowT = 0;
      this.firedFinalDeepBow = false;
    }

    activateLotusAura(nowMs, tier = 1) {
      if (nowMs >= this.lotusAuraUntil) {
        this.lotusAuraStart = nowMs;
      }
      this.lotusAuraUntil = nowMs + LOTUS_AURA_DURATION_MS;
      this.lotusAuraTier = Math.max(this.lotusAuraTier || 1, tier);
    }

    computePerspectiveScale(floor, gridCols) {
      const perspectiveFactor = 0.0005;
      const rawPerspective = 1.0 + (this.y - 500) * perspectiveFactor;
      const span = Math.max(1, floor.yBot - floor.yTop);
      const depthNorm = clamp((this.y - floor.yTop) / span, -0.1, 1.25);
      const gridDensity = Math.pow(6 / Math.max(4, gridCols || 6), 0.75);
      return (0.165 * rawPerspective + 0.195 * depthNorm) * gridDensity;
    }

    update(dt, nowMs, floor, gridCols) {
      this.fade = Math.min(1, this.fade + dt * 2.2);
      this.glow = Math.max(0, this.glow - dt * 0.42);

      if (this.walkControlled) {
        this.state = 'sit'; // vị trí & scale do CeremonyDirector đặt mỗi khung
      } else if (this.atAltarSpot) {
        this.x = this.ceremonyX;
        this.y = this.ceremonyY;
        this.targetX = this.ceremonyX;
        this.targetY = this.ceremonyY;
        this.scale = this.ceremonyScale;
        this.targetScale = this.ceremonyScale;
        this.state = 'sit';
      } else if (this.seat) {
        if (this.state === 'walk') {
          const dyToRow = Math.abs(this.y - this.seat.y);
          if (dyToRow > 36) {
            this.targetX = lerp(this.seat.x, 540, 0.72);
            this.targetY = this.seat.y;
          } else {
            this.targetX = this.seat.x;
            this.targetY = this.seat.y;
          }

          this.x = lerpDt(this.x, this.targetX, 0.08, dt);
          this.y = lerpDt(this.y, this.targetY, 0.08, dt);
          this.walkBob += dt * 7.5;

          if (Math.hypot(this.x - this.seat.x, this.y - this.seat.y) < 3.5) {
            this.x = this.seat.x;
            this.y = this.seat.y;
            this.state = 'sit';
            if (!this.demo && !this.inCeremony && this.bowQueue === 0) {
              this.triggerBow(1, 0);
            } else if (this.bowQueue > 0) {
              this.startNextBow();
            }
          }
        } else {
          this.targetX = this.seat.x;
          this.targetY = this.seat.y;
          this.x = lerpDt(this.x, this.targetX, 0.08, dt);
          this.y = lerpDt(this.y, this.targetY, 0.08, dt);
        }

        this.targetScale = this.computePerspectiveScale(floor, gridCols);
        this.scale = lerpDt(this.scale, this.targetScale, 0.08, dt);
      }

      // Tiến trình lạy: cúi xuống → giữ → ngẩng lên, tính trực tiếp từ thời gian (không lerp trễ)
      let holdTarget = null;
      if (this.state === 'sit') {
        if (this.bowPauseRemain > 0) {
          this.bowPauseRemain = Math.max(0, this.bowPauseRemain - dt);
          if (this.bowPauseRemain === 0 && this.bowQueue > 0) this.startNextBow();
        } else if (!this.isBowing && this.bowQueue > 0) {
          this.startNextBow();
        }

        if (this.isBowing) {
          this.bowT += dt;
          // Chuông nhỏ khi chạm đỉnh cúi sâu của lần lạy cuối (!cúng bái)
          if (this.bowQueue === 0 && this.bowT >= BOW_CFG.downSec && !this.firedFinalDeepBow && this.onFinalDeepBow) {
            this.firedFinalDeepBow = true;
            const cb = this.onFinalDeepBow;
            this.onFinalDeepBow = null;
            cb();
          }
          if (this.bowT >= bowTotalSec(this.bowHoldSec)) {
            this.isBowing = false;
            this.bowT = 0;
            this.bowPose = 0;
            if (this.bowQueue > 0) {
              if (this.bowPauseSec > 0) this.bowPauseRemain = this.bowPauseSec;
              else this.startNextBow();
            } else if (this.pendingLotusTier > 0) {
              this.activateLotusAura(nowMs, this.pendingLotusTier);
              this.pendingLotusTier = 0;
            }
          } else {
            this.bowPose = bowPoseAt(this.bowT, this.bowHoldSec);
          }
        } else if (this.ceremonyHoldPose != null) {
          holdTarget = clamp(+this.ceremonyHoldPose || 0, 0, 1);
        }
      } else if (this.isBowing) {
        this.isBowing = false;
      }

      if (!this.isBowing) {
        this.bowPose = lerpDt(this.bowPose, holdTarget || 0, 0.2, dt);
        if (!holdTarget && this.bowPose < 0.003) this.bowPose = 0;
      }
    }

    drawLotusAuraUnderMat(ctx, t, nowMs) {
      if (nowMs >= this.lotusAuraUntil) return;
      const elapsed = (nowMs - this.lotusAuraStart) / 1000;
      const remain = (this.lotusAuraUntil - nowMs) / 1000;
      const fade = clamp(Math.min(elapsed * 1.2, remain / 3.0), 0, 1) * this.getEffectiveAlpha();
      if (fade <= 0.01) return;

      const s = this.scale;
      const rx = 128 * s * (this.lotusAuraTier >= 3 ? 1.18 : 1.04);
      const breath = 1 + 0.045 * Math.sin(t * 1.8 + this.phase);

      ctx.save();
      ctx.translate(this.x, this.y - 12 * s);
      ctx.scale(1, 0.42);
      ctx.globalCompositeOperation = 'lighter';

      const grad = ctx.createRadialGradient(0, 0, rx * 0.1, 0, 0, rx * 1.25 * breath);
      grad.addColorStop(0, `rgba(255, 224, 140, ${(0.52 * fade).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(255, 165, 195, ${(0.28 * fade).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 180, 80, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rx * 1.25 * breath, 0, Math.PI * 2);
      ctx.fill();

      const petalsCount = 12;
      ctx.save();
      ctx.rotate(t * 0.42 + this.phase);
      for (let i = 0; i < petalsCount; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI * 2) / petalsCount);
        ctx.fillStyle = i % 2 === 0
          ? `rgba(255, 212, 118, ${(0.42 * fade).toFixed(3)})`
          : `rgba(255, 168, 196, ${(0.36 * fade).toFixed(3)})`;
        ctx.strokeStyle = `rgba(255, 238, 178, ${(0.58 * fade).toFixed(3)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, rx * 0.36);
        ctx.quadraticCurveTo(rx * 0.22, rx * 0.72, 0, rx * 1.02 * breath);
        ctx.quadraticCurveTo(-rx * 0.22, rx * 0.72, 0, rx * 0.36);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();

      ctx.save();
      ctx.rotate(-t * 0.28);
      ctx.strokeStyle = `rgba(255, 232, 165, ${(0.5 * fade).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, rx * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    }

    draw(ctx, t, nowMs, assets) {
      const ws = this.scale;
      const effAlpha = this.getEffectiveAlpha();
      if (effAlpha <= 0.004) return 260 * ws;

      // 1. Vẽ Vòng Hào Quang Hoa Sen dưới chân bồ đoàn (nếu đang trong 5 phút tri ân hoặc !quỳ lạy)
      this.drawLotusAuraUnderMat(ctx, t, nowMs);

      // 2. Vẽ hào quang thân tâm (khi vừa tặng quà, lên lễ Phật, hoặc skin cao tăng)
      if (this.glow > 0 || this.skin === 'master') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const baseGlow = Math.max(this.glow * 0.75, this.skin === 'master' ? 0.35 + 0.1 * Math.sin(t * 1.6) : 0);
        ctx.globalAlpha = baseGlow * effAlpha;
        const g = ctx.createRadialGradient(this.x, this.y - 110 * ws, 8, this.x, this.y - 110 * ws, 200 * ws);
        g.addColorStop(0, 'rgba(255, 205, 120, 0.95)');
        g.addColorStop(1, 'rgba(255, 160, 60, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(this.x - 230 * ws, this.y - 340 * ws, 460 * ws, 400 * ws);
        ctx.restore();
      }

      // 3. Vẽ nhân vật (biến đổi mượt ảnh gốc khi cúi lạy hoặc nhịp thở thiền định khi ngồi tĩnh)
      const skinImgKey = this.skin === 'master' ? 'monk' : this.skin;
      const baseImg = assets[skinImgKey] || assets.man;
      const walkStepY = this.state === 'walk' ? -Math.abs(Math.sin(this.walkBob)) * 6 * ws : 0;
      const isDeforming = this.bowPose > 0.004;
      const breatheY = (this.state === 'sit' && !isDeforming) ? Math.sin(t * 1.15 + this.phase) * 2.2 * ws : 0;

      ctx.save();
      ctx.globalAlpha = effAlpha;
      ctx.translate(this.x, this.y + walkStepY);
      if (this.state === 'walk') {
        ctx.rotate(Math.sin(this.walkBob) * 0.025);
      }

      let topY = 260 * ws;
      // Tại altarSpot vẽ đúng tỉ lệ các thầy (không nhân scaleBoost 1.05)
      const drawScale = ws * (this.atAltarSpot ? 1 : 1.05);

      // Ảnh đứng/đi bộ (mờ chéo với ảnh ngồi) khi lên lễ; kneel/prostrate tự dùng nếu có đủ file
      const mix = this.poseMix > 0.004 ? clamp(this.poseMix, 0, 1) : 0;
      // Các lớp ảnh tư thế: đứng/đi bộ ↔ quỳ ↔ lạy, trọng số theo kneelMix/prostrateMix (mờ chéo). Vái đứng vẫn dùng ảnh đứng.
      let poseLayers = null;
      if (mix > 0 && hasPoseSet(assets, skinImgKey)) {
        poseLayers = [];
        const kn = hasKneelSet(assets, skinImgKey) ? clamp(this.kneelMix, 0, 1) : 0;
        const pr = kn > 0 ? clamp(this.prostrateMix, 0, 1) : 0;
        const wS = 1 - kn, wK = kn * (1 - pr), wP = kn * pr;
        if (wS > 0.004) poseLayers.push({ kind: 'stand', img: assets['pose_' + skinImgKey + '_' + this.walkImgKey], w: wS });
        if (wK > 0.004) poseLayers.push({ kind: 'kneel', img: assets['pose_' + skinImgKey + '_kneel'], w: wK });
        if (wP > 0.004) poseLayers.push({ kind: 'prostrate', img: assets['pose_' + skinImgKey + '_prostrate'], w: wP, extra: (PROSTRATE_EXTRA[skinImgKey] || 0) * pr });
      }
      const standImg = poseLayers && poseLayers.length ? true : null;
      const sitAlpha = standImg ? effAlpha * (1 - mix) : effAlpha;

      if (sitAlpha > 0.004 && baseImg && baseImg.naturalWidth > 0) {
        ctx.globalAlpha = sitAlpha;
        if (isDeforming) {
          topY = drawBowedCharacter(ctx, baseImg, drawScale, ws, this.bowPose, sitAlpha);
        } else {
          const w = baseImg.naturalWidth * drawScale;
          const h = baseImg.naturalHeight * drawScale;
          ctx.drawImage(baseImg, -w * 0.5, -h + breatheY, w, h);
          topY = baseImg.naturalHeight * ws;
        }
      }
      if (standImg) {
        // bóng elip dưới chân/gối theo bề rộng trung bình của các lớp đang hiện (không nhún theo bước chân)
        let sw = 0;
        for (const L of poseLayers) if (L.img && L.img.naturalWidth) sw += L.w * L.img.naturalWidth * drawScale * (L.kind === 'stand' ? 1 : KNEEL_SCALE);
        if (sw > 1) {
          const sh = getFootShadow(), w = sw * 1.15, h = w * 0.26;
          ctx.globalAlpha = effAlpha * mix * 0.35;
          ctx.drawImage(sh, -w / 2, -h * 0.5, w, h);
        }
        ctx.translate(0, -this.walkBobPx);
        let first = true;
        for (const L of poseLayers) {
          if (!L.img || !L.img.naturalWidth) continue;
          const a = effAlpha * mix * L.w;
          ctx.globalAlpha = a;
          let h;
          if (L.kind === 'stand') h = drawStandCharacter(ctx, L.img, drawScale, ws, this.bowPose, a, skinImgKey);
          else if (L.kind === 'kneel') h = drawKneelCharacter(ctx, L.img, drawScale * KNEEL_SCALE, ws * KNEEL_SCALE);
          else h = drawProstrateCharacter(ctx, L.img, drawScale * KNEEL_SCALE, ws * KNEEL_SCALE, L.extra);
          if (first) { topY = h; first = false; }
        }
      }

      ctx.restore();
      return topY;
    }
  }

  /* =========================================================================
   * 4. LƯ HƯƠNG LỬA & KHÓI TRẦM TƯƠNG TÁC (INCENSE PARTICLE SYSTEM — 3.1)
   * ========================================================================= */

  const SMOKE_TOP_Y = 880; // khói nhang tan hết trước toạ độ y này
  const SMOKE_MAX = 90;    // trần số hạt khói
  const EMBER_MAX = 160;   // trần số tàn lửa

  // Sprite glow khói (thường + vàng): tâm đục 1, mờ dần ra rìa; độ đục từng hạt đặt bằng globalAlpha
  let smokeSprites = null;
  function getSmokeSprites() {
    if (smokeSprites) return smokeSprites;
    const build = (c0, c1) => {
      const S = 128, c = makeCanvas(S, S), x = c.getContext('2d');
      const g = x.createRadialGradient(S / 2, S / 2, S / 2 * 0.08, S / 2, S / 2, S / 2);
      g.addColorStop(0, c0); g.addColorStop(0.55, c1); g.addColorStop(1, 'rgba(220, 212, 200, 0)');
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      return c;
    };
    smokeSprites = {
      normal: build('rgba(244, 235, 218, 1)', 'rgba(225, 216, 204, 0.48)'),
      golden: build('rgba(255, 232, 188, 1)', 'rgba(238, 224, 200, 0.52)'),
    };
    return smokeSprites;
  }

  class IncenseSmokeSystem {
    constructor() {
      this.particles = [];
      this.embers = [];
      this.freeParticles = []; // object pool: hạt hết hạn được tái sử dụng, không tạo object mới mỗi lần
      this.freeEmbers = [];
      this.boostUntil = 0;
      this.boostPeak = 0.85;
      this.boostIntensity = 0;
      this.spawnAcc = 0;
      this.emberAcc = 0;
    }

    boostForSeconds(sec = 6, intensity = 0.94) {
      const now = performance.now();
      const durMs = Math.max(1, +sec || 6) * 1000;
      this.boostUntil = Math.max(this.boostUntil, now + durMs);
      this.boostPeak = Math.max(this.boostPeak, intensity);
      this.boostIntensity = Math.max(this.boostIntensity, intensity * 0.65);

      for (let i = 0; i < 7 && this.embers.length < EMBER_MAX; i++) {
        const e = this.freeEmbers.pop() || {};
        e.ox = (Math.random() - 0.5) * 44;
        e.oy = (Math.random() - 0.5) * 10;
        e.vx = (Math.random() - 0.5) * 26;
        e.vy = -(38 + Math.random() * 68);
        e.age = 0;
        e.life = 1.1 + Math.random() * 1.4;
        e.r = 1.8 + Math.random() * 2.5;
        e.ph = Math.random() * 6.283;
        this.embers.push(e);
      }
    }

    triggerSacredOffering(tier = 2) {
      const extraSec = tier >= 3 ? 22 : 14;
      this.boostForSeconds(extraSec, tier >= 3 ? 1.0 : 0.76);
    }

    updateAndDraw(ctx, dt, t, burnerX, burnerY) {
      const now = performance.now();
      const targetBoost = now < this.boostUntil ? (this.boostPeak || 0.85) : 0;
      if (now >= this.boostUntil && this.boostIntensity < 0.02) this.boostPeak = 0.85;
      this.boostIntensity = lerpDt(this.boostIntensity, targetBoost, now < this.boostUntil ? 0.09 : 0.04, dt);
      const boost = this.boostIntensity;

      // Tốc độ sinh hạt khói: chế độ tĩnh lặng (5 hạt/s) vs chế độ Cúng dường quà lớn (26 hạt/s)
      const rate = 5.5 + boost * 8.8; // boost chỉ tăng ~40% so với trước, tránh tụ thành mảng
      this.spawnAcc += dt * rate;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (this.particles.length < SMOKE_MAX) {
          const stickIdx = (Math.floor(Math.random() * 3) - 1); // 3 nén hương tại lư hương
          const p = this.freeParticles.pop() || {};
          p.x = burnerX + stickIdx * (8 + boost * 4) + (Math.random() - 0.5) * 8;
          p.y = burnerY - 6;
          p.vy = -(36 + Math.random() * 26 + boost * 24);
          p.age = 0;
          p.life = 4.6 + Math.random() * 2.8 + boost * 1.6;
          p.r0 = 3 + Math.random() * 3;
          p.r1 = 14 + Math.random() * 12 + boost * 4; // khói mảnh
          p.seed = Math.random() * 100;
          p.golden = boost > 0.25 && Math.random() < 0.45;
          this.particles.push(p);
        }
      }

      // Sinh tàn lửa nhang lấp lánh khi đang cháy rực
      if (boost > 0.15) {
        this.emberAcc += dt * (8 * boost);
        while (this.emberAcc >= 1) {
          this.emberAcc -= 1;
          if (this.embers.length >= EMBER_MAX) continue;
          const e = this.freeEmbers.pop() || {};
          e.ox = (Math.random() - 0.5) * 30;
          e.oy = -4;
          e.vx = (Math.random() - 0.5) * 20;
          e.vy = -(28 + Math.random() * 48);
          e.age = 0;
          e.life = 0.9 + Math.random() * 1.1;
          e.r = 1.5 + Math.random() * 2.0;
          e.ph = Math.random() * 6.283;
          this.embers.push(e);
        }
      }

      ctx.save();

      // 1. Ánh lửa đỏ cam ấm áp tại đầu 3 nén hương trên lư hương
      const glowAlpha = 0.22 + boost * 0.65 + 0.08 * Math.sin(t * 8.5);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const burnerGlow = ctx.createRadialGradient(burnerX, burnerY, 4, burnerX, burnerY, 48 + boost * 68);
      burnerGlow.addColorStop(0, `rgba(255, 165, 72, ${glowAlpha.toFixed(3)})`);
      burnerGlow.addColorStop(0.5, `rgba(255, 105, 35, ${(glowAlpha * 0.45).toFixed(3)})`);
      burnerGlow.addColorStop(1, 'rgba(255, 80, 20, 0)');
      ctx.fillStyle = burnerGlow;
      ctx.beginPath();
      ctx.arc(burnerX, burnerY, 48 + boost * 68, 0, Math.PI * 2);
      ctx.fill();

      // Đầu nhang đỏ rực
      const sticks = boost > 0.1 ? [-12, 0, 12] : [0];
      for (const sx of sticks) {
        ctx.fillStyle = `rgba(255, 210, 120, ${(0.65 + 0.3 * boost).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(burnerX + sx, burnerY - 8, 2.5 + boost * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 2. Vẽ các dải hạt khói trầm bay lên theo Perlin Noise + Sine Wave drift (1 sprite glow dựng sẵn, không tạo gradient mỗi hạt)
      const sprites = getSmokeSprites();
      let w = 0;
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        p.age += dt;
        const u = p.age / p.life;
        if (u >= 1) { this.freeParticles.push(p); continue; }

        // Kết hợp Perlin Noise 2D và Sine Wave tạo đường cong khói trầm mềm mại tự nhiên
        const nVal = perlin2D(p.seed + p.y * 0.0085, t * 0.42 + p.seed * 0.3);
        const sineDrift = Math.sin(u * 5.2 + p.seed) * (14 + u * 26);
        const vx = nVal * (38 + boost * 32) + sineDrift * 0.65;

        p.x += vx * dt;
        p.y += p.vy * (1 - u * 0.25) * dt;

        const radius = lerp(p.r0, p.r1, easeOutCubic(u));
        const env = u < 0.16 ? (u / 0.16) : Math.pow(1 - (u - 0.16) / 0.84, 1.45);
        // Khói tan hết trước SMOKE_TOP_Y: mờ dần trong 70px cuối rồi xoá hạt
        const heightFade = clamp((p.y - SMOKE_TOP_Y) / 70, 0, 1);
        if (heightFade <= 0) { this.freeParticles.push(p); continue; }
        const alpha = Math.min(0.35, env * (0.17 + boost * 0.16)) * heightFade; // độ đục tối đa 0.35

        ctx.globalAlpha = alpha;
        ctx.drawImage((p.golden && u < 0.45) ? sprites.golden : sprites.normal, p.x - radius, p.y - radius, radius * 2, radius * 2);
        this.particles[w++] = p;
      }
      this.particles.length = w;
      ctx.globalAlpha = 1;

      // 3. Vẽ các hạt tàn lửa hương vàng cam bay lên
      ctx.globalCompositeOperation = 'lighter';
      let we = 0;
      for (let i = 0; i < this.embers.length; i++) {
        const e = this.embers[i];
        e.age += dt;
        const u = e.age / e.life;
        if (u >= 1) { this.freeEmbers.push(e); continue; }
        e.ox += (e.vx + Math.sin(t * 9 + e.ph) * 14) * dt;
        e.oy += e.vy * dt;
        const ex = burnerX + e.ox;
        const ey = burnerY + e.oy;
        ctx.fillStyle = `rgba(255, 196, 92, ${((1 - u) * 0.9).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(ex, ey, e.r * (1 - u * 0.5), 0, Math.PI * 2);
        ctx.fill();
        this.embers[we++] = e;
      }
      this.embers.length = we;

      ctx.restore();
    }
  }

  /* =========================================================================
   * 5. SỔ VÀNG CÔNG ĐỨC CUỘN THƯ PHÁP 2.5D (2.5D SILK SCROLL — 3.2)
   * ========================================================================= */

  class SilkMeritScroll {
    constructor() {
      this.cfg = null;   // chuỗi + toạ độ từ content.json (meritScroll), server gửi kèm snapshot
      this.queue = [];
      this.current = null;
      this.timer = 0;
    }

    configure(cfg) { this.cfg = cfg || null; }

    enqueue(donation) {
      if (!this.cfg || this.queue.length >= 6) return;
      this.queue.push({
        name: String(donation.name || 'Phật tử').slice(0, 22),
        giftName: String(donation.giftName || 'Hoa Sen').slice(0, 28),
        count: donation.count || 1,
        coins: donation.coins || 1,
        total: donation.total || donation.coins || 1,
      });
    }

    _shadowSprite(maxHalfW, scrollH) {
      const key = maxHalfW + '|' + scrollH;
      if (this._shadowKey !== key) {
        const PAD = 64, w = maxHalfW * 2 + PAD * 2, h = scrollH - 12 + PAD * 2 + 14;
        const c = makeCanvas(w, h), x = c.getContext('2d');
        x.shadowColor = 'rgba(0, 0, 0, 0.68)';
        x.shadowBlur = 32;
        x.shadowOffsetY = 14;
        x.fillStyle = 'rgba(30, 12, 4, 0.35)';
        x.fillRect(PAD, PAD, maxHalfW * 2, scrollH - 12);
        this._shadowKey = key; this._shadowImg = c; this._shadowPad = PAD;
      }
      return this._shadowImg;
    }

    _drawShadow(ctx, cx, topY, halfW, maxHalfW, scrollH) {
      const img = this._shadowSprite(maxHalfW, scrollH), PAD = this._shadowPad, W = img.width, H = img.height;
      const x0 = cx - halfW - PAD, y0 = topY + 6 - PAD, dstW = halfW * 2 + PAD * 2, cap = PAD + 48;
      if (dstW >= cap * 2 && W > cap * 2) {
        ctx.drawImage(img, 0, 0, cap, H, x0, y0, cap, H);
        ctx.drawImage(img, cap, 0, W - cap * 2, H, x0 + cap, y0, dstW - cap * 2, H);
        ctx.drawImage(img, W - cap, 0, cap, H, x0 + dstW - cap, y0, cap, H);
      } else {
        ctx.drawImage(img, 0, 0, W, H, x0, y0, dstW, H);
      }
    }

    updateAndDraw(ctx, dt, t, lotusImg) {
      if (!this.current && this.queue.length > 0) {
        this.current = this.queue.shift();
        this.timer = 0;
      }
      if (!this.current) return;

      this.timer += dt;
      // Timeline 8.8 giây:
      // 0.0 -> 1.0s: Mở trục lụa sang 2 bên (Unroll)
      // 1.0 -> 3.2s: Hiệu ứng bút lông thư pháp viết tên & lễ vật + đóng ấn triện đỏ
      // 3.2 -> 7.8s: Giữ trang nghiêm với sóng lụa 2.5D nhẹ
      // 7.8 -> 8.8s: Thu trục lụa đóng lại
      const totalDur = 8.8;
      if (this.timer >= totalDur) {
        this.current = null;
        return;
      }

      let openRatio = 1;
      let alpha = 1;
      if (this.timer < 1.0) {
        openRatio = easeOutCubic(this.timer / 1.0);
        alpha = clamp(this.timer * 2.5, 0, 1);
      } else if (this.timer > 7.8) {
        const closeT = (this.timer - 7.8) / 1.0;
        openRatio = 1 - easeInOutSine(closeT);
        alpha = clamp((1 - closeT) * 2.2, 0, 1);
      }

      const writeProgress = clamp((this.timer - 0.95) / 2.1, 0, 1);
      const sealProgress = clamp((this.timer - 2.85) / 0.35, 0, 1);

      const C = this.cfg;
      const cx = C.x;
      const cy = (Number.isFinite(C.top) ? C.top : 1000) + C.height * 0.5;   // C.top = đỉnh Sổ Vàng (layout.meritScroll.top)
      const maxHalfW = C.halfW;
      const halfW = Math.max(16, maxHalfW * openRatio);
      const scrollH = C.height;
      const topY = cy - scrollH * 0.5;
      const botY = cy + scrollH * 0.5;
      const waveY = Math.sin(t * 2.1) * 2.5;

      ctx.save();
      ctx.globalAlpha = alpha;

      // 1. Bóng đổ 2.5D sau bức trướng lụa: sprite vẽ sẵn (shadowBlur chỉ chạy một lần lúc dựng), cắt 3 phần theo chiều ngang khi cuộn đang mở
      this._drawShadow(ctx, cx, topY, halfW, maxHalfW, scrollH);

      // 2. Thân lụa gấm vàng (chỉ vẽ khi đã hé mở)
      if (halfW > 20) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - halfW, topY + waveY);
        ctx.quadraticCurveTo(cx, topY - 5 - waveY, cx + halfW, topY + waveY);
        ctx.lineTo(cx + halfW, botY + waveY);
        ctx.quadraticCurveTo(cx, botY + 5 - waveY, cx - halfW, botY + waveY);
        ctx.closePath();
        ctx.clip();

        // Nền lụa gấm hoàng kim 2.5D (sáng ở tâm, đổ bóng nhẹ sát 2 trục cuốn)
        const silkGrad = ctx.createLinearGradient(cx - halfW, cy, cx + halfW, cy);
        silkGrad.addColorStop(0.00, '#c89b54');
        silkGrad.addColorStop(0.08, '#edd6a4');
        silkGrad.addColorStop(0.50, '#fbf0d4');
        silkGrad.addColorStop(0.92, '#edd6a4');
        silkGrad.addColorStop(1.00, '#c89b54');
        ctx.fillStyle = silkGrad;
        ctx.fillRect(cx - halfW, topY - 12, halfW * 2, scrollH + 24);

        // Vân lụa mảnh ngang
        ctx.strokeStyle = 'rgba(165, 115, 42, 0.09)';
        ctx.lineWidth = 1;
        for (let y = topY + 18; y < botY - 14; y += 9) {
          ctx.beginPath();
          ctx.moveTo(cx - halfW, y);
          ctx.lineTo(cx + halfW, y);
          ctx.stroke();
        }

        // Viền gấm đỏ son kim tuyến trên & dưới
        ctx.fillStyle = '#7d1e14';
        ctx.fillRect(cx - halfW, topY - 8, halfW * 2, 22);
        ctx.fillRect(cx - halfW, botY - 14, halfW * 2, 22);
        ctx.strokeStyle = '#e5b553';
        ctx.lineWidth = 2.2;
        ctx.strokeRect(cx - halfW + 4, topY + 16, halfW * 2 - 8, scrollH - 32);

        // Hoa văn hoa sen chìm ở tâm cuộn lụa
        if (lotusImg && lotusImg.naturalWidth > 0) {
          ctx.save();
          ctx.globalAlpha = 0.11;
          const ls = 140;
          ctx.drawImage(lotusImg, cx - ls / 2, cy - ls / 2 + 4, ls, ls);
          ctx.restore();
        }

        // 3. Hiệu ứng viết chữ Thư Pháp bằng cọ mực tàu & nhũ vàng (Progressive Brush Reveal)
        if (writeProgress > 0.01) {
          const revealW = (halfW * 2 - 48) * easeOutCubic(writeProgress);
          const leftTextEdge = cx - maxHalfW + 24;

          ctx.save();
          ctx.beginPath();
          ctx.rect(leftTextEdge, topY + 14, revealW, scrollH - 28);
          ctx.clip();

          // Dòng tiêu đề Sổ Vàng Công Đức
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '700 24px "Noto Serif", Georgia, serif';
          ctx.fillStyle = '#8b1e12';
          ctx.fillText(C.title, cx, topY + 42);

          // Tên Phật tử phong cách thư pháp trang trọng
          ctx.font = 'italic 700 42px "Noto Serif", Georgia, serif';
          ctx.fillStyle = '#241006';
          ctx.fillText(`${C.namePrefix} ${this.current.name}`.trim(), cx, cy - 2);

          // Lễ vật & Điểm công đức
          const timesTxt = this.current.count > 1 ? ` ×${this.current.count}` : '';
          ctx.font = '600 25px "Be Vietnam Pro", system-ui, sans-serif';
          ctx.fillStyle = '#6b2410';
          ctx.fillText(
            C.offering.replace(/\{(\w+)\}/g, (m, k) => ({ gift: this.current.giftName, times: timesTxt, total: this.current.total })[k] ?? m),
            cx,
            cy + 44
          );

          // Lời chúc hồi hướng ngắn
          ctx.font = 'italic 20px "Noto Serif", Georgia, serif';
          ctx.fillStyle = '#5c3d1e';
          ctx.fillText(C.blessing, cx, botY - 30);

          ctx.restore();

          // Điểm sáng đầu bút lông đang viết chữ
          if (writeProgress < 0.99) {
            const brushX = clamp(leftTextEdge + revealW, cx - halfW + 16, cx + halfW - 16);
            const brushY = cy + Math.sin(writeProgress * 22) * 18;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const bg = ctx.createRadialGradient(brushX, brushY, 2, brushX, brushY, 26);
            bg.addColorStop(0, 'rgba(255, 215, 110, 0.95)');
            bg.addColorStop(1, 'rgba(255, 160, 40, 0)');
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.arc(brushX, brushY, 26, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        // 4. Ấn Triện Đỏ "PHƯỚC BÁU" đóng xuống góc phải cuộn thư pháp
        if (sealProgress > 0.01) {
          const sealScale = 1.65 - 0.65 * easeOutCubic(sealProgress);
          const sx = cx + maxHalfW - 82;
          const sy = cy + 6;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(-0.08);
          ctx.scale(sealScale, sealScale);
          ctx.globalAlpha *= clamp(sealProgress * 1.5, 0, 0.88);
          ctx.strokeStyle = '#b41e14';
          ctx.lineWidth = 3.2;
          ctx.strokeRect(-32, -32, 64, 64);
          ctx.lineWidth = 1.2;
          ctx.strokeRect(-27, -27, 54, 54);
          ctx.fillStyle = 'rgba(180, 30, 20, 0.12)';
          ctx.fillRect(-27, -27, 54, 54);
          ctx.fillStyle = '#b41e14';
          ctx.font = '700 15px "Noto Serif", Georgia, serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(C.sealTop, 0, -9);
          ctx.fillText(C.sealBottom, 0, 11);
          ctx.restore();
        }

        ctx.restore();
      }

      // 5. Hai trục cuốn gỗ trầm nạm vàng 2.5D ở 2 bên (Left & Right Cylindrical Rollers)
      const drawRoller = (rx) => {
        const rw = 24;
        const rh = scrollH + 34;
        const ry = cy - rh * 0.5;

        ctx.save();
        // Thân trục gỗ trầm 3D
        const rg = ctx.createLinearGradient(rx - rw / 2, ry, rx + rw / 2, ry);
        rg.addColorStop(0.0, '#261007');
        rg.addColorStop(0.32, '#6e3219');
        rg.addColorStop(0.55, '#a1542c');
        rg.addColorStop(0.85, '#3b180b');
        rg.addColorStop(1.0, '#1c0a04');
        ctx.fillStyle = rg;
        ctx.strokeStyle = '#e2b04f';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(rx - rw / 2, ry, rw, rh, 8);
        else ctx.rect(rx - rw / 2, ry, rw, rh);
        ctx.fill();
        ctx.stroke();

        // Đầu trục nạm vàng kim ở 2 đầu trên/dưới
        ctx.fillStyle = '#e7b958';
        ctx.fillRect(rx - rw / 2 - 2, ry - 8, rw + 4, 12);
        ctx.fillRect(rx - rw / 2 - 2, ry + rh - 4, rw + 4, 12);

        // Nút ngọc tròn trên đỉnh trục
        ctx.beginPath();
        ctx.arc(rx, ry - 13, 8, 0, Math.PI * 2);
        ctx.arc(rx, ry + rh + 13, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd98a';
        ctx.fill();
        ctx.restore();
      };

      drawRoller(cx - halfW);
      drawRoller(cx + halfW);

      ctx.restore();
    }
  }

  /* =========================================================================
   * 6. ÁNH SÁNG & THỜI TIẾT CHÁNH ĐIỆN REALTIME (DAY / NIGHT AMBIENT — 3.3)
   *    - Ban ngày (06:00 - 17:59): Vệt nắng cửa sổ (Light Beams 'lighter') + hạt bụi nắng
   *    - Ban đêm  (18:00 - 05:59): Hạ tông ấm tĩnh mịch + Nến lung linh & Đèn dầu ấm áp
   * ========================================================================= */

  class AmbientLightingSystem {
    constructor() {
      this.motes = [];
      for (let i = 0; i < 38; i++) {
        this.motes.push({
          x: 120 + Math.random() * 840,
          y: 260 + Math.random() * 1100,
          vx: (Math.random() - 0.5) * 10,
          vy: -(6 + Math.random() * 12),
          r: 1.4 + Math.random() * 2.5,
          phase: Math.random() * Math.PI * 2,
        });
      }
      // Vị trí các ngọn nến / đèn dầu trên bàn thờ chánh điện khi về đêm
      this.candles = [
        { x: 248, y: 1035, scale: 1.0, seed: 1.1 },
        { x: 375, y: 995, scale: 0.9, seed: 2.7 },
        { x: 705, y: 995, scale: 0.9, seed: 4.3 },
        { x: 832, y: 1035, scale: 1.0, seed: 5.9 },
        { x: 185, y: 1290, scale: 0.85, seed: 7.4 },
        { x: 895, y: 1290, scale: 0.85, seed: 9.2 },
      ];
    }

    isDaytime(mode = 'auto') {
      if (mode === 'day') return true;
      if (mode === 'night') return false;
      const hour = new Date().getHours();
      return hour >= 6 && hour <= 17;
    }

    // Lớp phủ đêm thâm nghiêm viền ngoài (giữ sáng ấm vùng bàn thờ trung tâm). Tĩnh: overlay vẽ sẵn vào lớp nền (opts.shadeBaked).
    drawNightShade(ctx) {
      ctx.save();
      const nightShade = ctx.createRadialGradient(540, 960, 260, 540, 960, 1120);
      nightShade.addColorStop(0.0, 'rgba(10, 8, 20, 0.06)');
      nightShade.addColorStop(0.65, 'rgba(8, 6, 18, 0.28)');
      nightShade.addColorStop(1.0, 'rgba(5, 4, 14, 0.48)');
      ctx.fillStyle = nightShade;
      ctx.fillRect(0, 0, 1080, 1920);
      ctx.restore();
    }

    drawBackgroundLighting(ctx, dt, t, mode = 'auto', opts = {}) {
      const isDay = this.isDaytime(mode);

      if (isDay) {
        // --- BAN NGÀY (06:00 - 17:59): Nắng sớm/chiều xuyên qua ô cửa sổ chánh điện ---
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        const beams = [
          { x0: -40, y0: 240, w0: 150, x1: 420, y1: 1420, w1: 310, a: 0.085, phase: 0.0 },
          { x0: -20, y0: 470, w0: 120, x1: 540, y1: 1580, w1: 260, a: 0.068, phase: 1.6 },
          { x0: 990, y0: 260, w0: 140, x1: 610, y1: 1400, w1: 290, a: 0.062, phase: 3.1 },
        ];

        for (const b of beams) {
          const pulse = 0.82 + 0.18 * Math.sin(t * 0.45 + b.phase);
          const alpha = b.a * pulse;
          const grad = ctx.createLinearGradient(b.x0, b.y0, b.x1, b.y1);
          grad.addColorStop(0.0, `rgba(255, 240, 195, ${(alpha * 1.25).toFixed(3)})`);
          grad.addColorStop(0.55, `rgba(255, 224, 156, ${(alpha * 0.65).toFixed(3)})`);
          grad.addColorStop(1.0, 'rgba(255, 210, 130, 0)');

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(b.x0, b.y0);
          ctx.lineTo(b.x0 + b.w0, b.y0);
          ctx.lineTo(b.x1 + b.w1, b.y1);
          ctx.lineTo(b.x1, b.y1);
          ctx.closePath();
          ctx.fill();
        }

        // Hạt bụi vàng lơ lửng trong nắng thiền đường
        for (const m of this.motes) {
          m.x += (m.vx + Math.sin(t * 0.7 + m.phase) * 6) * dt;
          m.y += m.vy * dt;
          if (m.y < 240) {
            m.y = 1350;
            m.x = 120 + Math.random() * 840;
          }
          const twinkle = 0.25 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(t * 1.9 + m.phase), 2);
          ctx.fillStyle = `rgba(255, 238, 182, ${(twinkle * 0.55).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      } else {
        // --- BAN ĐÊM (18:00 - 05:59): Hạ tông tĩnh mịch + Nến lung linh & Đèn dầu ấm áp ---
        if (!opts.shadeBaked) this.drawNightShade(ctx);

        // Hiệu ứng ánh đèn dầu ấm áp & nến lung linh trên bàn thờ
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const c of this.candles) {
          const flicker = 0.82
            + 0.11 * Math.sin(t * 7.7 + c.seed)
            + 0.07 * Math.sin(t * 17.3 + c.seed * 2.1)
            + 0.05 * perlin2D(c.seed, t * 3.5);
          const swayX = Math.sin(t * 4.6 + c.seed) * 2.2;
          const r = 135 * c.scale * flicker;

          // Quầng sáng đèn dầu ấm
          const halo = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, r);
          halo.addColorStop(0.0, `rgba(255, 214, 128, ${(0.42 * flicker).toFixed(3)})`);
          halo.addColorStop(0.4, `rgba(255, 146, 48, ${(0.20 * flicker).toFixed(3)})`);
          halo.addColorStop(1.0, 'rgba(255, 100, 20, 0)');
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
          ctx.fill();

          // Ngọn bấc lửa nến lung linh
          const fh = 18 * c.scale * flicker;
          const fw = 5.5 * c.scale;
          ctx.fillStyle = 'rgba(255, 242, 190, 0.92)';
          ctx.beginPath();
          ctx.moveTo(c.x, c.y + 4);
          ctx.quadraticCurveTo(c.x - fw, c.y - fh * 0.4, c.x + swayX, c.y - fh);
          ctx.quadraticCurveTo(c.x + fw, c.y - fh * 0.4, c.x, c.y + 4);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  /* =========================================================================
   * 7. ĐIỀU KHIỂN CAMERA ZOOM VÀO PHẬT TỬ (SMOOTH LERP 1.0 → 1.6, TÊN TO + VIỀN SÁNG)
   * ========================================================================= */

  class CameraZoomController {
    constructor() {
      this.active = false;
      this.phase = 'idle'; // 'idle' | 'hold' | 'out'
      this.targetId = null;
      this.scaleFrom = 1.0;
      this.scaleTo = 1.6;
      this.holdSec = 5.0;
      this.outSec = 1.5;
      this.elapsed = 0;

      this.scale = 1.0;
      this.focusX = 540;
      this.focusY = 960;

      this.outStartScale = 1.0;
      this.outStartX = 540;
      this.outStartY = 960;
      this.highlightAlpha = 0;
    }

    trigger(opts, charObj) {
      if (!charObj || charObj.inCeremony) return;
      if (!this.active) {
        this.scale = opts.scaleFrom || 1.0;
        this.focusX = 540;
        this.focusY = 960;
      }
      this.active = true;
      this.phase = 'hold';
      this.targetId = opts.id;
      this.scaleFrom = opts.scaleFrom || 1.0;
      this.scaleTo = opts.scaleTo || 1.6;
      this.holdSec = opts.holdSec || 5.0;
      this.outSec = opts.outSec || 1.5;
      this.elapsed = 0;
    }

    beginReturn() {
      if (!this.active || this.phase === 'out') return;
      this.phase = 'out';
      this.elapsed = 0;
      this.outStartScale = this.scale;
      this.outStartX = this.focusX;
      this.outStartY = this.focusY;
    }

    update(dt, visitorsMap, zoomEnabled = true, silentActive = false) {
      if (!this.active) {
        this.scale = 1.0;
        this.focusX = 540;
        this.focusY = 960;
        this.highlightAlpha = 0;
        return;
      }

      if (this.phase === 'hold') {
        const v = visitorsMap.get(this.targetId);
        // Không zoom khi tắt zoom, trong 5 phút thiền im lặng, hoặc người đang ở điểm lễ altarSpot
        if (!zoomEnabled || silentActive || !v || v.inCeremony) {
          this.beginReturn();
        } else {
          this.elapsed += dt;
          const halfW = 540 / this.scaleTo;
          const halfH = 960 / this.scaleTo;
          const desiredX = clamp(v.x, halfW, 1080 - halfW);
          const desiredY = clamp(v.y - 125 * v.scale, halfH, 1920 - halfH);

          this.scale = lerpDt(this.scale, this.scaleTo, 0.085, dt);
          this.focusX = lerpDt(this.focusX, desiredX, 0.085, dt);
          this.focusY = lerpDt(this.focusY, desiredY, 0.085, dt);
          this.highlightAlpha = clamp(this.highlightAlpha + dt * 3.0, 0, 1);

          if (this.elapsed >= this.holdSec) {
            this.beginReturn();
          }
        }
      }

      if (this.phase === 'out') {
        this.elapsed += dt;
        const dur = Math.max(0.1, this.outSec);
        const k = easeInOutSine(this.elapsed / dur);
        this.scale = lerp(this.outStartScale, this.scaleFrom, k);
        this.focusX = lerp(this.outStartX, 540, k);
        this.focusY = lerp(this.outStartY, 960, k);
        this.highlightAlpha = clamp(1 - k * 1.4, 0, 1);

        if (this.elapsed >= dur) {
          this.active = false;
          this.phase = 'idle';
          this.targetId = null;
          this.scale = this.scaleFrom;
          this.focusX = 540;
          this.focusY = 960;
          this.highlightAlpha = 0;
        }
      }
    }

    applyTransform(ctx) {
      ctx.save();
      if (!this.active || Math.abs(this.scale - 1.0) <= 0.001) return;
      const s = this.scale;
      const cx = clamp(this.focusX, 540 / s, 1080 - 540 / s);
      const cy = clamp(this.focusY, 960 / s, 1920 - 960 / s);
      ctx.translate(540, 960);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
    }

    restoreTransform(ctx) {
      ctx.restore();
    }

    isHighlighting(v) {
      return this.active && this.highlightAlpha > 0.02 && v && v.id === this.targetId && !v.inCeremony;
    }

    _ringSprite(rOuter) {
      this._ringCache ||= new SpriteCache(24);
      return this._ringCache.get(rOuter, () => {
        const PADR = 40, W = (rOuter + PADR) * 2, H = (rOuter * 0.42 + PADR) * 2;
        const c = makeCanvas(W, H), x = c.getContext('2d');
        x.globalCompositeOperation = 'lighter';           // giống cách vẽ gốc: cộng sáng
        x.translate(c.width / 2, c.height / 2);
        x.scale(1, 0.42);
        x.shadowColor = '#ffd875';
        x.shadowBlur = 18;
        x.strokeStyle = '#fff2be';
        x.lineWidth = 3.2;
        x.beginPath();
        x.arc(0, 0, rOuter * 132 / 152, 0, Math.PI * 2);
        x.stroke();
        x.strokeStyle = 'rgba(226, 176, 79, 0.85)';
        x.lineWidth = 1.8;
        x.beginPath();
        x.arc(0, 0, rOuter, 0, Math.PI * 2);
        x.stroke();
        return c;
      });
    }

    // Quầng sáng quanh thẻ tên zoom: chỉ phần bóng (dựng bằng shadowBlur một lần, cache theo kích thước làm tròn + các mức nhấp nháy)
    _plateGlow(w, h, blur) {
      this._glowCache ||= new SpriteCache(40);
      const wq = Math.max(8, Math.round(w / 6) * 6), bq = Math.max(6, Math.round(blur / 2) * 2), hq = Math.round(h);
      const PAD = 56;
      const img = this._glowCache.get(wq + '|' + hq + '|' + bq, () => {
        const OFF = wq + PAD * 2 + 80;
        const c = makeCanvas(wq + PAD * 2, hq + PAD * 2), x = c.getContext('2d');
        x.shadowColor = 'rgba(255, 218, 120, 0.95)';
        x.shadowBlur = bq;
        x.shadowOffsetX = OFF;                              // vẽ hình ngoài khung, chỉ giữ lại bóng
        x.fillStyle = 'rgba(0, 0, 0, 0.96)';
        x.beginPath();
        if (x.roundRect) x.roundRect(PAD - OFF, PAD, wq, hq, hq / 2); else x.rect(PAD - OFF, PAD, wq, hq);
        x.fill();
        return c;
      });
      return { img, pad: PAD, wq, hq };
    }

    drawCharacterAuraRing(ctx, v, t) {
      if (!this.isHighlighting(v)) return;
      const a = this.highlightAlpha;
      const ws = v.scale;
      const pulse = 1 + 0.04 * Math.sin(t * 4.2);

      ctx.save();
      // Hào quang viền sáng quanh thân nhân vật
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * a;
      const g = ctx.createRadialGradient(v.x, v.y - 115 * ws, 10 * ws, v.x, v.y - 115 * ws, 235 * ws * pulse);
      g.addColorStop(0, 'rgba(255, 232, 160, 0.85)');
      g.addColorStop(0.55, 'rgba(255, 192, 92, 0.35)');
      g.addColorStop(1, 'rgba(255, 165, 60, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(v.x, v.y - 115 * ws, 235 * ws * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Vòng viền sáng hoàng kim dưới chân bồ đoàn: sprite vẽ sẵn theo bán kính (làm tròn 3px), không shadowBlur mỗi khung
      ctx.globalAlpha = 0.92 * a;
      const ring = this._ringSprite(Math.max(6, Math.round(152 * ws * pulse / 3) * 3));
      ctx.drawImage(ring, v.x - ring.width / 2, v.y - 10 * ws - ring.height / 2);
      ctx.restore();
    }

    drawZoomedNameplate(ctx, v, topY, t, avImg) {
      if (!this.isHighlighting(v)) return false;
      const a = this.highlightAlpha;
      const ws = v.scale;
      const fs = Math.max(26, Math.round(44 * ws / 0.4));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `700 ${fs}px "Noto Serif", Georgia, serif`;

      const text = v.name || 'Phật tử';
      const padX = fs * 0.72;
      const aw = avImg ? fs * 1.2 : 0;
      const textW = ctx.measureText(text).width;
      const w = textW + padX * 2 + aw;
      const h = fs * 1.68;
      const x = v.x;
      const y = v.y - topY - 24 * ws / 0.4 - h * 0.25;
      const pulseGlow = 16 + 6 * Math.sin(t * 4.5);

      // Nền sơn mài trầm ấm + viền sáng kép rực rỡ (quầng sáng là sprite vẽ sẵn)
      const glow = this._plateGlow(w, h, pulseGlow);
      ctx.drawImage(glow.img, x - glow.wq / 2 - glow.pad, y - glow.hq / 2 - glow.pad);
      const bg = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
      bg.addColorStop(0, 'rgba(92, 32, 12, 0.96)');
      bg.addColorStop(1, 'rgba(38, 14, 6, 0.96)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
      else ctx.rect(x - w / 2, y - h / 2, w, h);
      ctx.fill();

      ctx.lineWidth = 3.4;
      ctx.strokeStyle = '#fff0b5';
      ctx.stroke();

      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(226, 176, 79, 0.9)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2 + 4, y - h / 2 + 4, w - 8, h - 8, (h - 8) / 2);
      else ctx.rect(x - w / 2 + 4, y - h / 2 + 4, w - 8, h - 8);
      ctx.stroke();

      if (avImg) {
        const ax = x - w / 2 + padX * 0.65 + aw * 0.5;
        ctx.save();
        ctx.beginPath();
        ctx.arc(ax, y, fs * 0.52, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avImg, ax - fs * 0.52, y - fs * 0.52, fs * 1.04, fs * 1.04);
        ctx.restore();
      }

      ctx.fillStyle = '#fff4d2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + aw * 0.45, y + 1);
      ctx.restore();
      return a > 0.65;
    }
  }

  /* =========================================================================
   * 8. ĐIỀU PHỐI NGHI LỄ LÊN LỄ PHẬT TRƯỚC BÀN THỜ (CEREMONY DIRECTOR)
   *    - Lệnh: !thắp nhang (incense), !cúng bái (worship), !quỳ lạy (prostrate)
   *    - Mờ dần ở chỗ ngồi (0.6s) → hiện tại altarSpot (0.6s) → hành lễ →
   *      mờ dần tại altarSpot (0.6s) → hiện lại ở chỗ ngồi cũ (0.6s).
   *    - Có ảnh pose (assets/pose_<skin>_*): ngồi → đứng dậy → đi lối giữa tới altarSpot → vái đứng → mờ → về chỗ ngồi.
   * ========================================================================= */

  const KNEEL_PHASES = new Set(['kneel_down', 'kneel_bow', 'kneel_up', 'kneel_tail']);

  class CeremonyDirector {
    constructor() {
      this.active = false;
      this.viewerId = null;
      this.kind = 'incense';
      this.phase = 'idle'; // 'idle' | 'fade_out_seat' | 'fade_in_altar' | 'perform' | 'fade_out_altar' | 'fade_in_seat'
      this.timer = 0;
      this.subStep = 0;
      this.fadeSec = 0.6;
      this.incenseBoostSec = 6.0;
      this.incenseHoldSec = 2.2;
      this.tailSec = 0.35;
      this.sinceStart = 0;
      this.performDeadline = Infinity;
      this.outFrom = 1;
      this.inFrom = 0;
      this.pending = null; // phiên kế tiếp nếu phiên trước chưa khép kịp

      this.altarX = ALTAR_DEFAULT.x;
      this.altarY = ALTAR_DEFAULT.y;
      this.altarScale = ALTAR_DEFAULT.scale;

      // Chế độ ảnh tư thế (đứng dậy → đi bộ → vái đứng); overlay gán assets + gridRows trước khi start()
      this.assets = null;
      this.gridRows = 4;
      this.poseMode = false;
      this.walk = null;       // { sec, stepSec, riseSec, bobPx, laneFrac } do server tính
      this.path = null;       // { pts: [{x,y}], len, scale0 }
      this.kneel = null;      // { downSec, upSec, prostrateFadeSec } khi lễ bằng ảnh quỳ + lạy (chỉ !cúng bái, !quỳ lạy)
      this.kb = null;         // tiến trình các lạy: { n, i, stage, holdSec, bellDone }
    }

    _resetPose(v) {
      v.poseMix = 0;
      v.walkControlled = false;
      v.walkImgKey = 'stand';
      v.walkBobPx = 0;
      v.kneelMix = 0;
      v.prostrateMix = 0;
    }

    _restore(v) {
      v.inCeremony = false;
      v.atAltarSpot = false;
      v.ceremonyAlpha = 1;
      v.ceremonyHoldPose = null;
      v.isBowing = false;
      v.bowQueue = 0;
      v.bowPauseRemain = 0;
      v.onFinalDeepBow = null;
      this._resetPose(v);
      if (v.seat) {
        v.x = v.seat.x;
        v.y = v.seat.y;
        v.targetX = v.seat.x;
        v.targetY = v.seat.y;
        v.state = 'sit';
      }
    }

    reset(visitorsMap) {
      if (this.viewerId && visitorsMap) {
        const prev = visitorsMap.get(this.viewerId);
        if (prev) this._restore(prev);
      }
      this.active = false;
      this.viewerId = null;
      this.phase = 'idle';
      this.timer = 0;
      this.subStep = 0;
      this.pending = null;
    }

    // Lệnh mới đến khi phiên trước chưa xong: phiên trước kết thúc mượt trong ~0.4s rồi mới bắt đầu phiên mới
    start(msg, visitorsMap, altarSpotCfg, floor, gridCols) {
      if (!visitorsMap.get(msg.id)) return false;
      if (this.active) {
        this.pending = { msg, visitorsMap, altarSpotCfg, floor, gridCols };
        this._abort(visitorsMap);
        return true;
      }
      return this._begin(msg, visitorsMap, altarSpotCfg, floor, gridCols);
    }

    _abort(visitorsMap) {
      const v = visitorsMap.get(this.viewerId);
      this.fadeSec = Math.min(this.fadeSec, 0.2); // 0.2s ra + 0.2s vào = 0.4s
      if (!v) { this.active = false; this.viewerId = null; this.phase = 'idle'; return; }
      v.isBowing = false;
      v.bowQueue = 0;
      v.bowPauseRemain = 0;
      v.onFinalDeepBow = null;
      v.ceremonyHoldPose = null;
      if (this.phase === 'fade_in_altar' || this.phase === 'perform' || this.phase === 'rise' || this.phase === 'walk' || KNEEL_PHASES.has(this.phase)) {
        this.phase = 'fade_out_altar';
        this.timer = 0;
        this.outFrom = v.ceremonyAlpha;
      } else if (this.phase === 'fade_out_seat') {
        this.phase = 'fade_in_seat';
        this.timer = 0;
        this.inFrom = v.ceremonyAlpha;
      }
    }

    _begin(msg, visitorsMap, altarSpotCfg, floor, gridCols) {
      const v = visitorsMap.get(msg.id);
      if (!v) return false;

      // Người chưa kịp đi tới bồ đoàn thì đặt vào chỗ ngồi trước rồi mới mờ dần lên bàn thờ
      if (v.seat && v.state === 'walk') {
        v.x = v.seat.x;
        v.y = v.seat.y;
        v.state = 'sit';
        v.fade = 1;
        v.scale = v.computePerspectiveScale(floor, gridCols);
        v.targetScale = v.scale;
      }

      const spot = altarSpotCfg || {};
      this.altarX = Number.isFinite(spot.x) ? spot.x : ALTAR_DEFAULT.x;
      this.altarY = Number.isFinite(spot.y) ? spot.y : ALTAR_DEFAULT.y;
      this.altarScale = Number.isFinite(spot.scale) ? spot.scale : ALTAR_DEFAULT.scale;

      this.fadeSec = clamp(+msg.fadeSec || 0.6, 0.2, 3.0);
      this.incenseBoostSec = clamp(+msg.incenseBoostSec || 6.0, 1.0, 30.0);
      this.incenseHoldSec = clamp(Number.isFinite(+msg.incenseHoldSec) ? +msg.incenseHoldSec : 2.2, 0.5, 10);
      this.tailSec = clamp(Number.isFinite(+msg.tailSec) ? +msg.tailSec : 0.35, 0, 3);
      this.sinceStart = 0;
      // Hạn chót tự kết thúc lễ nếu lệch giờ với server (server là nguồn thời gian duy nhất)
      this.performDeadline = (+msg.totalSec > 0) ? (+msg.totalSec - 2 * this.fadeSec + 0.3) : Infinity;

      this.active = true;
      this.viewerId = v.id;
      this.kind = msg.kind || 'incense';
      this.timer = 0;
      this.subStep = 0;
      this.outFrom = 1;
      this.inFrom = 0;

      // Có ảnh tư thế + server báo thời gian đi bộ → đứng dậy, đi bộ lên bàn thờ; không thì giữ cách cũ (mờ tại chỗ)
      const skinKey = v.skin === 'master' ? 'monk' : v.skin;
      this.walk = null;
      this.path = null;
      this.kneel = null;
      this.kb = null;
      this.poseMode = !!(msg.walk && v.seat && hasPoseSet(this.assets, skinKey));
      if (this.poseMode) {
        setStandConfig(msg.stand);
        const w = msg.walk;
        this.walk = {
          sec: clamp(+w.sec || 2, 0.3, 20), stepSec: clamp(+w.stepSec || 0.35, 0.1, 2),
          riseSec: clamp(+w.riseSec || 0.4, 0.1, 2), bobPx: clamp(+w.bobPx || 0, 0, 12), laneFrac: clamp(+w.laneFrac || 0.5, 0.1, 0.9),
        };
        // Quỳ + lạy bằng ảnh kneel/prostrate: chỉ !cúng bái và !quỳ lạy, chỉ khi server báo và skin đủ ảnh. Còn lại vái đứng như cũ.
        const kc = msg.kneel;
        if (kc && typeof kc === 'object' && this.kind !== 'incense' && hasKneelSet(this.assets, skinKey)) {
          this.kneel = { downSec: clamp(+kc.downSec || 0.4, 0.1, 2), upSec: clamp(+kc.upSec || 0.4, 0.1, 2), prostrateFadeSec: clamp(+kc.prostrateFadeSec || 0.35, 0.1, 2) };
          setProstrateExtraDrop(msg.prostrateExtraDrop);
          setKneelScale(kc.scale);
        }
        this.phase = 'rise';
      } else {
        this.phase = 'fade_out_seat';
      }

      v.inCeremony = true;
      v.atAltarSpot = false;
      v.ceremonyAlpha = 1;
      v.ceremonyHoldPose = null;
      v.ceremonyX = this.altarX;
      v.ceremonyY = this.altarY;
      v.ceremonyScale = this.altarScale;
      v.isBowing = false;
      v.bowQueue = 0;
      v.bowPauseRemain = 0;
      return true;
    }

    update(dt, nowMs, visitorsMap, floor, gridCols, hooks = {}) {
      if (!this.active) {
        if (this.pending) {
          const p = this.pending;
          this.pending = null;
          this._begin(p.msg, p.visitorsMap, p.altarSpotCfg, p.floor, p.gridCols);
        }
        return;
      }

      const v = visitorsMap.get(this.viewerId);
      if (!v) {
        this.active = false;
        this.viewerId = null;
        this.phase = 'idle';
        return;
      }

      this.timer += dt;
      this.sinceStart += dt;

      if (this.phase === 'fade_out_seat') {
        const k = clamp(this.timer / this.fadeSec, 0, 1);
        v.ceremonyAlpha = this.outFrom * (1 - easeInOutSine(k));
        if (this.timer >= this.fadeSec) {
          this.phase = 'fade_in_altar';
          this.timer = 0;
          v.atAltarSpot = true;
          v.ceremonyX = this.altarX;
          v.ceremonyY = this.altarY;
          v.ceremonyScale = this.altarScale;
          v.x = this.altarX;
          v.y = this.altarY;
          v.scale = this.altarScale;
          v.targetScale = this.altarScale;
          v.ceremonyAlpha = 0;
          v.glow = Math.max(v.glow, 0.55);
        }
        return;
      }

      if (this.phase === 'rise') {
        // Ngồi → mờ chéo sang ảnh đứng tại chỗ
        v.ceremonyAlpha = 1;
        v.poseMix = easeInOutSine(clamp(this.timer / this.walk.riseSec, 0, 1));
        if (this.timer >= this.walk.riseSec) {
          v.poseMix = 1;
          this.phase = 'walk';
          this.timer = 0;
          this._buildPath(v, floor);
          v.walkControlled = true;
        }
        return;
      }

      if (this.phase === 'walk') {
        // Đi theo lối giữa tới altarSpot: luân phiên walkL/walkR mỗi stepSec, nhún nhẹ theo bước, scale theo phối cảnh
        const w = this.walk, s = clamp(this.timer / w.sec, 0, 1);
        const pt = this._pointAt(s);
        v.x = v.targetX = pt.x;
        v.y = v.targetY = pt.y;
        v.scale = v.targetScale = this._scaleAtY(pt.y) / 1.05; // ảnh đứng vẽ với scale × 1.05 khi chưa tới bàn thờ
        v.walkImgKey = (Math.floor(this.timer / w.stepSec) % 2 === 0) ? 'walkL' : 'walkR';
        v.walkBobPx = Math.abs(Math.sin(Math.PI * this.timer / w.stepSec)) * w.bobPx;
        v.ceremonyAlpha = 1;
        if (s >= 1) {
          v.walkControlled = false;
          v.atAltarSpot = true;
          v.ceremonyX = this.altarX;
          v.ceremonyY = this.altarY;
          v.ceremonyScale = this.altarScale;
          v.x = this.altarX;
          v.y = this.altarY;
          v.scale = v.targetScale = this.altarScale;
          v.walkImgKey = 'stand';
          v.walkBobPx = 0;
          v.glow = Math.max(v.glow, 0.55);
          this.phase = 'perform';
          this.timer = 0;
          this.subStep = 0;
          this._startPerform(v, nowMs, hooks);
        }
        return;
      }

      if (KNEEL_PHASES.has(this.phase)) {
        if (this.sinceStart >= this.performDeadline) { this._abort(visitorsMap); return; }
        this._updateKneel(v, dt, hooks);
        return;
      }

      if (this.phase === 'fade_in_altar') {
        const k = clamp(this.timer / this.fadeSec, 0, 1);
        v.ceremonyAlpha = easeInOutSine(k);
        if (this.timer >= this.fadeSec) {
          v.ceremonyAlpha = 1;
          this.phase = 'perform';
          this.timer = 0;
          this.subStep = 0;

          this._startPerform(v, nowMs, hooks);
        }
        return;
      }

      if (this.phase === 'perform') {
        v.ceremonyAlpha = 1;
        const bowsDone = !v.isBowing && v.bowQueue === 0 && v.bowPauseRemain <= 0;
        if (this.kind === 'incense') {
          if (this.subStep === 0 && this.timer >= this.incenseHoldSec) {
            this.subStep = 1;
            v.ceremonyHoldPose = null;
            v.startCeremonyBows(1, { holdSec: BOW_CFG.holdSec });
          } else if (this.subStep === 1 && bowsDone) {
            this.subStep = 2;
            this.timer = 0;
          } else if (this.subStep === 2 && this.timer >= this.tailSec) {
            this._toFadeOutAltar();
          }
        } else {
          // worship (3 lạy) hoặc prostrate (1 lạy giữ lâu)
          if (this.subStep === 0 && bowsDone) {
            this.subStep = 1;
            this.timer = 0;
          } else if (this.subStep === 1 && this.timer >= this.tailSec) {
            this._toFadeOutAltar();
          }
        }
        if (this.phase === 'perform' && this.sinceStart >= this.performDeadline) {
          this._abort(visitorsMap);
        }
        return;
      }

      if (this.phase === 'fade_out_altar') {
        const k = clamp(this.timer / this.fadeSec, 0, 1);
        v.ceremonyAlpha = this.outFrom * (1 - easeInOutSine(k));
        if (this.timer >= this.fadeSec) {
          this.phase = 'fade_in_seat';
          this.timer = 0;
          this.inFrom = 0;
          v.atAltarSpot = false;
          v.ceremonyHoldPose = null;
          this._resetPose(v);
          if (v.seat) {
            v.x = v.seat.x;
            v.y = v.seat.y;
            v.targetX = v.seat.x;
            v.targetY = v.seat.y;
          }
          v.scale = v.computePerspectiveScale(floor, gridCols);
          v.targetScale = v.scale;
          v.ceremonyAlpha = 0;
        }
        return;
      }

      if (this.phase === 'fade_in_seat') {
        const k = clamp(this.timer / this.fadeSec, 0, 1);
        v.ceremonyAlpha = this.inFrom + (1 - this.inFrom) * easeInOutSine(k);
        if (this.timer >= this.fadeSec) {
          v.ceremonyAlpha = 1;
          v.inCeremony = false;
          v.atAltarSpot = false;
          v.ceremonyHoldPose = null;
          this.active = false;
          this.viewerId = null;
          this.phase = 'idle';
          this.timer = 0;
          this.subStep = 0;
        }
      }
    }

    // Bắt đầu hành lễ tại altarSpot (dùng chung cho chế độ mờ tại chỗ và chế độ đi bộ)
    _startPerform(v, nowMs, hooks) {
      if (this.kneel && this.kind !== 'incense') {
        // Đứng → mờ chéo sang quỳ → (quỳ ↔ lạy) × n → quỳ → mờ chéo về đứng. Không dùng cúi/nén ảnh.
        v.ceremonyHoldPose = null;
        if (this.kind === 'prostrate') v.activateLotusAura(nowMs, 2);
        const worship = this.kind === 'worship';
        this.kb = { n: worship ? 3 : 1, i: 0, stage: 0, holdSec: worship ? BOW_CFG.holdSec : BOW_CFG.prostrateHoldSec, bellDone: false };
        this.phase = 'kneel_down';
        this.timer = 0;
        return;
      }
      if (this.kind === 'incense') {
        // !thắp nhang: chắp tay tịnh tâm trước lư hương, khói nhang bùng lên, rồi lạy 1 lần
        v.ceremonyHoldPose = 0.3;
        if (hooks.incenseFX) hooks.incenseFX.boostForSeconds(this.incenseBoostSec, 0.96);
      } else if (this.kind === 'worship') {
        // !cúng bái: lạy 3 lần liên tiếp, đánh chuông nhỏ ở lạy cuối
        v.ceremonyHoldPose = null;
        v.startCeremonyBows(3, {
          holdSec: BOW_CFG.holdSec,
          pauseBetweenSec: BOW_CFG.pauseSec,
          onFinalDeepBow: () => { if (hooks.onSmallBell) hooks.onSmallBell(); },
        });
      } else if (this.kind === 'prostrate') {
        // !quỳ lạy: 1 lần, giữ lâu hơn, hào quang sen dưới bồ đoàn
        v.ceremonyHoldPose = null;
        v.activateLotusAura(nowMs, 2);
        v.startCeremonyBows(1, { holdSec: BOW_CFG.prostrateHoldSec });
      }
    }

    // Chuỗi quỳ lạy. Trả về true nếu đã xử lý khung này. Mọi thời gian lấy từ kneel (server) + BOW_CFG, đã kẹp.
    _updateKneel(v, dt, hooks) {
      const K = this.kneel, kb = this.kb;
      if (!K || !kb) { this._toFadeOutAltar(); return true; }
      v.ceremonyAlpha = 1;
      if (this.phase === 'kneel_down') {
        v.kneelMix = easeInOutSine(clamp(this.timer / K.downSec, 0, 1));
        if (this.timer >= K.downSec) { v.kneelMix = 1; this.phase = 'kneel_bow'; this.timer = 0; kb.stage = 0; }
        return true;
      }
      if (this.phase === 'kneel_bow') {
        const F = K.prostrateFadeSec;
        if (kb.stage === 0) {                                   // quỳ → lạy sát đất
          v.prostrateMix = easeInOutSine(clamp(this.timer / F, 0, 1));
          if (this.timer >= F) { v.prostrateMix = 1; kb.stage = 1; this.timer = 0; }
        } else if (kb.stage === 1) {                            // giữ ở tư thế lạy
          v.prostrateMix = 1;
          // Chuông nhỏ khi chạm đỉnh lạy cuối của !cúng bái
          if (!kb.bellDone && kb.i === kb.n - 1 && this.kind === 'worship') { kb.bellDone = true; if (hooks.onSmallBell) hooks.onSmallBell(); }
          if (this.timer >= kb.holdSec) { kb.stage = 2; this.timer = 0; }
        } else if (kb.stage === 2) {                            // lạy → quỳ
          v.prostrateMix = 1 - easeInOutSine(clamp(this.timer / F, 0, 1));
          if (this.timer >= F) {
            v.prostrateMix = 0; kb.i++;
            if (kb.i >= kb.n) { this.phase = 'kneel_up'; this.timer = 0; }
            else { kb.stage = 3; this.timer = 0; }
          }
        } else {                                                // nghỉ giữa hai lạy (quỳ)
          v.prostrateMix = 0;
          if (this.timer >= BOW_CFG.pauseSec) { kb.stage = 0; this.timer = 0; }
        }
        return true;
      }
      if (this.phase === 'kneel_up') {
        v.prostrateMix = 0;
        v.kneelMix = 1 - easeInOutSine(clamp(this.timer / K.upSec, 0, 1));
        if (this.timer >= K.upSec) { v.kneelMix = 0; this.phase = 'kneel_tail'; this.timer = 0; }
        return true;
      }
      // kneel_tail: đứng yên một nhịp rồi mờ dần về chỗ
      if (this.timer >= this.tailSec) this._toFadeOutAltar();
      return true;
    }

    // Đường đi: ghế → bước ra phía trước hàng → ngang tới lối giữa (x = altarX) → thẳng lên altarSpot.
    // Người đi có y lớn hơn hàng ngồi nên được vẽ phía trước (sắp theo y như bình thường).
    _buildPath(v, floor) {
      const seat = v.seat;
      const rowGap = this.gridRows > 1 ? (floor.yBot - floor.yTop) / (this.gridRows - 1) : 0;
      const dy = rowGap * this.walk.laneFrac;
      const pts = [
        { x: v.x, y: v.y },
        { x: v.x, y: seat.y + dy },
        { x: this.altarX, y: seat.y + dy },
        { x: this.altarX, y: this.altarY },
      ];
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      // scale theo y cho cả đoạn đường: càng đi lên (y nhỏ) càng nhỏ, tới altarSpot đúng bằng altarScale
      this.path = { pts, len: Math.max(1, len), y0: v.y, ds0: v.scale * 1.05 };
    }

    // Một hàm scale theo y cho cả đường đi (phối cảnh): ds(y) nội suy giữa kích thước ở ghế và ở altarSpot
    _scaleAtY(y) {
      const { y0, ds0 } = this.path;
      const span = y0 - this.altarY;
      const t = span > 1 ? clamp((y0 - y) / span, -0.5, 1) : 1;
      return lerp(ds0, this.altarScale, t);
    }

    _pointAt(s) {
      const { pts, len } = this.path;
      let d = s * len;
      for (let i = 1; i < pts.length; i++) {
        const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (d <= seg || i === pts.length - 1) {
          const k = seg > 0 ? clamp(d / seg, 0, 1) : 1;
          return { x: lerp(pts[i - 1].x, pts[i].x, k), y: lerp(pts[i - 1].y, pts[i].y, k) };
        }
        d -= seg;
      }
      return pts[pts.length - 1];
    }

    _toFadeOutAltar() {
      this.phase = 'fade_out_altar';
      this.timer = 0;
      this.outFrom = 1;
    }
  }

  // Xuất module toàn cục cho overlay.html sử dụng
  global.ChanhDienCanvas = {
    lerp,
    lerpDt,
    perlin2D,
    Character,
    IncenseSmokeSystem,
    SilkMeritScroll,
    AmbientLightingSystem,
    CameraZoomController,
    CeremonyDirector,
    ALTAR_DEFAULT,
    setBowConfig,
    setStandConfig,
    setProstrateExtraDrop,
    setKneelScale,
    hasPoseSet,
    getBowConfig: () => Object.assign({}, BOW_CFG),
    bowTotalSec,
    drawBowedCharacter,
    drawStandCharacter,
  };
})(window);

