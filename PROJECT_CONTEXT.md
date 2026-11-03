# PROJECT_CONTEXT — Chánh Điện Online (TikTok LIVE overlay)

Tài liệu bàn giao cho agent tiếp tục phát triển. Đọc hết trước khi làm bất cứ việc gì.

---

## 1. Dự án là gì

Overlay dọc 1080×1920 cho TikTok LIVE: một chánh điện Phật giáo Việt Nam. Người xem **bình luận** thì vào ngồi bồ đoàn, **tặng quà** thì được xướng tên cảm ơn bằng giọng đọc, có nhạc thiền, mõ, chuông, tụng kinh định kỳ. Chủ kênh phát bằng TikTok LIVE Studio (Window capture cửa sổ overlay).

- Dựa trên repo MIT `kentjuno/chanh-dien-online`. **Giữ nguyên file `LICENSE`.**
- Không đăng nhập TikTok: server chỉ đọc sự kiện công khai theo `@username`.
- Trạng thái tài khoản: chưa đủ điều kiện LIVE (dưới 50 follow). Mọi sự kiện mới chỉ được kiểm bằng mô phỏng.

## 2. Repo

| Mục | Giá trị |
|---|---|
| Thư mục | `C:\tiktok_live\chanh_dien_live` |
| Remote `origin` | `github.com/thong9843/chanh_dien_live` (Private) |
| Remote `upstream` | `github.com/kentjuno/chanh-dien-online` |
| Tag `goc` | `bee578d` — bản gốc của tác giả. `git diff goc` = toàn bộ thay đổi của mình |
| Mốc commit | `cf8764f` (bản trước Canvas 2.5D) → `fdc85c4` (lên lễ Phật + lạy đơn giản) → `0f1e25f` (dọn lỗi nhỏ) → `c70e594` (6 thầy + ảnh pose). Xem `git log` để biết HEAD hiện tại |
| Ảnh gốc hiệu ứng | `C:\tiktok_live\fx_src\` (ngoài repo) |

```
assets/                 hình + nhạc (đã commit, không bị .gitignore)
  hall.jpg              nền 1080×1920
  c_*.png               6 nhân vật ngồi
  pose_<skin>_<stand|walkL|walkR>.png   ảnh đứng/đi bộ (man, woman, granny)
  fx_*.png              hiệu ứng quà
  music/music1.mp3 … music5.mp3
  fonts/                Noto Serif + Be Vietnam Pro (woff2, OFL) + fonts.css + OFL-*.txt (không gọi Google Fonts)
index.html              bản web tĩnh độc lập (không dùng server)
live/
  server.mjs            Node server: TikTok → WebSocket → overlay; TTS
  overlay.html          canvas 1080×1920 (thứ được phát lên live)
  js/canvas.js          lớp vẽ Canvas 2.5D: Character, khói nhang, Sổ Vàng, ánh sáng ngày/đêm, zoom, CeremonyDirector
  control.html          bảng điều khiển của chủ kênh
  content.json          MỌI chuỗi hiển thị/đọc + toạ độ cảnh (chỉnh ở đây)
  content.defaults.mjs  giá trị mặc định khi content.json lỗi/thiếu khóa
  scripts/check-assets.mjs   npm run check-assets
  package.json          Node 20+, ws, msedge-tts, tiktok-live-connector 2.5.0
```

Chạy: `cd live && npm install && npm start` → mở `http://localhost:3000/live/control.html`.

## 3. Quy tắc bắt buộc

**Code**
- Mỗi bước: nêu kế hoạch → chờ chủ dự án xác nhận → sửa → commit riêng. Message tiếng Việt rõ ràng.
- `git add` theo **từng file**, không dùng `git add -A`. Không push khi chưa được bảo.
- Giữ các lớp bảo mật: server chỉ nghe `127.0.0.1` (không đặt biến `HOST`), kiểm tra Origin/Host, whitelist file tĩnh, render chữ bằng `textContent` (không `innerHTML` mới), kẹp kiểu và khoảng giá trị mọi setting/lệnh qua WebSocket.
- Không thêm dependency nếu không thật cần; nếu thêm thì ghim phiên bản và giải thích.
- Nội dung đến client qua WebSocket (snapshot); `content.json` **không** được phục vụ trực tiếp qua HTTP.
- Chuỗi mới hoặc toạ độ mới → đưa vào `content.json` + `content.defaults.mjs`, không viết cứng (còn nợ: chuỗi/toạ độ Sổ Vàng và nhãn "Nắng Chánh Điện / Đêm Tĩnh Tâm" vẫn viết cứng trong `canvas.js`/`overlay.html`).
- Thời gian lên lễ Phật do **server** là nguồn duy nhất; overlay chỉ chạy theo bản tin `ceremony`, không gửi lệnh ngược.

**Hình ảnh**
- Tạo ảnh: chỉ ảnh, không viết báo cáo, **không vẽ thay bằng Python/Pillow**.
- Phong cách: tranh kỹ thuật số bán tả thực, ánh nến ấm ~2700K, không chữ/ký tự/logo. Chi tiết trong `DESIGN.md` (nếu có trong repo).
- Tượng Phật: ngồi kiết già trên tòa sen, ấn thiền định, trang nghiêm; không chế, không đùa.
- Nhân vật/hiệu ứng tạo trên nền phẳng (#00FF00; hoa sen nền trắng; hào quang nền đen), lưu bản gốc vào `fx_src`, rồi tách nền (mục 6).
- Sau khi thay ảnh: `npm run check-assets` phải 0 lỗi.

## 4. Đã làm xong (so với `goc`)

1. README: bỏ thông tin ngân hàng, ghi nguồn gốc + giấy phép MIT.
2. Đoạn banner credit bị làm rối (XOR) → giải mã, thành `credit` trong `content.json` (`enabled`, `text`, `everyMin [5,10]`, `showSec 7`, `y 1890`, chữ 22px). `index.html` nhúng chuỗi rõ ràng.
3. Gom chuỗi vào `content.json`: `channel`, `labels`, `guide.lines` (cú pháp `**đậm**`), `prayers`, `chants`, câu xướng quà (`{name} {gift} {count} {prayer} {total}`), `demo`. Tên kênh sửa tạm trên control, khởi động lại về giá trị file.
4. Toạ độ cảnh vào `content.json → layout` (mục 5).
5. `npm run check-assets`: tên file, kích thước, PNG có alpha, 4 góc nhân vật trong suốt, hall 1080×1920, có mp3.
6. Sự kiện mới + hàng đợi giọng đọc ưu tiên (mục 7).
7. Thay toàn bộ tài nguyên: nền và 6 nhân vật tranh bán tả thực, 8 hiệu ứng tranh đã tách nền sạch viền, nhạc tự tổng hợp. Đã xóa `anim_*.png`.
8. **Canvas 2.5D** (`live/js/canvas.js`): nhân vật nội suy lerp + scale theo phối cảnh, lạy khi có sự kiện; khói nhang Perlin (tối đa 90 hạt, độ đục ≤ 0.35, tan trước y=880); **Sổ Vàng Công Đức** (cuộn lụa viết tên người cúng dường, hàng đợi 6); **ánh sáng ngày/đêm** (`settings.lightingMode`: auto theo giờ thực | day | night); hào quang sen 5 phút dưới bồ đoàn khi tặng quà lớn hoặc `!quỳ lạy`.
9. **Giọng đọc**: Edge TTS `vi-VN-NamMinhNeural` như bản gốc (HoaiMy chọn được trên control). `spoken()` làm sạch tên (emoji, ký tự lạ) trước khi đọc. VieNeu đã bỏ hẳn (không còn dấu vết trong code/`.gitignore`).
10. **Rút quẻ**: gõ `!xinquẻ`, `cầu an`, `tĩnh tâm`, `!loiphatday` → quẻ + lời Phật dạy (`oracles` trong `content.json`), cooldown 15s/người.
11. **Zoom vào Phật tử** khi tặng quà ≥ 99 xu hoặc follow (`content.json → zoom`: `scaleTo 1.6, holdSec 5, outSec 1.5, cooldownSec 20, maxQueue 3`). Không zoom trong 5 phút **thiền im lặng** (`silentUntil`, nút trên control) và không zoom người đang/đang chờ lên lễ.
12. **Lên lễ Phật** và **lạy đơn giản** (mục 8a).
13. Nhạc nền `music1–5.mp3`.

## 5. Bố cục (`content.json → layout`)

| Khóa | Giá trị | Ý nghĩa |
|---|---|---|
| `halo` | `y 320, scale 1.9, alpha .12` | Hào quang nhấp nháy sau đầu tượng (đầu tượng ở y≈320) |
| `candleGlow` | `x 0, y 250, w 1080, h 1050` | Vùng ánh nến nhấp nháy |
| `incense` | `y 990` | Gốc khói nhang (lư hương ở x 540) |
| `teachers` | 6 vị: trái x 165/275/385 (y 1345/1335/1325, `flip:false`), phải x 695/805/915 (y 1325/1335/1345, `flip:true`), `s 0.40` | Hai dãy thầy, lối giữa để trống. `master` (hào quang) = x 385. Thẻ tên chen chúc thì chỉ hiện thầy trụ trì |
| `altarSpot` | `x 540, y 1350, scale 0.40` | Chỗ người lên lễ (ngay trước bàn thờ, giữa 2 dãy thầy); scale bằng thầy, không nhân scaleBoost |
| `floor` | `yTop 1430, yBot 1870, halfTop 330, halfBot 470` | Vùng xếp chỗ người xem (24/36/64/100 chỗ, lối giữa) |
| `gift.top` | 940 | Khung xướng quà nhỏ (< 99 xu), rộng ≤ 640px, căn giữa |
| `chant.top` | 980 | Khung tụng kinh |
| `toast.top` | 870 | Thông báo share/mốc tim |
| `meritScroll.top` | 1000 | Đỉnh Sổ Vàng (quà ≥ 99 xu); server kẹp ≥ 640 để không che mặt tượng. Rộng `meritScroll.halfW 360` |
| `ui` | `pillsCenterX 459, hintTop 326, hintSec 8, meritLeft 656, meritTop 630, meritW 262, bannerLeft 162, bannerRight 918, giftMaxW 640` | Bố cục UI trong vùng TikTok nhìn thấy (x ≤ 918) |
| `safeZones` | 4 hình chữ nhật | Vùng TikTok che: trên y<230, cột phải x>918, khối dưới-trái x0–810 y1248–1730, dải dưới y1730–1920. Bật lớp phủ đỏ bằng ô trên control (chỉ để canh bố cục) |

`ceremony.bannerTop` 1172 (banner mời lễ), `credit.y` 1222.

Vùng cần tránh che: mặt tượng (y 200–450), góc trên trái (bảng tên), cột phải x>860 (bảng UI).

## 6. Tài nguyên

| File | Kích thước | Ghi chú |
|---|---|---|
| `hall.jpg` | 1080×1920 | Tranh chánh điện. Sàn trống, bàn thờ cao tới y≈1285 |
| `c_man/woman/granny/monk/nun.png` | cao **260**, rộng ~227 | Khung căn tâm theo bồ đoàn; chiều rộng linh hoạt |
| `c_child.png` | cao **229**, rộng 142 | |
| `fx_petal` 204×209, `fx_incense` 189×220, `fx_lotus` 229×220, `fx_bell` 286×220, `fx_halo` 229×220 | | Dùng trong overlay |
| `fx_mo` 236×220, `fx_scroll` 281×220, `fx_banner` 323×159 | | Nạp nhưng hiện chưa vẽ ở đâu |
| `pose_man/woman/granny_{stand,walkL,walkR}.png` | cao 417–480, rộng 139–187 | Ảnh đứng sau lưng, đáy = chân, giữa = trục chân, cùng bề rộng đầu với `c_<skin>.png`. Đủ bộ 3 ảnh thì skin đó được đi bộ lên bàn thờ. Thêm `pose_<skin>_kneel` + `pose_<skin>_prostrate` (đã có đủ cho man/woman/granny; đáy ảnh = gối/bàn chân, cùng tỉ lệ pixel với ảnh đứng) |
| `music1.mp3` … `music5.mp3` | | Nhạc nền, lặp liền mạch (1–2 tự tổng hợp 150s/165s) |

Tất cả nhân vật cùng góc nhìn sau lưng 3/4, cùng bồ đoàn đỏ thẫm, cùng cỡ bồ đoàn khi thu nhỏ.

**Quy trình tách nền đã chốt** (Python + Pillow + NumPy, từ ảnh gốc):
1. Nền xanh: `dom = G - max(R,B)`, `alpha = clip(1-(dom-25)/40, 0, 1)`. Nền trắng: flood-fill từ biên trên `min(R,G,B) > 235`. Nền đen (hào quang): `alpha = max(R,G,B)/255`, rồi chia ngược RGB.
2. Khử xanh mạnh ở pixel viền: `G = min(G, (R+B)/2 + 10)`.
3. Gọt alpha 1px; tô lại màu pixel viền bằng trung bình pixel đục trong bán kính 3px; `alpha = 0` thì RGB = 0.
4. Cắt theo bbox alpha, LANCZOS, căn giữa canvas đúng kích thước. Nhân vật: căn tâm theo bồ đoàn, chuẩn hóa theo bề rộng bồ đoàn.
5. Kiểm: số pixel viền có `G > max(R,B) + 25` phải bằng 0.

## 7. Sự kiện → hiệu ứng

| Sự kiện | Hành vi |
|---|---|
| Bình luận | Vào ngồi, bong bóng chữ 6s, cúi đầu. Gõ `nam/nữ/bà/sư/ni/tiểu` để đổi nhân vật |
| Quà < 10 xu | Nhang + cánh hoa, đọc tên; hiện khung `#gift` (không Sổ Vàng) |
| Quà 10–98 xu | Sen + nhiều cánh hoa, đọc tên; hiện khung `#gift` (không Sổ Vàng) |
| Quà ≥ 99 xu | Chuông lớn + đánh chuông + mưa hoa, đọc tên; **chỉ** Sổ Vàng (không khung `#gift`) |
| `!thắp nhang` / `!cúng bái` / `!quỳ lạy` | Lên lễ Phật (mục 8a) |
| Quà (chung) | Người tặng phát sáng, cúi lạy; cộng điểm bảng "Công Đức". `gifts.readAll` / `gifts.minDiamonds` (1–50000) chỉnh trên control |
| Thả tim | Tim bay từ chỗ ngồi; mỗi mốc 1000 tim (tổng của phòng) → chuông lớn + câu đọc |
| Follow | Xếp chỗ, mõ 3 tiếng, đọc cảm ơn — **1 lần/người/buổi** (chống spam follow/bỏ follow) |
| Share | Chuông nhỏ + thông báo 4s, không đọc |
| Vào phòng | Chỉ xếp chỗ nếu bật `joinOnEnter` |
| Mõ nền | Gõ đều theo `moBpm`, không gắn sự kiện |

**Hàng đợi giọng đọc** (tối đa 15 câu, ưu tiên ổn định theo thứ tự đến): 4 = say thủ công từ control, 3 = quà ≥99 xu, 2 = follow/mốc tim, 1 = quà nhỏ, 0 = tụng định kỳ. Đầy thì bỏ câu mức thấp nhất (mới nhất). Hơn 8 câu thì gộp quà nhỏ thành 1 câu (tối đa 3 tên + "và n Phật tử khác").

Control có nút thử: chat, quà nhỏ/vừa/lớn, Follow, Share, +1000 tim, Bot mô phỏng, đổ 24/36/64/100 người.

## 8a. Lên lễ Phật và lạy

**Lệnh**: `!thắp nhang` (1 vái + khói nhang bùng ~6s), `!cúng bái` (3 vái + chuông nhỏ ở vái cuối), `!quỳ lạy` (1 vái giữ lâu 1.5s + hào quang sen). Parse không dấu, không phân biệt hoa thường. Mỗi lúc 1 người; hàng chờ tối đa 5 (`maxQueue`); `cooldownSec 300` tính từ lúc **bắt đầu** hành lễ (bị loại khỏi hàng chờ thì không tính); nghỉ `gapSec 0.8` giữa 2 người. Người đang lên lễ/đang chờ không bị nhường chỗ ngồi và không bị zoom. Control có 3 nút thử.

**Dòng thời gian** (`CeremonyDirector` ở `canvas.js`):
- Skin có đủ ảnh pose (man/woman/granny): ngồi → mờ chéo sang đứng tại chỗ (`riseSec 0.4`) → đi: bước ra phía trước hàng, ngang tới lối giữa x=540, thẳng lên altarSpot; đổi `walkL/walkR` mỗi `stepSec 0.35`, nhún `bobPx 2`, scale theo **một hàm theo y** → vái đứng (`ceremony.stand`) → mờ ở bàn thờ → hiện lại ở chỗ ngồi.
- Skin chưa có ảnh pose (monk, nun, child, master): mờ tại chỗ → hiện ở altarSpot (ngồi) → hành lễ (lạy ngồi) → mờ → về chỗ.
- Server tính `walkSec = quãng đường / speedPxPerSec (140)`, kẹp `[minSec 1.2, maxSec 3.5]`; tái tạo công thức xếp ghế của overlay để ước lượng quãng đường (overlay vẫn dùng ghế thật). Tổng thời gian = rise + walk + hành lễ + tail + 2 lần mờ; client quá hạn thì tự kết thúc mượt; lệnh mới đến sớm thì phiên cũ kết thúc trong 0.4s.
- Server gửi `poseSkins`/`poseFiles` trong snapshot; overlay chỉ nạp file có thật.

**Lạy ngồi** (`ceremony.bow`): một lần = cúi `downSec 0.9` → giữ `holdSec 0.6` (quỳ lạy: `prostrateHoldSec 1.5`) → ngẩng `upSec 0.9`; giữa các vái `pauseSec 0.3`. Hạ người `dropPct 0.11`, nén thân `squashPct 0.10`, ngả nhẹ `leanPx 2`; đầu **không** nén, chỉ dịch xuống theo vai (đỉnh đầu hạ ~23px ở kích thước ảnh gốc).
**Quỳ + lạy sát đất** (chỉ `!cúng bái` 3 lạy và `!quỳ lạy` 1 lạy giữ `prostrateHoldSec`; skin đi bộ được và có đủ `pose_<skin>_kneel/prostrate`): tới altarSpot → đứng → mờ chéo sang quỳ (`ceremony.kneel.downSec 0.4`) → mỗi lạy quỳ→lạy `prostrateFadeSec 0.35`, giữ theo `ceremony.bow`, lạy→quỳ 0.35 (nghỉ `pauseSec` giữa các lạy) → quỳ→đứng `upSec 0.4` → mờ về chỗ. Chuông nhỏ khi chạm đỉnh lạy cuối của `!cúng bái`. `ceremony.prostrateExtraDrop` theo skin (mặc định 0, granny 0.06, server kẹp 0–0.12) hạ thêm nửa trên ở pha lạy. Server cộng mọi đoạn mờ chéo vào `totalSec` (`computeCeremonyDurationSec`) và gửi `kneel` trong bản tin `ceremony`. `!thắp nhang` và skin thiếu ảnh vẫn vái như cũ.

**Vái đứng** (`ceremony.stand`): `dropPct 0.09`, `squashPct 0.10`, `waistRatio 0.46`, `headRatio` man/woman 0.17, granny 0.24. Đo trên ảnh thật: đỉnh đầu hạ **17px (man), 15px (woman), 16px (granny)** ở pha sâu nhất, scale 0.40.

Mọi số liệu ở `content.json → ceremony` (`inviteText`, `inviteSec 3`, `fadeSec 0.6`, `incenseBoostSec 6`, `incenseHoldSec 2.2`, `tailSec 0.35`, `bannerTop 1700`, `bow`, `walk`, `stand`).

## 8. Việc còn mở

**Cần kiểm tra trên máy thật**
- Nghe giọng đọc Edge TTS, hai bài nhạc, mõ, chuông; cân âm lượng.
- Xem `fx_halo` trên overlay thật: hào quang không được hiện thành ô vuông sáng.
- Thử với phòng TikTok thật khi tài khoản đủ điều kiện (FOLLOW/SHARE/LIKE mới kiểm bằng mô phỏng; mốc tim dùng `totalLikeCount`, nếu không có thì cộng dồn).
- Kiểm tra đã có `<link rel="icon">` (hết lỗi favicon 404) chưa.
- Ảnh pose cho monk/nun/child (hiện các skin này lên lễ bằng cách mờ tại chỗ).

**Đợt tối ưu hiệu suất (đã làm xong, chưa push)** — số đo trước/sau và nguồn rò rỉ nằm ở message commit và báo cáo cuối đợt

Commit theo thứ tự: nhóm 5 dọn nợ cấu hình · pose quỳ/lạy · 1a (30 fps, lớp tĩnh, chờ phông) · 1b (sprite glow khói, pool có trần, bóng vẽ sẵn; **bỏ 1c** cache sprite) · 2 (hết rò listener do `new Audio` + `createMediaElementSource` mỗi câu TTS; log vòng 500; trần `followed`; TikTok tự nối lại 5→60s kể cả lần đầu thất bại, dừng khi Ngắt) · 4 (vùng an toàn TikTok, xem mục 5) · 7 (phông tự lưu) · sửa `scripts/bench.mjs` (CPU Edge qua Get-Process theo PID).

Đo hiệu suất: `node scripts/bench.mjs <phút> <nhãn> [file]` (bot 100 người, cửa sổ Edge thật, giữ cửa sổ phía trước). So trước/sau chỉ lấy mẫu fps ≥ 20, tính ms CPU/khung.

*Còn lại:*
- **6. Soak test** (`live/scripts/soak.mjs`, 2 giờ, bot 100 người, ghi heap server qua lệnh `stats` chỉ cho control, heap overlay, fps; tiêu chí bộ nhớ đi ngang, fps ≥ 28) — chưa viết/chạy.
- Chưa thử với phòng TikTok thật; tự nối lại mới kiểm bằng tên kênh không tồn tại.
- `#plaque` (tên thiền đường, y 70–220) nằm hoàn toàn trong vùng TikTok che phía trên; chưa dời vì mọi chỗ trống dưới y 230 đều đè mặt tượng. Cân nhắc bỏ hoặc thu gọn.
- Thẻ quẻ 4 dòng lấn ~20px vào khối dưới-trái; banner mời lễ có thể đè đáy khung tụng kinh khi trùng thời điểm.

**Nhỏ, cân nhắc**
- Chế độ 64/100 người: tên bị cắt ("Thiện…") vì hàng dày.
- Thẻ hướng dẫn (trái) và bảng Công Đức (phải) hơi chạm mép tòa sen.
- Nút "bấm để bật âm thanh" nằm trên hàng ngồi tới khi bấm (chủ kênh bấm trước khi Go LIVE).
- `c_nun` trông giống nam đội mũ len; `c_monk` mặc y kiểu Nam tông (trần vai) — có thể vẽ lại theo Bắc tông Việt Nam (áo nhật bình nâu kín vai).
- `fx_mo`, `fx_scroll`, `fx_banner` chưa được vẽ ở đâu.

**Ý tưởng tiếp theo** (chưa quyết, hỏi chủ dự án trước)
- Sprite đi vào/ngồi xuống bằng tranh thật (`anim_*.png`, 8 khung).
- Chủ đề khác dùng lại khung code qua `content.json` + bộ tài nguyên mới (thả đèn hoa đăng, cây ước nguyện, góc học bài lofi).
- Chế độ quay video ngắn (cảnh đông người) để đăng TikTok kéo follow.

## 9. Cách làm việc với chủ dự án

- Trả lời tiếng Việt, ngắn gọn. Có ảnh để duyệt thì gửi **trước** khi commit (đã thống nhất cho từng bước).
- Trước khi sửa: liệt kê file sẽ đụng và lý do. Sau khi sửa: báo commit hash, cách đã kiểm thử, điểm chưa kiểm được.
- Gặp điều trái với tài liệu này: dừng lại và hỏi, không tự quyết.
