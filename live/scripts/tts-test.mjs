#!/usr/bin/env node
/**
 * Test hiệu năng và độ ổn định của VieNeu TTS Sidecar
 * Chạy 20 câu kiểm thử với giọng chính Thiền Tâm Đức
 */

const VIENEU_PORT = process.env.VIENEU_PORT || '8765';
const VIENEU_BASE = (process.env.VIENEU_URL || `http://127.0.0.1:${VIENEU_PORT}`).replace(/\/+$/, '');

const TEST_SENTENCES = [
  "Tùy hỷ Phật tử Hải Đăng, Ngọc Hữu đã dâng hoa sen.",
  "Nam mô A Di Đà Phật.",
  "Tùy hỷ Phật tử Minh An đã kết duyên lành.",
  "Pháp ngữ gửi Phật tử Tuệ Quang.",
  "Hận thù diệt hận thù, là điều không thể có. Từ bi diệt hận thù, là định luật ngàn thu.",
  "Tâm dẫn đầu mọi pháp, tâm là chủ, tâm tạo tác.",
  "Tùy hỷ công đức Phật tử Diệu Thiện đã dâng đèn hoa đăng.",
  "Thắng vạn quân giặc không bằng tự thắng mình. Tự thắng mình là chiến công oanh liệt nhất.",
  "Chớ khinh điều thiện nhỏ, cho rằng không ích gì. Từng giọt nước nhỏ tràn bình.",
  "Tùy hỷ Phật tử Thiện Nhân đã phát tâm cúng dường.",
  "Tỉnh thức là con đường đưa đến bình an bất tử. Buông lung là con đường dẫn tới trầm luân.",
  "Quá khứ đã qua, tương lai chưa tới. Chỉ có phút giây hiện tại là mầu nhiệm.",
  "Người biết đủ là người giàu có nhất. Người có bình an là người hạnh phúc nhất.",
  "Lời nói hòa ái đem lại an lạc cho muôn loài.",
  "Tâm bình thế giới bình, tâm an vạn sự an.",
  "Ơn cha mẹ sinh thành dưỡng dục sâu dày như biển trời.",
  "Gieo nhân lành gặt quả ngọt, gieo nhân thiện ắt hưởng phước lành.",
  "Nhẫn một chút sóng yên gió lặng, lùi một bước biển rộng trời cao.",
  "Nguyện cầu quốc thái dân an, phong điều vũ thuận, chúng sinh an lạc.",
  "Tùy hỷ công đức vô lượng của toàn thể đại chúng."
];

async function main() {
  console.log('='.repeat(70));
  console.log(` KIỂM THỬ VIENEU-TTS SIDECAR (${VIENEU_BASE})`);
  console.log(` Tổng số câu: ${TEST_SENTENCES.length}`);
  console.log('='.repeat(70));

  // Kiểm tra sức khỏe sidecar
  try {
    const hRes = await fetch(`${VIENEU_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!hRes.ok) throw new Error(`HTTP ${hRes.status}`);
    const hData = await hRes.json();
    console.log(`✓ Sidecar đang chạy: Thiết bị = ${String(hData.device).toUpperCase()}, Giọng mặc định = ${hData.voice}\n`);
  } catch (err) {
    console.error(`✗ Không kết nối được tới VieNeu Sidecar tại ${VIENEU_BASE}: ${err.message}`);
    process.exit(1);
  }

  let okCount = 0;
  let failCount = 0;
  const durations = [];

  for (let i = 0; i < TEST_SENTENCES.length; i++) {
    const text = TEST_SENTENCES[i];
    const t0 = performance.now();
    try {
      const res = await fetch(`${VIENEU_BASE}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: 'Thiền Tâm Đức',
          speed: 0.9
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) {
        const errDetail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errDetail}`);
      }

      const buf = await res.arrayBuffer();
      const sec = (performance.now() - t0) / 1000;
      durations.push(sec);
      okCount++;

      console.log(`[${String(i + 1).padStart(2)}/${TEST_SENTENCES.length}] OK (${sec.toFixed(2)}s, ${buf.byteLength} bytes): "${text.slice(0, 48)}${text.length > 48 ? '…' : ''}"`);
    } catch (err) {
      const sec = (performance.now() - t0) / 1000;
      failCount++;
      console.error(`[${String(i + 1).padStart(2)}/${TEST_SENTENCES.length}] FAIL (${sec.toFixed(2)}s): "${text.slice(0, 32)}…" - Lỗi: ${err.message}`);
    }
  }

  const avgSec = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const minSec = durations.length ? Math.min(...durations) : 0;
  const maxSec = durations.length ? Math.max(...durations) : 0;

  console.log('\n' + '='.repeat(70));
  console.log(' KẾT QUẢ KIỂM THỬ:');
  console.log(`  • Thành công (OK): ${okCount}/${TEST_SENTENCES.length}`);
  console.log(`  • Thất bại (FAIL): ${failCount}/${TEST_SENTENCES.length}`);
  console.log(`  • Thời gian trung bình mỗi câu: ${avgSec.toFixed(2)} giây`);
  console.log(`  • Nhanh nhất: ${minSec.toFixed(2)}s  ·  Chậm nhất: ${maxSec.toFixed(2)}s`);
  console.log('='.repeat(70));

  if (failCount > 0) process.exit(1);
}

main().catch(err => {
  console.error('Lỗi kiểm thử:', err);
  process.exit(1);
});
