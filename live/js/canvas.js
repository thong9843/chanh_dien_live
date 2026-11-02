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
   * 2. BỘ TỔNG HỢP SPRITE SHEET QUỲ LẠY 12 FRAMES (12-FRAME BOWING SEQUENCE)
   *    - Frames 0..2  (1-3):  Chắp tay trước ngực, từ từ quỳ xuống
   *    - Frames 3..5  (4-6):  Cúi gập người, hai tay chạm chiếu/bồ đoàn
   *    - Frames 6..8  (7-9):  Trụ gối, trán chạm thảm lạy sâu
   *    - Frames 9..11 (10-12): Từ từ nâng người dậy, trở về tư thế chắp tay
   * ========================================================================= */

  // Thông số tư thế cho từng frame trong chuỗi 12 frames:
  // bend: độ gập thân trên (0 = thẳng lưng, 1 = trán chạm thảm lạy sâu)
  // kneel: độ hạ trọng tâm gối xuống bồ đoàn
  // clasp: mức chắp tay trước ngực (1 = chắp tay búp sen, 0 = hai tay trải chạm chiếu)
  // matHands: độ vươn hai bàn tay chạm chiếu phía trước
  // reverenceGlow: ánh sáng thành tâm ở trán khi lạy sát đất
  const BOW_KEYFRAMES_12 = [
    // Frames 1-3: Chắp tay trước ngực, từ từ quỳ xuống
    { bend: 0.02, kneel: 0.10, clasp: 0.85, matHands: 0.00, reverenceGlow: 0.00, dur: 0.14 },
    { bend: 0.06, kneel: 0.35, clasp: 1.00, matHands: 0.00, reverenceGlow: 0.00, dur: 0.14 },
    { bend: 0.14, kneel: 0.65, clasp: 0.90, matHands: 0.08, reverenceGlow: 0.00, dur: 0.14 },
    // Frames 4-6: Cúi gập người, hai tay chạm chiếu/bồ đoàn
    { bend: 0.34, kneel: 0.85, clasp: 0.40, matHands: 0.42, reverenceGlow: 0.00, dur: 0.13 },
    { bend: 0.58, kneel: 0.95, clasp: 0.05, matHands: 0.78, reverenceGlow: 0.10, dur: 0.13 },
    { bend: 0.80, kneel: 1.00, clasp: 0.00, matHands: 0.96, reverenceGlow: 0.25, dur: 0.14 },
    // Frames 7-9: Trụ gối, trán chạm thảm lạy sâu
    { bend: 0.95, kneel: 1.00, clasp: 0.00, matHands: 1.00, reverenceGlow: 0.65, dur: 0.18 },
    { bend: 1.00, kneel: 1.00, clasp: 0.00, matHands: 1.00, reverenceGlow: 1.00, dur: 0.28 },
    { bend: 0.94, kneel: 1.00, clasp: 0.00, matHands: 1.00, reverenceGlow: 0.60, dur: 0.17 },
    // Frames 10-12: Từ từ nâng người dậy, trở về tư thế chắp tay
    { bend: 0.66, kneel: 0.90, clasp: 0.20, matHands: 0.65, reverenceGlow: 0.15, dur: 0.14 },
    { bend: 0.32, kneel: 0.55, clasp: 0.75, matHands: 0.18, reverenceGlow: 0.00, dur: 0.14 },
    { bend: 0.05, kneel: 0.15, clasp: 1.00, matHands: 0.00, reverenceGlow: 0.00, dur: 0.15 },
  ];

  const bowSheetCache = new Map();

  function getOrBuildBowSheet(skinKey, img) {
    if (!img || !img.naturalWidth) return null;
    const cached = bowSheetCache.get(skinKey);
    if (cached && cached.srcW === img.naturalWidth) return cached;

    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    // Mở rộng khung vẽ nhẹ để tay chạm chiếu & ánh hào quang lễ lạy không bị cắt
    const padX = Math.round(sw * 0.24);
    const padY = Math.round(sh * 0.10);
    const fw = sw + padX * 2;
    const fh = sh + padY;

    const canvas = document.createElement('canvas');
    canvas.width = fw * 12;
    canvas.height = fh;
    const c = canvas.getContext('2d');

    // Chia phần thân trên (đầu + lưng: 0..68% chiều cao) thành các lát ngang mượt,
    // giữ nguyên phần chân/bồ đoàn (68%..100%) cố định trên mặt sàn.
    const hipRatio = 0.68;
    const hipY = Math.floor(sh * hipRatio);
    const baseH = sh - hipY;
    const slices = 22;

    for (let f = 0; f < 12; f++) {
      const kf = BOW_KEYFRAMES_12[f];
      const ox = f * fw + padX;
      const oy = padY;

      c.save();

      // 1. Vẽ phần bồ đoàn + hai gối trụ vững dưới sàn
      const baseCompressY = 1 - kf.kneel * 0.06;
      const baseWidenX = 1 + kf.kneel * 0.04;
      const dstBaseW = sw * baseWidenX;
      const dstBaseH = baseH * baseCompressY;
      const dstBaseX = ox + (sw - dstBaseW) * 0.5;
      const dstBaseY = oy + sh - dstBaseH;
      c.drawImage(img, 0, hipY, sw, baseH, dstBaseX, dstBaseY, dstBaseW, dstBaseH);

      // 2. Vẽ hai bàn tay trải ra chạm chiếu phía trước khi cúi lạy (Frames 4-10)
      if (kf.matHands > 0.02) {
        const handAlpha = clamp(kf.matHands, 0, 1);
        const reachY = oy + sh - baseH * 0.24 + kf.bend * (sh * 0.055);
        const spreadX = sw * (0.19 - kf.bend * 0.04);
        const cx = ox + sw * 0.5;

        c.save();
        c.globalAlpha = 0.92 * handAlpha;
        // Bóng tay nhẹ trên chiếu
        c.fillStyle = 'rgba(28, 12, 4, 0.36)';
        c.beginPath();
        c.ellipse(cx - spreadX, reachY + 4, sw * 0.075, sh * 0.026, -0.25, 0, Math.PI * 2);
        c.ellipse(cx + spreadX, reachY + 4, sw * 0.075, sh * 0.026, 0.25, 0, Math.PI * 2);
        c.fill();

        // Hai bàn tay úp trang nghiêm trên thảm
        const palmGrad = c.createRadialGradient(cx, reachY, 2, cx, reachY, sw * 0.3);
        palmGrad.addColorStop(0, '#f6cfa6');
        palmGrad.addColorStop(1, '#d9a477');
        c.fillStyle = palmGrad;
        c.strokeStyle = 'rgba(70, 32, 12, 0.55)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.ellipse(cx - spreadX, reachY, sw * 0.062, sh * 0.023, -0.28, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.beginPath();
        c.ellipse(cx + spreadX, reachY, sw * 0.062, sh * 0.023, 0.28, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.restore();
      }

      // 3. Nội suy đa lát (Multi-slice Mesh Deformation) cho thân trên + đầu khi cúi gập lạy sâu
      const sliceSrcH = hipY / slices;
      // Khi bend = 1 (lạy sát thảm): đỉnh đầu hạ thấp xuống gần mặt thảm (khoảng 76% chiều cao ảnh)
      const hipAnchorY = dstBaseY + 2;
      const torsoScaleY = 1.0 - kf.bend * 0.62; // foreshortening khi gập người về phía trước/camera
      const kneelDrop = kf.kneel * (sh * 0.035);

      for (let s = slices - 1; s >= 0; s--) {
        const u0 = s / slices; // 0 = đỉnh đầu, 1 = ngang hông
        const distFromHip = 1 - u0;
        const srcY = s * sliceSrcH;
        const srcH = Math.ceil(sliceSrcH) + 1;

        // Độ cong lưng tự nhiên khi lạy (phần vai & đầu gập sâu hơn phần thắt lưng)
        const archCurve = Math.pow(distFromHip, 1.35) * kf.bend * (sh * 0.15);
        const dstY = hipAnchorY - (hipY - srcY) * torsoScaleY + archCurve + kneelDrop;
        const dstH = Math.max(1.5, srcH * torsoScaleY + 0.9);

        // Hiệu ứng phối cảnh nhẹ: vai hơi mở nhẹ khi gập người xuống mặt bồ đoàn
        const perspW = 1 + Math.sin(distFromHip * Math.PI) * kf.bend * 0.09 - Math.pow(distFromHip, 2) * kf.bend * 0.06;
        const dstW = sw * perspW;
        const dstX = ox + (sw - dstW) * 0.5;

        c.drawImage(img, 0, srcY, sw, Math.min(sh - srcY, srcH), dstX, dstY, dstW, dstH);
      }

      // Đổ bóng chiều sâu nhẹ lên lưng/đầu khi cúi sát đất để tạo khối 2.5D chân thực
      if (kf.bend > 0.25) {
        c.save();
        c.globalCompositeOperation = 'source-atop';
        c.fillStyle = `rgba(25, 10, 4, ${(kf.bend * 0.16).toFixed(3)})`;
        c.fillRect(ox - padX, oy, fw, hipAnchorY);
        c.restore();
      }

      // 4. Hiệu ứng hai bàn tay chắp búp sen trước ngực (Frames 1-3 & 10-12)
      if (kf.clasp > 0.1) {
        const chestX = ox + sw * 0.5;
        const chestY = hipAnchorY - hipY * torsoScaleY * 0.44 + kneelDrop;
        c.save();
        c.globalAlpha = clamp(kf.clasp, 0, 1) * 0.92;
        const glow = c.createRadialGradient(chestX, chestY, 1, chestX, chestY, sw * 0.14);
        glow.addColorStop(0, 'rgba(255, 232, 175, 0.75)');
        glow.addColorStop(1, 'rgba(255, 200, 110, 0)');
        c.fillStyle = glow;
        c.beginPath();
        c.arc(chestX, chestY, sw * 0.14, 0, Math.PI * 2);
        c.fill();

        // Búp tay chắp trang nghiêm
        c.fillStyle = '#f5cca2';
        c.strokeStyle = 'rgba(90, 42, 14, 0.65)';
        c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(chestX, chestY - sh * 0.042);
        c.quadraticCurveTo(chestX + sw * 0.045, chestY, chestX + sw * 0.015, chestY + sh * 0.032);
        c.lineTo(chestX - sw * 0.015, chestY + sh * 0.032);
        c.quadraticCurveTo(chestX - sw * 0.045, chestY, chestX, chestY - sh * 0.042);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      }

      // 5. Ánh kim quang thành kính chạm thảm ở Frames 7-9
      if (kf.reverenceGlow > 0.05) {
        const glowX = ox + sw * 0.5;
        const glowY = oy + sh - baseH * 0.22;
        c.save();
        c.globalCompositeOperation = 'lighter';
        const rg = c.createRadialGradient(glowX, glowY, 2, glowX, glowY, sw * 0.28);
        rg.addColorStop(0, `rgba(255, 226, 148, ${(0.55 * kf.reverenceGlow).toFixed(3)})`);
        rg.addColorStop(1, 'rgba(255, 180, 70, 0)');
        c.fillStyle = rg;
        c.beginPath();
        c.ellipse(glowX, glowY, sw * 0.28, sh * 0.07, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      c.restore();
    }

    const record = { canvas, fw, fh, padX, padY, srcW: sw, srcH: sh };
    bowSheetCache.set(skinKey, record);
    return record;
  }

  /* =========================================================================
   * 3. LỚP NHÂN VẬT CHÁNH ĐIỆN (CHARACTER CLASS — LERP + PERSPECTIVE + BOWING)
   * ========================================================================= */

  const LOTUS_AURA_DURATION_MS = 5 * 60 * 1000; // 5 phút tri ân dưới chân bồ đoàn

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

      // Trạng thái di chuyển & hành lễ 12 frames
      this.state = 'walk'; // 'walk' | 'sit'
      this.seat = null;
      this.walkBob = Math.random() * Math.PI * 2;
      this.phase = Math.random() * Math.PI * 2;
      this.fade = 0;
      this.glow = 0;
      this.bubble = null;

      // 12-Frame Bowing Sequence
      this.bowFrame = 0;
      this.bowTimer = 0;
      this.isBowing = false;
      this.bowQueue = 0;
      this.pendingLotusTier = 0;

      // Hào quang hoa sen 5 phút dưới chân bồ đoàn
      this.lotusAuraUntil = 0;
      this.lotusAuraStart = 0;
      this.lotusAuraTier = 1;
    }

    assignSeat(seat, instant = false, floor = { yTop: 1430, yBot: 1870 }, gridCols = 6) {
      this.seat = seat;
      if (!seat) return;
      this.targetX = seat.x;
      this.targetY = seat.y;
      if (instant) {
        this.x = seat.x;
        this.y = seat.y;
        this.state = 'sit';
        this.fade = 1;
        this.scale = this.computePerspectiveScale(floor, gridCols);
        this.targetScale = this.scale;
      }
    }

    triggerBow(count = 1, giftTierForLotus = 0) {
      this.bowQueue = Math.min(6, Math.max(this.bowQueue, count));
      if (giftTierForLotus > 0) {
        this.pendingLotusTier = Math.max(this.pendingLotusTier, giftTierForLotus);
      }
      if (this.state === 'sit' && !this.isBowing && this.bowQueue > 0) {
        this.startNextBow();
      }
    }

    startNextBow() {
      if (this.bowQueue <= 0) return;
      this.bowQueue--;
      this.isBowing = true;
      this.bowFrame = 0;
      this.bowTimer = 0;
    }

    activateLotusAura(nowMs, tier = 1) {
      if (nowMs >= this.lotusAuraUntil) {
        this.lotusAuraStart = nowMs;
      }
      this.lotusAuraUntil = nowMs + LOTUS_AURA_DURATION_MS;
      this.lotusAuraTier = Math.max(this.lotusAuraTier || 1, tier);
    }

    computePerspectiveScale(floor, gridCols) {
      // Áp dụng công thức Perspective Scaling theo chiều sâu Y (perspectiveFactor = 0.0005)
      // đồng thời chuẩn hóa theo mật độ lưới bồ đoàn trên khung 1080x1920
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

      if (this.seat) {
        if (this.state === 'walk') {
          // Bước dọc lối đi chính giữa (x = 540) đến hàng ghế rồi mới rẽ vào bồ đoàn
          const dyToRow = Math.abs(this.y - this.seat.y);
          if (dyToRow > 36) {
            this.targetX = lerp(this.seat.x, 540, 0.72);
            this.targetY = this.seat.y;
          } else {
            this.targetX = this.seat.x;
            this.targetY = this.seat.y;
          }

          // Lerp vị trí với hệ số t = 0.08 chuẩn hóa theo deltaTime để bước đi từ tốn, khoan thai
          this.x = lerpDt(this.x, this.targetX, 0.08, dt);
          this.y = lerpDt(this.y, this.targetY, 0.08, dt);
          this.walkBob += dt * 7.5;

          if (Math.hypot(this.x - this.seat.x, this.y - this.seat.y) < 3.5) {
            this.x = this.seat.x;
            this.y = this.seat.y;
            this.state = 'sit';
            // Khi vừa an tọa lên bồ đoàn, tự động chắp tay lạy Phật 1 lễ trang nghiêm
            if (!this.demo && this.bowQueue === 0) {
              this.triggerBow(1, 0);
            } else if (this.bowQueue > 0) {
              this.startNextBow();
            }
          }
        } else {
          // Đang ngồi thiền: nếu lưới chỗ ngồi mở rộng (24 -> 36 -> 64 -> 100), trượt mượt sang vị trí mới bằng Lerp t=0.08
          this.targetX = this.seat.x;
          this.targetY = this.seat.y;
          this.x = lerpDt(this.x, this.targetX, 0.08, dt);
          this.y = lerpDt(this.y, this.targetY, 0.08, dt);
        }
      }

      // Tự động Scale kích thước theo độ sâu chiều Y (Perspective Scaling)
      this.targetScale = this.computePerspectiveScale(floor, gridCols);
      this.scale = lerpDt(this.scale, this.targetScale, 0.08, dt);

      // Cập nhật chuỗi 12-Frame Bowing bằng deltaTime (60fps đồng nhất trên mọi máy)
      if (this.state === 'sit') {
        if (!this.isBowing && this.bowQueue > 0) {
          this.startNextBow();
        }
        if (this.isBowing) {
          this.bowTimer += dt;
          const frameDur = BOW_KEYFRAMES_12[this.bowFrame]?.dur || 0.15;
          if (this.bowTimer >= frameDur) {
            this.bowTimer -= frameDur;
            this.bowFrame++;
            if (this.bowFrame >= 12) {
              if (this.bowQueue > 0) {
                this.bowQueue--;
                this.bowFrame = 0;
              } else {
                this.isBowing = false;
                this.bowFrame = 0;
                // Sau khi lễ lạy cúng dường xong và trở về bồ đoàn -> Bật Vòng Hào Quang Hoa Sen 5 phút!
                if (this.pendingLotusTier > 0) {
                  this.activateLotusAura(nowMs, this.pendingLotusTier);
                  this.pendingLotusTier = 0;
                }
              }
            }
          }
        }
      }
    }

    drawLotusAuraUnderMat(ctx, t, nowMs, lotusImg) {
      if (nowMs >= this.lotusAuraUntil) return;
      const elapsed = (nowMs - this.lotusAuraStart) / 1000;
      const remain = (this.lotusAuraUntil - nowMs) / 1000;
      const fade = clamp(Math.min(elapsed * 1.2, remain / 3.0), 0, 1);
      if (fade <= 0.01) return;

      const s = this.scale;
      const rx = 128 * s * (this.lotusAuraTier >= 3 ? 1.18 : 1.04);
      const breath = 1 + 0.045 * Math.sin(t * 1.8 + this.phase);

      ctx.save();
      ctx.translate(this.x, this.y - 12 * s);
      ctx.scale(1, 0.42); // Phối cảnh mặt sàn 2.5D dưới chân bồ đoàn
      ctx.globalCompositeOperation = 'lighter';

      // Hào quang tỏa tròn ấm áp
      const grad = ctx.createRadialGradient(0, 0, rx * 0.1, 0, 0, rx * 1.25 * breath);
      grad.addColorStop(0, `rgba(255, 224, 140, ${(0.52 * fade).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(255, 165, 195, ${(0.28 * fade).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 180, 80, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rx * 1.25 * breath, 0, Math.PI * 2);
      ctx.fill();

      // Vòng cánh sen vàng ngoài xoay chậm thuận chiều kim đồng hồ
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

      // Vòng cánh sen trong xoay nhẹ ngược chiều tạo chiều sâu mandala
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
      // 1. Vẽ Vòng Hào Quang Hoa Sen dưới chân bồ đoàn (nếu đang trong 5 phút tri ân)
      this.drawLotusAuraUnderMat(ctx, t, nowMs, assets.lotus);

      // 2. Vẽ hào quang thân tâm (khi vừa tặng quà hoặc skin cao tăng)
      if (this.glow > 0 || this.skin === 'master') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(this.glow * 0.75, this.skin === 'master' ? 0.35 + 0.1 * Math.sin(t * 1.6) : 0);
        const g = ctx.createRadialGradient(this.x, this.y - 110 * ws, 8, this.x, this.y - 110 * ws, 200 * ws);
        g.addColorStop(0, 'rgba(255, 205, 120, 0.95)');
        g.addColorStop(1, 'rgba(255, 160, 60, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(this.x - 230 * ws, this.y - 340 * ws, 460 * ws, 400 * ws);
        ctx.restore();
      }

      // 3. Vẽ nhân vật (Hỗ trợ 12-frame bowing sprite sheet hoặc nhịp thở thiền định)
      const skinImgKey = this.skin === 'master' ? 'monk' : this.skin;
      const baseImg = assets[skinImgKey] || assets.man;
      const walkStepY = this.state === 'walk' ? -Math.abs(Math.sin(this.walkBob)) * 6 * ws : 0;
      const breatheY = (this.state === 'sit' && !this.isBowing) ? Math.sin(t * 1.15 + this.phase) * 2.2 * ws : 0;

      ctx.save();
      ctx.globalAlpha = this.fade;
      ctx.translate(this.x, this.y + walkStepY);
      if (this.state === 'walk') {
        ctx.rotate(Math.sin(this.walkBob) * 0.025);
      }

      let topY = 260 * ws;
      const drawScale = ws * 1.05;

      // Ưu tiên sprite sheet 12-frame ngoại vi nếu người dùng đặt `bow_<skin>` trong assets,
      // nếu không dùng 12-frame sheet sinh tự động trên offscreen canvas
      const extBow = assets['bow_' + skinImgKey];
      if (this.isBowing && extBow && extBow.naturalWidth > 0) {
        const fw = extBow.naturalWidth / 12;
        const fh = extBow.naturalHeight;
        ctx.drawImage(
          extBow,
          this.bowFrame * fw, 0, fw, fh,
          -fw * drawScale * 0.5, -fh * drawScale,
          fw * drawScale, fh * drawScale
        );
        topY = fh * drawScale * (1 - BOW_KEYFRAMES_12[this.bowFrame].bend * 0.35);
      } else if (this.isBowing && baseImg && baseImg.naturalWidth > 0) {
        const sheet = getOrBuildBowSheet(skinImgKey, baseImg);
        if (sheet) {
          const w = sheet.fw * drawScale;
          const h = sheet.fh * drawScale;
          ctx.drawImage(
            sheet.canvas,
            this.bowFrame * sheet.fw, 0, sheet.fw, sheet.fh,
            -w * 0.5, -h,
            w, h
          );
          const bend = BOW_KEYFRAMES_12[this.bowFrame]?.bend || 0;
          topY = sheet.srcH * ws * (1 - bend * 0.36);
        }
      } else if (baseImg && baseImg.naturalWidth > 0) {
        const w = baseImg.naturalWidth * drawScale;
        const h = baseImg.naturalHeight * drawScale;
        ctx.drawImage(baseImg, -w * 0.5, -h + breatheY, w, h);
        topY = baseImg.naturalHeight * ws;
      }

      ctx.restore();
      return topY;
    }
  }

  /* =========================================================================
   * 4. LƯ HƯƠNG LỬA & KHÓI TRẦM TƯƠNG TÁC (INCENSE PARTICLE SYSTEM — 3.1)
   * ========================================================================= */

  class IncenseSmokeSystem {
    constructor() {
      this.particles = [];
      this.embers = [];
      this.boostUntil = 0;
      this.boostIntensity = 0;
      this.spawnAcc = 0;
      this.emberAcc = 0;
    }

    triggerSacredOffering(tier = 2) {
      const now = performance.now();
      const extraMs = tier >= 3 ? 22000 : 14000;
      this.boostUntil = Math.max(this.boostUntil, now + extraMs);
      this.boostIntensity = Math.max(this.boostIntensity, tier >= 3 ? 1.0 : 0.72);

      // Tạo chùm tàn lửa trầm hương bừng sáng tức thì tại lư hương
      for (let i = 0; i < (tier >= 3 ? 22 : 12); i++) {
        this.embers.push({
          ox: (Math.random() - 0.5) * 44,
          oy: (Math.random() - 0.5) * 10,
          vx: (Math.random() - 0.5) * 28,
          vy: -(35 + Math.random() * 65),
          age: 0,
          life: 1.1 + Math.random() * 1.3,
          r: 1.8 + Math.random() * 2.6,
        });
      }
    }

    updateAndDraw(ctx, dt, t, burnerX, burnerY) {
      const now = performance.now();
      const targetBoost = now < this.boostUntil ? (this.boostIntensity || 0.8) : 0;
      this.boostIntensity = lerpDt(this.boostIntensity, targetBoost, 0.04, dt);
      const boost = this.boostIntensity;

      // Tốc độ sinh hạt khói: chế độ tĩnh lặng (5 hạt/s) vs chế độ Cúng dường quà lớn (26 hạt/s)
      const rate = 5.5 + boost * 22;
      this.spawnAcc += dt * rate;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (this.particles.length < 180) {
          const stickIdx = (Math.floor(Math.random() * 3) - 1); // 3 nén hương tại lư hương
          this.particles.push({
            x: burnerX + stickIdx * (8 + boost * 4) + (Math.random() - 0.5) * 8,
            y: burnerY - 6,
            vy: -(36 + Math.random() * 26 + boost * 24),
            age: 0,
            life: 4.6 + Math.random() * 2.8 + boost * 1.6,
            r0: 4 + Math.random() * 4,
            r1: 28 + Math.random() * 24 + boost * 22,
            seed: Math.random() * 100,
            golden: boost > 0.25 && Math.random() < 0.45,
          });
        }
      }

      // Sinh tàn lửa nhang lấp lánh khi đang cháy rực
      if (boost > 0.15) {
        this.emberAcc += dt * (8 * boost);
        while (this.emberAcc >= 1) {
          this.emberAcc -= 1;
          this.embers.push({
            ox: (Math.random() - 0.5) * 30,
            oy: -4,
            vx: (Math.random() - 0.5) * 20,
            vy: -(28 + Math.random() * 48),
            age: 0,
            life: 0.9 + Math.random() * 1.1,
            r: 1.5 + Math.random() * 2.0,
          });
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

      // 2. Vẽ các dải hạt khói trầm bay lên theo Perlin Noise + Sine Wave drift
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.age += dt;
        const u = p.age / p.life;
        if (u >= 1) {
          this.particles.splice(i, 1);
          continue;
        }

        // Kết hợp Perlin Noise 2D và Sine Wave tạo đường cong khói trầm mềm mại tự nhiên
        const nVal = perlin2D(p.seed + p.y * 0.0085, t * 0.42 + p.seed * 0.3);
        const sineDrift = Math.sin(u * 5.2 + p.seed) * (14 + u * 26);
        const vx = nVal * (38 + boost * 32) + sineDrift * 0.65;

        p.x += vx * dt;
        p.y += p.vy * (1 - u * 0.25) * dt;

        const radius = lerp(p.r0, p.r1, easeOutCubic(u));
        const env = u < 0.16 ? (u / 0.16) : Math.pow(1 - (u - 0.16) / 0.84, 1.45);
        const alpha = env * (0.20 + boost * 0.18);

        const grad = ctx.createRadialGradient(p.x, p.y, radius * 0.08, p.x, p.y, radius);
        if (p.golden && u < 0.45) {
          grad.addColorStop(0, `rgba(255, 232, 188, ${alpha.toFixed(3)})`);
          grad.addColorStop(0.55, `rgba(238, 224, 200, ${(alpha * 0.52).toFixed(3)})`);
        } else {
          grad.addColorStop(0, `rgba(244, 235, 218, ${alpha.toFixed(3)})`);
          grad.addColorStop(0.55, `rgba(225, 216, 204, ${(alpha * 0.48).toFixed(3)})`);
        }
        grad.addColorStop(1, 'rgba(220, 212, 200, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Vẽ các hạt tàn lửa hương vàng cam bay lên
      ctx.globalCompositeOperation = 'lighter';
      for (let i = this.embers.length - 1; i >= 0; i--) {
        const e = this.embers[i];
        e.age += dt;
        const u = e.age / e.life;
        if (u >= 1) {
          this.embers.splice(i, 1);
          continue;
        }
        e.ox += (e.vx + Math.sin(t * 9 + i) * 14) * dt;
        e.oy += e.vy * dt;
        const ex = burnerX + e.ox;
        const ey = burnerY + e.oy;
        ctx.fillStyle = `rgba(255, 196, 92, ${((1 - u) * 0.9).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(ex, ey, e.r * (1 - u * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  /* =========================================================================
   * 5. SỔ VÀNG CÔNG ĐỨC CUỘN THƯ PHÁP 2.5D (2.5D SILK SCROLL — 3.2)
   * ========================================================================= */

  class SilkMeritScroll {
    constructor() {
      this.queue = [];
      this.current = null;
      this.timer = 0;
    }

    enqueue(donation) {
      if (this.queue.length >= 6) return;
      this.queue.push({
        name: String(donation.name || 'Phật tử').slice(0, 22),
        giftName: String(donation.giftName || 'Hoa Sen').slice(0, 28),
        count: donation.count || 1,
        coins: donation.coins || 1,
        total: donation.total || donation.coins || 1,
      });
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

      const cx = 540;
      const cy = 468; // Phía trên màn hình (ngay dưới thanh trạng thái, không che chánh điện dưới)
      const maxHalfW = 395;
      const halfW = Math.max(16, maxHalfW * openRatio);
      const scrollH = 206;
      const topY = cy - scrollH * 0.5;
      const botY = cy + scrollH * 0.5;
      const waveY = Math.sin(t * 2.1) * 2.5;

      ctx.save();
      ctx.globalAlpha = alpha;

      // 1. Bóng đổ 2.5D & Hào quang vàng sau bức trướng lụa
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.68)';
      ctx.shadowBlur = 32;
      ctx.shadowOffsetY = 14;
      ctx.fillStyle = 'rgba(30, 12, 4, 0.35)';
      ctx.fillRect(cx - halfW, topY + 6, halfW * 2, scrollH - 12);
      ctx.restore();

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
          ctx.fillText('✦  SỔ VÀNG CÔNG ĐỨC  ✦', cx, topY + 42);

          // Tên Phật tử phong cách thư pháp trang trọng
          ctx.font = 'italic 700 42px "Noto Serif", Georgia, serif';
          ctx.fillStyle = '#241006';
          ctx.fillText(`Phật tử ${this.current.name}`, cx, cy - 2);

          // Lễ vật & Điểm công đức
          const timesTxt = this.current.count > 1 ? ` ×${this.current.count}` : '';
          ctx.font = '600 25px "Be Vietnam Pro", system-ui, sans-serif';
          ctx.fillStyle = '#6b2410';
          ctx.fillText(
            `Cúng dường ${this.current.giftName}${timesTxt}  ·  Công đức ${this.current.total} ✧`,
            cx,
            cy + 44
          );

          // Lời chúc hồi hướng ngắn
          ctx.font = 'italic 20px "Noto Serif", Georgia, serif';
          ctx.fillStyle = '#5c3d1e';
          ctx.fillText('Nguyện cầu bình an · Phước báu vô lượng', cx, botY - 30);

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
          ctx.fillText('PHƯỚC', 0, -9);
          ctx.fillText('BÁU', 0, 11);
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

    drawBackgroundLighting(ctx, dt, t, mode = 'auto') {
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
        ctx.save();
        // Lớp phủ đêm thâm nghiêm viền ngoài (giữ sáng ấm vùng bàn thờ trung tâm)
        const nightShade = ctx.createRadialGradient(540, 960, 260, 540, 960, 1120);
        nightShade.addColorStop(0.0, 'rgba(10, 8, 20, 0.06)');
        nightShade.addColorStop(0.65, 'rgba(8, 6, 18, 0.28)');
        nightShade.addColorStop(1.0, 'rgba(5, 4, 14, 0.48)');
        ctx.fillStyle = nightShade;
        ctx.fillRect(0, 0, 1080, 1920);
        ctx.restore();

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

      // Vòng viền sáng hoàng kim dưới chân bồ đoàn
      ctx.globalAlpha = 0.92 * a;
      ctx.translate(v.x, v.y - 10 * ws);
      ctx.scale(1, 0.42);
      ctx.shadowColor = '#ffd875';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = '#fff2be';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, 132 * ws * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(226, 176, 79, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 152 * ws * pulse, 0, Math.PI * 2);
      ctx.stroke();
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

      // Nền sơn mài trầm ấm + viền sáng kép rực rỡ
      ctx.shadowColor = 'rgba(255, 218, 120, 0.95)';
      ctx.shadowBlur = pulseGlow;
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

      ctx.shadowBlur = 0;
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
    BOW_KEYFRAMES_12,
  };
})(window);

