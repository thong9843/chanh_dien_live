# Chánh Điện Tịnh Tâm

Chánh điện online 2.5D cho TikTok LIVE. Mỗi người xem bình luận là bước vào chánh điện, ngồi xuống bồ đoàn tụng kinh. Ai tặng quà sẽ được xướng tên hồi hướng bằng giọng đọc tiếng Việt. Có nhạc thiền, chuông, mõ và đọc kinh định kỳ.

Mã nguồn chia sẻ miễn phí (MIT). Có hai phần:

| Thư mục | Là gì |
|---|---|
| `index.html`, `assets/` | Bản web tĩnh cho mọi người tự vào ngồi tụng (đăng lên Cloudflare Pages) |
| `live/` | Bộ công cụ phát LIVE: server Node, overlay 9:16, bảng điều khiển |

## Chạy bộ LIVE trên máy phát

Cần Node.js 20 trở lên.

```bash
cd live
npm install
npm start
```

1. Mở `http://localhost:3000/live/control.html` (bảng điều khiển).
2. Chạy `live\start-overlay.bat`, chọn **1** (cửa sổ 540×960) hoặc **2** (cửa sổ 1080×1920 cho màn hình dọc / màn hình ảo, hình nét 1:1). Edge mở ở cửa sổ riêng (không thanh địa chỉ), rồi bấm **Bật âm thanh** một lần trong cửa sổ đó (trình duyệt chặn tự phát tiếng). Cửa sổ dùng hồ sơ Edge riêng và các cờ chống bị làm chậm khi bị che hay thu nhỏ nên quay LIVE ổn định hơn. Nút **Mở màn hình overlay 9:16** trên bảng điều khiển vẫn dùng được nhưng không có các cờ này.
3. Trong TikTok LIVE Studio: *Add source → Window capture* → chọn cửa sổ **chanh_dien_live** (cửa sổ Edge vừa mở), giữ tỷ lệ 9:16. Đừng thu nhỏ (minimize) cửa sổ đó; đặt nó nằm sau LIVE Studio thì vẫn được. Với OBS thì dùng *Browser source* trỏ tới `http://localhost:3000/live/overlay.html`, kích thước 1080×1920.
   - Canvas luôn vẽ nội bộ 1080×1920 (30 khung/giây); cửa sổ 540×960 chỉ là thu nhỏ hiển thị. Muốn nét hơn trên máy thường, sửa `W`/`H` ở lựa chọn 1 của `start-overlay.bat` thành `576×1024`; có màn hình dọc hoặc màn hình ảo 1080×1920 thì dùng lựa chọn 2.
4. Bật LIVE trên TikTok, nhập `@username` vào bảng điều khiển, bấm **Kết nối**.

Chưa live vẫn thử được: dùng **Thử tương tác**, **Đổ người mẫu 15/36/64/100** hoặc **Bot mô phỏng**.

### Người xem làm được gì

- **Bình luận bất kỳ**: được vào ngồi (100 chỗ cố định ở hai bên lối giữa; mỗi người tối đa 1 bình luận mỗi 3 giây). Chỉ 12 người hoạt động gần nhất hiện ảnh đại diện TikTok (chỉ nhận ảnh https từ máy chủ ảnh của TikTok, không có thì hiện chữ cái đầu) và tên. Đầy chỗ thì người im lặng lâu nhất (quá 10 phút, chưa tặng quà) nhường chỗ cho người bình luận mới; người chưa có chỗ được tính vào chip **+N người đang thiền**.
- **`!thắp nhang`, `!cúng bái`, `!quỳ lạy`**: đi lên lối giữa tới một trong 8 bồ đoàn (hàng trước trước), thắp nhang (đứng vái) / quỳ lạy 3 lần / quỳ lạy 1 lần dài, rồi đi về chỗ. Tối đa 8 người cùng lúc, người thêm xếp hàng chờ.
- **Bình luận đúng một từ** `nam`, `nữ`, `sư`, `ni`, `tiểu`, `bà`, `cao tăng`: đổi hình nhân vật. Câu "Nam mô A Di Đà Phật" không bị hiểu nhầm thành "nam".
- **Tặng quà**: banner xướng tên, giọng đọc hồi hướng (lấy lời nguyện từ bình luận gần nhất của người đó nếu có), hiệu ứng theo giá trị quà, cộng điểm vào bảng Công Đức.
- **Thả tim**: tim bay trên đầu nhân vật.

## Chạy trên máy mới

Dùng khi chuyển repo sang máy khác (ví dụ máy có card NVIDIA RTX 2060 để chạy giọng đọc VieNeu bằng GPU).

1. Lấy mã nguồn: `git pull` (hoặc `git clone`). Các thư mục `live/node_modules`, `tts_sidecar/.venv`, mô hình giọng đọc, `live/.env` không nằm trong git nên máy mới phải tạo lại.
2. Cài thư viện Node (cần Node.js 20+): `cd live` rồi `npm install`.
3. Chạy giọng đọc VieNeu: chạy `tts_sidecar\start_tts.bat` (cần Python 3.10+). Lần đầu nó tự tạo `.venv`, cài thư viện, rồi tự chọn bản onnxruntime theo máy: **có card NVIDIA** (`nvidia-smi` chạy được) thì cài `onnxruntime-gpu` và chạy bằng CUDA; **không có** thì cài `onnxruntime` và chạy CPU. Trên CPU, số luồng mặc định là 2, đổi bằng `VIENEU_THREADS=4` trong `tts_sidecar/.env` (hoặc `live/.env`); khi chạy GPU thì biến này bị bỏ qua. Sidecar tự hạ ưu tiên tiến trình xuống BelowNormal để không giành CPU của overlay. Xem `http://127.0.0.1:8765/health` để biết đang chạy `cuda` hay `cpu`.
4. Chạy server: `cd live` rồi `npm start`, mở `http://localhost:3000/live/control.html`. Nếu có khoá EulerStream thì đặt `EULER_API_KEY=...` trong `live/.env`.
5. Mở overlay: `live\start-overlay.bat`, chọn **2** để có cửa sổ 1080×1920 (cần màn hình dọc hoặc màn hình ảo; chọn **1** cho cửa sổ 540×960 thông thường), rồi bấm **Bật âm thanh**.

Không có sidecar vẫn chạy được: giọng đọc tự chuyển sang Edge TTS rồi sang câu đã lưu sẵn trong `live/tts/`.

## Bảo mật

Dự án được viết để ai tải về chạy cũng an toàn mặc định:

- **Không dùng tài khoản TikTok.** Server chỉ đọc sự kiện công khai của phòng live theo username. Không cần, không hỏi và không lưu mật khẩu, cookie hay session. Không gửi tin nhắn thay bạn.
- **Chỉ mở trên máy mình.** Server lắng nghe `127.0.0.1`, máy khác trong mạng hay Internet không truy cập được. Đừng đặt biến `HOST` để mở ra ngoài khi chưa có đăng nhập.
- **Chặn trang web lạ điều khiển.** WebSocket chỉ nhận kết nối từ chính trang của server (kiểm tra `Origin`), và header `Host` phải là localhost (chống DNS rebinding). Một trang web khác đang mở trong cùng trình duyệt không gửi được lệnh. Cửa sổ overlay chỉ nhận dữ liệu, không gửi lệnh được.
- **File tĩnh có danh sách trắng.** Chỉ phục vụ `/assets` và `/live`. Chặn file ẩn (`.git`, `.env`), `node_modules`, mã server, `package.json` và mọi đường dẫn `../`.
- **Không tin dữ liệu vào.** Tên người xem, bình luận và tên quà đều bị cắt độ dài. Cài đặt chỉ nhận đúng khóa, đúng kiểu, trong giới hạn. Văn bản đưa vào giọng đọc được escape XML. Mọi chữ trên màn hình vẽ bằng `textContent` hoặc canvas, không chèn HTML, nên bình luận chứa mã độc chỉ hiện ra như chữ thường.
- **Chống spam.** Hàng đợi giọng đọc tối đa 15 câu. Bình luận thường không đọc thành tiếng.
- **Phụ thuộc ghim phiên bản** trong `live/package.json`: `ws`, `msedge-tts`, `tiktok-live-connector`. Không có khóa API nào trong mã.

Các lớp trên đã được thử: đường dẫn `../`, `%2e%2e`, `.git/config`, `server.mjs`, `package.json` đều trả 404. Host giả trả 421. WebSocket từ Origin lạ bị từ chối. Lệnh gửi từ overlay bị bỏ qua. Cài đặt sai kiểu bị kẹp về giới hạn.

### Lưu ý

- `tiktok-live-connector` là thư viện cộng đồng, không phải API chính thức của TikTok. Nó có thể ngừng chạy khi TikTok đổi hệ thống. Kiểm tra điều khoản TikTok trước khi dùng cho kênh của bạn.
- Giọng đọc dùng dịch vụ Read Aloud của Microsoft Edge qua mạng (giọng Nam Minh, Hoài My). Máy phát cần có Internet.
- Hình ảnh trong `assets/` được tạo bằng Google Flow, nhạc nền tạo bằng Gemini. Kiểm tra điều khoản của các dịch vụ đó trước khi dùng thương mại, hoặc thay bằng tài nguyên của bạn.

## Miễn trừ trách nhiệm

Dự án được chia sẻ **miễn phí, với mục đích học tập và tham khảo lập trình**. Phần mềm được cung cấp "nguyên trạng" (AS IS), không kèm bất kỳ bảo đảm nào, rõ ràng hay ngụ ý.

Khi tải về, sử dụng, chỉnh sửa hoặc phân phối lại mã nguồn này, **bạn tự chịu hoàn toàn trách nhiệm** về:

- Mọi nội dung bạn phát trên livestream hoặc đăng tải, bao gồm hình ảnh, âm thanh, giọng đọc, lời nguyện, bình luận được hiển thị.
- Việc nhận quà, donation hoặc bất kỳ khoản thu nào từ người xem.
- Việc tuân thủ điều khoản sử dụng của TikTok và các nền tảng, dịch vụ bên thứ ba khác (thư viện đọc sự kiện TikTok là thư viện cộng đồng, không chính thức).
- Việc tuân thủ pháp luật nơi bạn sinh sống và hoạt động, kể cả quy định về hoạt động tôn giáo, quảng cáo, thuế và bản quyền.
- Mọi rủi ro và thiệt hại phát sinh, trực tiếp hay gián tiếp, như bị khóa tài khoản, bị dừng live, mất dữ liệu, tranh chấp hay khiếu nại.

Tác giả **không liên quan, không bảo trợ và không chịu trách nhiệm** đối với bất kỳ kênh, tài khoản, sản phẩm hay hoạt động nào sử dụng mã nguồn này. Dự án không đại diện cho bất kỳ chùa, tu viện hay tổ chức tôn giáo nào. Khi dùng nội dung liên quan đến Phật giáo, xin giữ sự tôn kính và không dùng vào mục đích lừa đảo, trục lợi hay xúc phạm niềm tin của người khác.

Việc sử dụng mã nguồn đồng nghĩa với việc bạn đã đọc và đồng ý với các điều trên.

> **Disclaimer (EN):** This project is shared free of charge for educational purposes only and is provided "AS IS", without warranty of any kind. Anyone who uses, modifies or redistributes it is solely responsible for their own content, streams, donations, compliance with TikTok and other platforms' terms, and applicable laws. The author is not affiliated with, does not endorse, and accepts no liability for any channel, account, product or activity built with this code, nor for any direct or indirect damages.

## Nguồn gốc và giấy phép

Dự án này là bản phát triển từ [kentjuno/chanh-dien-online](https://github.com/kentjuno/chanh-dien-online), © 2026 Kent Juno, phát hành theo giấy phép **MIT**. Giữ nguyên file `LICENSE` và thông báo bản quyền gốc. Các phần chỉnh sửa, bổ sung trong bản này cũng theo MIT.
