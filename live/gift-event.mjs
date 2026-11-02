// Đọc dữ liệu quà từ sự kiện GIFT của tiktok-live-connector.
// Thư viện 2.5.0 (proto v3): quà nằm ở d.gift { name, diamondCount, type, id }; d.repeatCount / d.repeatEnd / d.groupId ở ngoài.
// Giữ lại tên cũ (giftDetails.giftName, extendedGiftInfo) làm dự phòng cho bản thư viện khác.
export function readGift(d, defaultName = 'quà'){
  const g = d?.gift, old = d?.giftDetails, ext = d?.extendedGiftInfo;
  const name = g?.name || old?.giftName || ext?.name || defaultName;
  const rawDia = g?.diamondCount ?? old?.diamondCount ?? ext?.diamond_count;
  const diamonds = Number.isFinite(+rawDia) && +rawDia > 0 ? +rawDia : 1;
  const type = g?.type ?? old?.giftType ?? ext?.type;
  const count = Math.max(1, +d?.repeatCount || 1);
  const streaking = type === 1 && !d?.repeatEnd;             // quà dạng chuỗi: chỉ tính khi chuỗi kết thúc
  return { name, diamonds, type, count, streaking, known: rawDia !== undefined && rawDia !== null };
}
