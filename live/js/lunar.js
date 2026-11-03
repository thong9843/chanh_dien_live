/**
 * Đổi dương lịch → âm lịch Việt Nam (UTC+7), chạy hoàn toàn offline.
 * Thuật toán của Hồ Ngọc Đức (https://www.informatik.uni-leipzig.de/~duc/amlich/), viết lại gọn cho trình duyệt.
 * globalThis.Lunar = { solarToLunar(d, m, y), nowLunar(ms), festivalScene(lunar, cfg) }
 */
(function (g) {
  'use strict';
  const PI = Math.PI, floor = Math.floor, TZ = 7;

  function jdFromDate(dd, mm, yy) {
    const a = floor((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
    let jd = dd + floor((153 * m + 2) / 5) + 365 * y + floor(y / 4) - floor(y / 100) + floor(y / 400) - 32045;
    if (jd < 2299161) jd = dd + floor((153 * m + 2) / 5) + 365 * y + floor(y / 4) - 32083;
    return jd;
  }
  function newMoon(k) {
    const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
    let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 -= 0.4068 * Math.sin(Mpr * dr);
    C1 += 0.0161 * Math.sin(dr * 2 * Mpr);
    C1 -= 0.0004 * Math.sin(dr * 3 * Mpr);
    C1 += 0.0104 * Math.sin(dr * 2 * F);
    C1 -= 0.0051 * Math.sin(dr * (M + Mpr));
    C1 -= 0.0074 * Math.sin(dr * (M - Mpr));
    C1 += 0.0004 * Math.sin(dr * (2 * F + M));
    C1 -= 0.0004 * Math.sin(dr * (2 * F - M));
    C1 -= 0.0006 * Math.sin(dr * (2 * F + Mpr));
    C1 += 0.0010 * Math.sin(dr * (2 * F - Mpr));
    C1 += 0.0005 * Math.sin(dr * (2 * Mpr + M));
    const dT = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
    return Jd1 + C1 - dT;
  }
  function sunLongitude(jdn) {
    const T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = PI / 180;
    const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
    DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
    let L = (L0 + DL) * dr;
    L -= PI * 2 * floor(L / (PI * 2));
    return L;
  }
  const sunLong = day => floor(sunLongitude(day - 0.5 - TZ / 24) / PI * 6);
  const newMoonDay = k => floor(newMoon(k) + 0.5 + TZ / 24);
  function lunarMonth11(yy) {
    const off = jdFromDate(31, 12, yy) - 2415021, k = floor(off / 29.530588853);
    let nm = newMoonDay(k);
    if (sunLong(nm) >= 9) nm = newMoonDay(k - 1);
    return nm;
  }
  function leapOffset(a11) {
    const k = floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
    let last, i = 1, arc = sunLong(newMoonDay(k + i));
    do { last = arc; i++; arc = sunLong(newMoonDay(k + i)); } while (arc !== last && i < 14);
    return i - 1;
  }
  // → { day, month, year, leap }
  function solarToLunar(dd, mm, yy) {
    const dayNumber = jdFromDate(dd, mm, yy), k = floor((dayNumber - 2415021.076998695) / 29.530588853);
    let monthStart = newMoonDay(k + 1);
    if (monthStart > dayNumber) monthStart = newMoonDay(k);
    let a11 = lunarMonth11(yy), b11 = a11, year;
    if (a11 >= monthStart) { year = yy; a11 = lunarMonth11(yy - 1); } else { year = yy + 1; b11 = lunarMonth11(yy + 1); }
    const day = dayNumber - monthStart + 1, diff = floor((monthStart - a11) / 29);
    let leap = 0, month = diff + 11;
    if (b11 - a11 > 365) {
      const lm = leapOffset(a11);
      if (diff >= lm) { month = diff + 10; if (diff === lm) leap = 1; }
    }
    if (month > 12) month -= 12;
    if (month >= 11 && diff < 4) year -= 1;
    return { day, month, year, leap };
  }
  // Ngày âm lịch tại thời điểm ms (giờ Việt Nam UTC+7, không phụ thuộc múi giờ máy)
  function nowLunar(ms) {
    const d = new Date((ms === undefined ? Date.now() : ms) + TZ * 3600e3);
    return solarToLunar(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
  }
  // Chọn cảnh lễ hội theo ngày âm; null = không phải ngày lễ (dùng cảnh ngày/đêm núi). Ưu tiên Vu Lan > Phật Đản > Rằm.
  // cfg = content.json → scene.lunar { vulan:{month,from,to}, phatdan:{month,from,to}, ram:{from,to} }
  function festivalScene(l, cfg) {
    if (!l || l.leap) return null;
    const inR = (r, d) => d >= r.from && d <= r.to;
    if (l.month === cfg.vulan.month && inR(cfg.vulan, l.day)) return 'vulan';
    if (l.month === cfg.phatdan.month && inR(cfg.phatdan, l.day)) return 'phatdan';
    if (inR(cfg.ram, l.day)) return 'ram';
    return null;
  }
  g.Lunar = { solarToLunar, nowLunar, festivalScene };
})(typeof globalThis !== 'undefined' ? globalThis : window);
