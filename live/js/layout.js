/**
 * Bố cục v3 dùng chung cho overlay (trình duyệt) và server (Node): chỗ ngồi người xem, các bồ đoàn lễ, các thầy, đường đi lối giữa.
 * KHÔNG có toạ độ nào viết cứng ở đây: mọi số liệu lấy từ content.json → layout.v3 (server đã kẹp khoảng), nên đổi ảnh nền
 * (bồ đoàn nhỏ hơn, lối đi hẹp hơn…) chỉ cần sửa content.json:
 *   cushions[]    {x, y, w}  tâm bồ đoàn, y = mặt bồ đoàn, w = bề rộng; hàng trước = y lớn hơn
 *   aisle         {yTop, yBottom, topX0, topX1, bottomX0, bottomX1}  hai mép lối giữa (thảm đỏ) ở đầu trên và đáy
 *   rug           {x, y, w, h}  tấm thảm chứa bồ đoàn
 *   monkSpots[]   {name, skin, x, y, flip, master}  chỗ ngồi các thầy (chân ở (x, y))
 *   seatArea      {left: [[x,y],…], right: [[x,y],…]}  hai đa giác cho phép người xem ngồi
 *   seats         {perSide, gapK, seatScaleFar:{y,s}, seatScaleNear:{y,s}}  tỉ lệ phối cảnh chung cho MỌI người ngồi (người xem + thầy)
 * Nạp bằng <script> (gán globalThis.LayoutV3) hoặc import('./js/layout.js') trong Node (cũng gán globalThis.LayoutV3).
 */
(function (g) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // Hai mép lối giữa tại độ cao y: nội suy/ngoại suy tuyến tính giữa đầu trên và đáy
  function aisleAt(A, y) {
    const t = (y - A.yTop) / Math.max(1, A.yBottom - A.yTop);
    return { l: lerp(A.topX0, A.bottomX0, t), r: lerp(A.topX1, A.bottomX1, t) };
  }

  // MỘT hệ tỉ lệ chung cho mọi người đang ngồi: phối cảnh tuyến tính theo y qua hai mốc seatScaleFar / seatScaleNear
  function seatedScale(cfg, y) {
    const F = cfg.seats.seatScaleFar, N = cfg.seats.seatScaleNear, t = (y - F.y) / Math.max(1, N.y - F.y);
    return clamp(lerp(F.s, N.s, t), 0.05, 1.5);
  }
  // Nửa bề rộng ảnh ngồi đã vẽ (ảnh c_*.png vẽ với hệ số 1,05 như Character.draw; thẻ tên rộng ~130px)
  const halfSprite = (cfg, scale) => Math.max(scale * 1.05 * cfg.baseW / 2, 65);
  const clampX = (x, half) => clamp(x, 8 + half, 1072 - half);   // cả ảnh và thẻ tên nằm trong khung 8–1072

  // Bồ đoàn, thứ tự = thứ tự ưu tiên chọn chỗ: hàng trước (y lớn) trước, trong hàng từ giữa ra;
  // quy mô theo bề rộng bồ đoàn / 160 (hàng sau 0,74, hàng trước 0,85)
  function buildSpots(cfg) {
    const cs = cfg.cushions, ys = [...new Set(cs.map(c => c.y))].sort((a, b) => b - a);
    const frontY = ys[0], frontXs = cs.filter(c => c.y === frontY).map(c => c.x).sort((a, b) => a - b);
    const gaps = []; for (let i = 0; i + 1 < frontXs.length; i++) gaps.push((frontXs[i] + frontXs[i + 1]) / 2);
    const out = [];
    for (const yy of ys) {
      const row = yy === frontY ? 'front' : 'back';
      for (const c of cs.filter(c => c.y === yy).sort((a, b) => Math.abs(a.x - 540) - Math.abs(b.x - 540) || a.x - b.x)) {
        const gapX = gaps.length ? gaps.reduce((b, v) => Math.abs(v - c.x) < Math.abs(b - c.x) ? v : b, gaps[0]) : c.x;
        out.push({ i: out.length, row, x: c.x, y: c.y + cfg.footDy, cy: c.y, w: c.w, scale: c.w / 160, gapX });
      }
    }
    return out;
  }

  // Đoạn x của đa giác tại hàng y (giao ngang): trả về [x0, x1] rộng nhất hoặc null
  function polySpan(poly, y) {
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    let best = null;
    for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
    return best;
  }

  // Chỗ ngồi hai bên lối giữa, nằm trong hai đa giác seatArea, KHÔNG BAO GIỜ trên lối giữa hay thảm; phối cảnh chung (seatedScale).
  // Tạo hàng trong seatArea theo tỉ lệ, độ chồng lấp ngang ≤ 35%, hàng sau vẽ trước. Số chỗ nhìn thấy tối đa = maxVisibleSeats (mặc định 30).
  function buildSeats(cfg, hideRects) {
    const S = cfg.seats, A = cfg.aisle, rug = cfg.rug;
    const maxVis = cfg.maxVisibleSeats || (S.perSide * 2) || 30;
    const perSide = Math.floor(maxVis / 2);
    const sideSeats = (side, poly) => {
      const yMin = Math.min(...poly.map(p => p[1])) + 0.5, yMax = Math.max(...poly.map(p => p[1])) - 0.5;
      const gen = n => {
        const list = [];
        for (let r = 0; r < n; r++) {
          const y = n === 1 ? (yMin + yMax) / 2 : yMin + (yMax - yMin) * r / (n - 1), sc = seatedScale(cfg, y), w = sc * 1.05 * cfg.baseW;
          const span = polySpan(poly, y); if (!span) continue;
          const e = aisleAt(A, y), onRug = y > rug.y && y < rug.y + rug.h + 40;
          let x0 = span[0], x1 = span[1];
          if (side === 'L') x1 = Math.min(x1, e.l - 4); else x0 = Math.max(x0, e.r + 4);
          if (onRug) { if (side === 'L') x1 = Math.min(x1, rug.x - 4); else x0 = Math.max(x0, rug.x + rug.w + 4); }
          const avail = x1 - x0; if (avail < w) continue;
          const spacing = w * (S.gapK || 0.65), cols = Math.max(1, Math.floor((avail - w) / spacing) + 1);
          for (let k = 0; k < cols; k++) {
            const raw = cols === 1 ? (x0 + x1) / 2 : x0 + w / 2 + k * (avail - w) / (cols - 1);
            const x = clampX(raw, halfSprite(cfg, sc));
            list.push({ x, y, scale: sc, side, flip: side === 'R', edgeDist: side === 'L' ? (e.l - x) : (x - e.r) });
          }
        }
        return list;
      };
      let n = 4, list = gen(n);
      while (list.length < perSide && n < 48) list = gen(++n);
      list.sort((a, b) => a.edgeDist - b.edgeDist);                 // thừa chỗ thì bỏ các chỗ xa lối giữa nhất
      return list.slice(0, perSide);
    };
    const under = s => (hideRects || []).some(r => s.x > r.x - 8 && s.x < r.x + r.w + 8 && s.y > r.y && s.y < r.y + r.h + 60);
    const order = list => list.map(s => (s.hidden = under(s), s)).sort((a, b) => (a.hidden - b.hidden) || (a.y - b.y) || (a.edgeDist - b.edgeDist));
    const L = order(sideSeats('L', cfg.seatArea.left)), R = order(sideSeats('R', cfg.seatArea.right)), seats = [];
    for (let i = 0; i < Math.max(L.length, R.length); i++) { if (L[i]) seats.push(L[i]); if (R[i]) seats.push(R[i]); }
    seats.forEach((s, i) => { s.i = i; });
    return seats;
  }

  // Đường đi từ chỗ ngồi tới bồ đoàn: ngang ra làn trong lối giữa → thẳng lên cổng thảm (mép dưới tấm thảm) → (hàng trước) lên thẳng bồ đoàn
  // / (hàng sau) lách qua khe giữa hai bồ đoàn hàng trước rồi lên. Đi về = đảo ngược. Mốc y suy ra từ rug, không viết cứng.
  function route(cfg, seat, spot) {
    const R = cfg.route, rugBottom = cfg.rug.y + cfg.rug.h, entryY = rugBottom + R.entryDy, gateY = rugBottom + R.gateDy;
    const lane = 540 + (spot.x - 540) * R.laneK;
    const pts = [{ x: seat.x, y: seat.y }, { x: lane, y: seat.y }, { x: lane, y: entryY }];
    if (spot.row === 'front') pts.push({ x: spot.x, y: gateY }, { x: spot.x, y: spot.y });
    else pts.push({ x: spot.gapX, y: gateY }, { x: spot.gapX, y: spot.y + R.backGapDy }, { x: spot.x, y: spot.y });
    return pts;
  }
  function pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; }

  // Thầy ngồi CÙNG hệ tỉ lệ với người xem tại cùng toạ độ y (≈0,72–0,80), không bao giờ nhỏ hơn người xem cùng độ sâu.
  // imgH = cao ảnh thầy, baseH = cao ảnh chuẩn (260). Trả về { s: tỉ lệ vẽ, x: toạ độ x đã kẹp để cả ảnh nằm trong 8–1072 }.
  function monkPlace(cfg, m, imgW, imgH) {
    const vs = seatedScale(cfg, m.y);
    const minS = seatedScale(cfg, cfg.seats.seatScaleFar.y);
    const raw = Math.max(vs, minS) * (cfg.monkWidthK || 1.05);
    const s = Math.max(vs, raw) * (cfg.baseH / (imgH || cfg.baseH));
    return { s, x: clampX(m.x, s * (imgW || cfg.baseW) / 2) };
  }

  g.LayoutV3 = { aisleAt, buildSpots, buildSeats, route, pathLen, seatedScale, monkPlace };
})(typeof globalThis !== 'undefined' ? globalThis : window);
