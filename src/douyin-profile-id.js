function compactText(value) {
  return String(value || '').replace(/\s+/g, '');
}

function formatLocalMinute(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function parseReviewExtra(aweme) {
  const raw = aweme?.status?.review_result?.extra;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function extractProfileApiRecords(payload) {
  const list = Array.isArray(payload?.aweme_list)
    ? payload.aweme_list
    : Array.isArray(payload?.awemeList) ? payload.awemeList : [];
  return list.map((aweme) => {
    const videoId = String(aweme?.aweme_id || aweme?.item_id || '');
    if (!/^\d{10,}$/.test(videoId)) return null;
    const createTime = Number(aweme?.create_time || 0);
    const reviewExtra = parseReviewExtra(aweme);
    const scheduleDetail = [
      reviewExtra.bottom_status_detail,
      reviewExtra.bottom_tool_text,
      reviewExtra.bottom_status_desc,
      reviewExtra.status_desc_label
    ].filter(Boolean).join('；');
    return {
      videoId,
      videoUrl: `https://www.douyin.com/video/${videoId}`,
      body: String(aweme?.desc || aweme?.title || ''),
      scheduledLocal: createTime > 0 ? formatLocalMinute(createTime * 1000) : '',
      scheduleDetail,
      source: 'profile-api'
    };
  }).filter(Boolean);
}

function mergeProfileRecords(apiRecords, linkRecords) {
  const merged = new Map();
  for (const record of linkRecords || []) {
    if (!record?.videoId) continue;
    merged.set(record.videoId, { ...record, source: record.source || 'profile-link' });
  }
  for (const record of apiRecords || []) {
    if (!record?.videoId) continue;
    merged.set(record.videoId, { ...(merged.get(record.videoId) || {}), ...record });
  }
  return [...merged.values()];
}

function selectProfileRecord(records, body, scheduledLocal) {
  const titleNeedle = compactText(body).slice(0, 18);
  const expectedMinute = String(scheduledLocal || '').slice(0, 16);
  if (!titleNeedle) return { state: 'missing-title', titleNeedle, expectedMinute };
  const titleMatches = (records || []).filter((record) => compactText(record.body).includes(titleNeedle));
  const timedMatches = titleMatches.filter((record) => (
    record.scheduledLocal === expectedMinute
    || compactText(record.scheduleDetail).includes(compactText(expectedMinute))
  ));
  if (timedMatches.length === 1) {
    return { state: 'matched', record: timedMatches[0], titleNeedle, expectedMinute };
  }
  if (timedMatches.length > 1) {
    return { state: 'ambiguous', candidates: timedMatches, titleNeedle, expectedMinute };
  }
  return {
    state: titleMatches.length ? 'time-mismatch' : 'title-mismatch',
    candidates: titleMatches,
    titleNeedle,
    expectedMinute
  };
}

module.exports = {
  compactText,
  formatLocalMinute,
  extractProfileApiRecords,
  mergeProfileRecords,
  selectProfileRecord
};
