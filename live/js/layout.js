/**
 * Bố cục v3 dùng chung cho overlay (trình duyệt) và server (Node): chỗ ngồi người xem, 8 bồ đoàn lễ, các thầy, đường đi lối giữa.
 * Mọi số liệu lấy từ content.json → layout.v3 (server đã kẹp khoảng) nên hai phía luôn tính ra cùng một kết quả.
 * Nạp bằng <script> (gán globalThis.LayoutV3) hoặc import('./js/layout.js') trong Node (cũng gán globalThis.LayoutV3).
 */
(function (g) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // Hai mép lối giữa (thảm đỏ) tại độ cao y: nội suy tuyến tính giữa đầu trên và đáy
  function aisleAt(A, y) {
    const t = (y - A.yTop) / Math.max(1, A.yBot - A.yTop);
    return { l: lerp(A.topL, A.botL, t), r: lerp(A.topR, A.botR, t) };
  }

  // Bề rộng bồ đoàn tại y (nội suy/ngoại suy giữa hàng sau và hàng trước): dùng để định cỡ các thầy theo phối cảnh
  function cushionW(C, y) {
    const k = (y - C.back.y) / (C.front.y - C.back.y);
    return Math.max(20, lerp(C.back.w, C.front.w, k));
  }

  // Tám bồ đoàn, thứ tự = thứ tự ưu tiên chọn chỗ: hàng trước trước (từ giữa ra), rồi hàng sau (từ giữa ra)
  function buildSpots(cfg) {
    const C = cfg.cushions, out = [];
    const frontXs = C.front.x.slice().sort((a, b) => a - b);
    const gaps = []; for (let i = 0; i + 1 < frontXs.length; i++) gaps.push((frontXs[i] + frontXs[i + 1]) / 2);
    for (const rowName of ['front', 'back']) {
      const R = C[rowName];
      for (const x of R.x.slice().sort((a, b) => Math.abs(a - 540) - Math.abs(b - 540) || a - b)) {
        const gapX = gaps.length ? gaps.reduce((b, v) => Math.abs(v - x) < Math.abs(b - x) ? v : b, gaps[0]) : x;
        out.push({ i: out.length, row: rowName, x, y: R.y + C.footDy, cy: R.y, w: R.w, scale: R.w * cfg.spriteK / cfg.baseW, gapX });
      }
    }
    return out;
  }

  // MỘT hệ tỉ lệ chung cho mọi người đang ngồi (người xem VÀ các thầy): phối cảnh tuyến tính theo y, nội/ngoại suy từ hai mốc seats.yMin/yMax.
  function seatedScale(cfg, y) {
    const S = cfg.seats, t = (y - S.yMin) / Math.max(1, S.yMax - S.yMin);
    return clamp(lerp(S.scaleTop, S.scaleBottom, t), 0.08, 1.2);
  }
  // Nửa bề rộng ảnh ngồi đã vẽ (ảnh c_*.png vẽ với hệ số 1,05 như Character.draw)
  const halfSprite = (cfg, scale) => scale * 1.05 * cfg.baseW / 2;
  const clampX = (x, half) => clamp(x, 8 + half, 1072 - half);   // cả ảnh nằm trong khung 8–1072

  // Chỗ ngồi hai bên lối giữa: lấp đầy y∈[yMin,yMax], không bao giờ chạm lối giữa/thảm; phối cảnh: càng xuống càng to.
  // Mỗi bên perSide chỗ, thứ tự ưu tiên chọn chỗ: chỗ không bị thẻ chữ che trước, hàng trước (y lớn) trước, sát lối giữa trước, xen kẽ trái–phải.
  function buildSeats(cfg, hideRects) {
    const S = cfg.seats, A = cfg.aisle, perSide = S.perSide;
    const scaleAt = y => seatedScale(cfg, y);
    const rowsFor = n => { const ys = []; for (let r = 0; r < n; r++) ys.push(n === 1 ? (S.yMin + S.yMax) / 2 : S.yMin + (S.yMax - S.yMin) * r / (n - 1)); return ys; };
    const sideSeats = side => {
      const gen = n => {
        const list = [];
        for (const y of rowsFor(n)) {
          const e = aisleAt(A, y), sc = scaleAt(y), w = sc * cfg.baseW;
          const x0 = side < 0 ? S.margin : e.r + S.edgeGap, x1 = side < 0 ? e.l - S.edgeGap : 1080 - S.margin;
          const avail = x1 - x0; if (avail < w) continue;
          const spacing = w * S.gapK, cols = Math.max(1, Math.floor((avail - w) / spacing) + 1);
          for (let k = 0; k < cols; k++) {
            const x = clampX(cols === 1 ? (x0 + x1) / 2 : x0 + w / 2 + k * (avail - w) / (cols - 1), halfSprite(cfg, sc));
            list.push({ x, y, scale: sc, side: side < 0 ? 'L' : 'R', flip: side > 0, edgeDist: side < 0 ? (e.l - x) : (x - e.r) });
          }
        }
        return list;
      };
      let n = 4, list = gen(n);
      while (list.length < perSide && n < 40) list = gen(++n);
      list.sort((a, b) => a.edgeDist - b.edgeDist);                 // thừa chỗ thì bỏ các chỗ xa lối giữa nhất
      return list.slice(0, perSide);
    };
    const under = s => (hideRects || []).some(r => s.x > r.x - 8 && s.x < r.x + r.w + 8 && s.y > r.y && s.y < r.y + r.h + 60);
    const order = list => list.map(s => (s.hidden = under(s), s)).sort((a, b) => (a.hidden - b.hidden) || (b.y - a.y) || (a.edgeDist - b.edgeDist));
    const L = order(sideSeats(-1)), R = order(sideSeats(1)), seats = [];
    for (let i = 0; i < Math.max(L.length, R.length); i++) { if (L[i]) seats.push(L[i]); if (R[i]) seats.push(R[i]); }
    seats.forEach((s, i) => { s.i = i; });
    return seats;
  }

  // Đường đi từ chỗ ngồi tới bồ đoàn: ngang ra làn trong lối giữa → thẳng lên cổng thảm → (hàng trước) lên thẳng bồ đoàn
  // / (hàng sau) lách qua khe giữa hai bồ đoàn hàng trước rồi lên. Đi về = đảo ngược.
  function route(cfg, seat, spot) {
    const R = cfg.route, lane = 540 + (spot.x - 540) * R.laneK;
    const pts = [{ x: seat.x, y: seat.y }, { x: lane, y: seat.y }, { x: lane, y: R.entryY }];
    if (spot.row === 'front') pts.push({ x: spot.x, y: R.gateY }, { x: spot.x, y: spot.y });
    else pts.push({ x: spot.gapX, y: R.gateY }, { x: spot.gapX, y: spot.y + R.backGapDy }, { x: spot.x, y: spot.y });
    return pts;
  }
  function pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; }

  // Thầy ngồi CÙNG hệ tỉ lệ với người xem: cao ảnh thầy = cao ảnh người xem ở cùng độ sâu y × monkWidthK (1,05). imgH = cao ảnh thầy (c_monk.png),
  // baseH = cao ảnh chuẩn (260). Trả về { s: tỉ lệ vẽ, x: toạ độ x đã kẹp để cả ảnh nằm trong 8–1072 }.
  function monkPlace(cfg, m, imgW, imgH) {
    const s = seatedScale(cfg, m.y) * 1.05 * cfg.monkWidthK * (cfg.baseH / (imgH || cfg.baseH));
    return { s, x: clampX(m.x, s * (imgW || cfg.baseW) / 2) };
  }

  g.LayoutV3 = { aisleAt, cushionW, buildSpots, buildSeats, route, pathLen, seatedScale, monkPlace };
})(typeof globalThis !== 'undefined' ? globalThis : window);
