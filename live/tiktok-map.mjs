// Đọc sự kiện tiktok-live-connector 2.x (lược đồ tiktok-live-proto v3) — vẫn nhận lược đồ cũ (v1/legacy).
// v3: user.id / user.displayId / user.nickname / user.avatarThumb.urlList; chat: d.content; like: d.count / d.total; roomUser: d.total / d.totalUser.
export function userId(u, fallback){
  const id = u?.uniqueId || u?.displayId || u?.id || u?.userId || fallback;
  return id ? String(id).slice(0, 64) : '';
}
export function userName(u, anon = 'Phật tử'){
  return String(u?.nickname || u?.displayId || u?.uniqueId || anon);
}
export function userAvatar(u){
  return u?.avatarThumb?.urlList?.[0] || u?.avatarThumb?.url?.[0]
      || u?.profilePicture?.urlList?.[0] || u?.profilePicture?.url?.[0]
      || u?.avatarMedium?.urlList?.[0] || '';
}
export function chatText(d){
  return String(d?.content ?? d?.comment ?? '');
}
export function likeCounts(d){
  const n = +(d?.count ?? d?.likeCount ?? 1) || 1;
  const total = +(d?.total ?? d?.totalLikeCount);
  return { n, total: Number.isFinite(total) && total > 0 ? total : undefined };
}
export function viewerCount(d){
  const n = +(d?.total ?? d?.viewerCount ?? d?.totalUser);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
