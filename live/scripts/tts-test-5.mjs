const VIENEU_PORT = process.env.VIENEU_PORT || '8765';
const VIENEU_BASE = (process.env.VIENEU_URL || `http://127.0.0.1:${VIENEU_PORT}`).replace(/\/+$/, '');

const TEST_5 = [
  "Nam mô A Di Đà Phật.",
  "Tùy hỷ Phật tử Minh An đã kết duyên lành.",
  "Pháp ngữ gửi Phật tử Tuệ Quang.",
  "Tâm dẫn đầu mọi pháp, tâm là chủ, tâm tạo tác.",
  "Tùy hỷ công đức Phật tử Diệu Thiện đã dâng đèn hoa đăng."
];

async function run() {
  console.log('='.repeat(70));
  console.log('KIỂM TRA a) VieNeu TTS 5 CÂU LIÊN TIẾP');
  console.log('='.repeat(70));

  const results = [];
  for (let i = 0; i < TEST_5.length; i++) {
    const text = TEST_5[i];
    const t0 = performance.now();
    const res = await fetch(`${VIENEU_BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: 'Thiền Tâm Đức',
        speed: 0.9,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const buf = await res.arrayBuffer();
    const ms = Math.round(performance.now() - t0);
    const item = {
      index: i + 1,
      text,
      status: 'OK',
      durationMs: ms,
      durationSec: (ms / 1000).toFixed(2),
      bytes: buf.byteLength,
      sizeKB: (buf.byteLength / 1024).toFixed(1),
    };
    results.push(item);
    console.log(`[${i + 1}/5] OK | Thời gian: ${ms}ms (${item.durationSec}s) | Kích thước: ${buf.byteLength} bytes (${item.sizeKB} KB) | Câu: "${text}"`);
  }

  console.log('\n--- BẢNG KẾT QUẢ a) ---');
  console.table(results.map(r => ({
    STT: r.index,
    'Câu': r.text,
    'Trạng thái': r.status,
    'Thời gian (ms)': r.durationMs,
    'Kích thước (bytes)': r.bytes
  })));
  console.log('✓ Cả 5 câu kiểm tra đều OK thành công!');
}

run().catch(err => {
  console.error('LỖI a):', err);
  process.exit(1);
});

