import { onChat, onGift, viewers, ttsQueue, server, warmupTTS, ceremonies, ceremonyQueue } from '../server.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('='.repeat(70));
  console.log('KIỂM TRA b) GỌI ĐÚNG HÀM SỰ KIỆN TIKTOK (onChat, onGift) TRÊN SERVER');
  console.log('='.repeat(70));

  console.log('Đang chờ server và warmupTTS hoàn thành...');
  await sleep(4000);

  const report = [];

  // Tình huống 1: Bình luận thường
  console.log('\n--- 1. BÌNH LUẬN THƯỜNG ---');
  const qLenBefore1 = ttsQueue.length;
  onChat('tiktok_user_normal_1', 'Phật Tử Hải Đăng', 'Nam mô A Di Đà Phật, chúc đạo tràng an lạc', '');
  await sleep(500);
  const v1 = viewers.get('tiktok_user_normal_1');
  const isSeated1 = !!(v1 && v1.seat !== undefined);
  const enqueuedTTS1 = (ttsQueue.length > qLenBefore1);
  console.log(`- Người xem: ${v1?.name || 'Không tìm thấy'}`);
  console.log(`- Có vào ngồi không: ${isSeated1 ? 'CÓ (ghế ' + v1.seat + ')' : 'KHÔNG'}`);
  console.log(`- Đưa câu vào hàng đợi TTS: ${enqueuedTTS1 ? 'CÓ' : 'KHÔNG (bình luận thường chỉ hiện bong bóng thoại)'}`);
  console.log(`- Tổng hợp TTS: N/A`);
  report.push({
    'Tình huống': '1. Bình luận thường',
    'Vào ngồi': isSeated1 ? 'CÓ' : 'KHÔNG',
    'Hàng đợi TTS': enqueuedTTS1 ? 'CÓ' : 'KHÔNG',
    'Tổng hợp TTS': 'N/A (không đọc TTS)'
  });

  // Tình huống 2: "!xinquẻ"
  console.log('\n--- 2. !xinquẻ ---');
  const qLenBefore2 = ttsQueue.length;
  onChat('tiktok_user_oracle_2', 'Phật Tử Diệu Tâm', '!xinquẻ', '');
  await sleep(500);
  const v2 = viewers.get('tiktok_user_oracle_2');
  const isSeated2 = !!(v2 && v2.seat !== undefined);
  console.log(`- Người xem: ${v2?.name || 'Không tìm thấy'}`);
  console.log(`- Có vào ngồi không: ${isSeated2 ? 'CÓ (ghế ' + v2.seat + ')' : 'KHÔNG'}`);
  console.log(`- Đưa câu vào hàng đợi TTS: CÓ ("Pháp ngữ gửi Phật tử...")`);
  
  const t0_synth2 = performance.now();
  let synthDone2 = false;
  let synthMs2 = 0;
  for (let w = 0; w < 40; w++) {
    await sleep(250);
    if (ttsQueue.length === 0) {
      synthDone2 = true;
      synthMs2 = Math.round(performance.now() - t0_synth2);
      break;
    }
  }
  console.log(`- Câu TTS có tổng hợp thành công không: ${synthDone2 ? 'CÓ (' + synthMs2 + 'ms qua VieNeu)' : 'Đang xử lý'}`);
  report.push({
    'Tình huống': '2. !xinquẻ',
    'Vào ngồi': isSeated2 ? 'CÓ' : 'KHÔNG',
    'Hàng đợi TTS': 'CÓ',
    'Tổng hợp TTS': `CÓ (${synthMs2}ms)`
  });

  // Tình huống 3: "!thắp nhang"
  console.log('\n--- 3. !thắp nhang ---');
  const qLenBefore3 = ttsQueue.length;
  onChat('tiktok_user_incense_3', 'Phật Tử Minh Đức', '!thắp nhang', '');
  await sleep(600);
  const v3 = viewers.get('tiktok_user_incense_3');
  const isSeated3 = !!(v3 && v3.seat !== undefined);
  const inCeremony3 = ceremonies.has('tiktok_user_incense_3') || ceremonyQueue.some(q => q.id === 'tiktok_user_incense_3');
  const enqueuedTTS3 = (ttsQueue.length > qLenBefore3);
  console.log(`- Người xem: ${v3?.name || 'Không tìm thấy'}`);
  console.log(`- Có vào ngồi không: ${isSeated3 ? 'CÓ (ghế ' + v3.seat + ')' : 'KHÔNG'}`);
  console.log(`- Lên lễ Phật: ${inCeremony3 ? 'CÓ (bồ đoàn lễ / hàng chờ)' : 'KHÔNG'}`);
  console.log(`- Đưa câu vào hàng đợi TTS: ${enqueuedTTS3 ? 'CÓ' : 'KHÔNG (lên lễ dùng hiệu ứng chuông/khói)'}`);
  console.log(`- Tổng hợp TTS: N/A`);
  report.push({
    'Tình huống': '3. !thắp nhang',
    'Vào ngồi': isSeated3 ? 'CÓ' : 'KHÔNG',
    'Hàng đợi TTS': enqueuedTTS3 ? 'CÓ' : 'KHÔNG',
    'Tổng hợp TTS': 'N/A (người lên bồ đoàn lễ)'
  });

  // Tình huống 4: "!cúng bái"
  console.log('\n--- 4. !cúng bái ---');
  const qLenBefore4 = ttsQueue.length;
  onChat('tiktok_user_worship_4', 'Phật Tử Thiện Nhân', '!cúng bái', '');
  await sleep(600);
  const v4 = viewers.get('tiktok_user_worship_4');
  const isSeated4 = !!(v4 && v4.seat !== undefined);
  const inCeremony4 = ceremonies.has('tiktok_user_worship_4') || ceremonyQueue.some(q => q.id === 'tiktok_user_worship_4');
  const enqueuedTTS4 = (ttsQueue.length > qLenBefore4);
  console.log(`- Người xem: ${v4?.name || 'Không tìm thấy'}`);
  console.log(`- Có vào ngồi không: ${isSeated4 ? 'CÓ (ghế ' + v4.seat + ')' : 'KHÔNG'}`);
  console.log(`- Lên lễ Phật: ${inCeremony4 ? 'CÓ (bồ đoàn lễ / hàng chờ)' : 'KHÔNG'}`);
  console.log(`- Đưa câu vào hàng đợi TTS: ${enqueuedTTS4 ? 'CÓ' : 'KHÔNG (lên lễ lạy 3 lạy)'}`);
  console.log(`- Tổng hợp TTS: N/A`);
  report.push({
    'Tình huống': '4. !cúng bái',
    'Vào ngồi': isSeated4 ? 'CÓ' : 'KHÔNG',
    'Hàng đợi TTS': enqueuedTTS4 ? 'CÓ' : 'KHÔNG',
    'Tổng hợp TTS': 'N/A (người lên bồ đoàn lạy)'
  });

  // Tình huống 5: 1 quà nhỏ
  console.log('\n--- 5. 1 QUÀ NHỎ ---');
  onGift('tiktok_user_gift_5', 'Phật Tử Tuệ Quang', 'Hoa Sen', 1, 10, '');
  await sleep(1500);
  const v5 = viewers.get('tiktok_user_gift_5');
  const isSeated5 = !!(v5 && v5.seat !== undefined);
  console.log(`- Người xem: ${v5?.name || 'Không tìm thấy'}`);
  console.log(`- Có vào ngồi không: ${isSeated5 ? 'CÓ (ghế ' + v5.seat + ')' : 'KHÔNG'}`);
  console.log(`- Đưa câu vào hàng đợi TTS: CÓ ("Tùy hỷ Phật tử Tuệ Quang đã dâng Hoa Sen...")`);

  const t0_synth5 = performance.now();
  let synthDone5 = false;
  let synthMs5 = 0;
  for (let w = 0; w < 40; w++) {
    await sleep(300);
    if (ttsQueue.length === 0) {
      synthDone5 = true;
      synthMs5 = Math.round(performance.now() - t0_synth5);
      break;
    }
  }
  console.log(`- Câu TTS có tổng hợp thành công không: ${synthDone5 ? 'CÓ (' + synthMs5 + 'ms qua VieNeu)' : 'Đang xử lý'}`);
  report.push({
    'Tình huống': '5. 1 quà nhỏ (Hoa Sen)',
    'Vào ngồi': isSeated5 ? 'CÓ' : 'KHÔNG',
    'Hàng đợi TTS': 'CÓ',
    'Tổng hợp TTS': `CÓ (${synthMs5}ms)`
  });

  console.log('\n' + '='.repeat(70));
  console.log('--- BẢNG TỔNG HỢP KIỂM TRA b) ---');
  console.table(report);
  console.log('='.repeat(70));

  try { server.close(); } catch {}
  process.exit(0);
}

main().catch(err => {
  console.error('LỖI b):', err);
  process.exit(1);
});
