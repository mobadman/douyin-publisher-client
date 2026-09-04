const crypto = require('node:crypto');

const ALLOWED_LINK_HOSTS = new Set([
  'haohuo.jinritemai.com', 'jinritemai.com', 'www.jinritemai.com', 'fxg.jinritemai.com'
]);

function normalizeProductLink(value) {
  const text = String(value || '').trim();
  let url;
  try { url = new URL(text); } catch { throw new Error('现场获取的商品链接格式不正确'); }
  const official = [...ALLOWED_LINK_HOSTS].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== 'https:' || !official) throw new Error('商品链接不是抖店或抖音电商官方域名');
  return url.toString();
}

function nullableNumber(value, round = false) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return round ? Math.round(number) : number;
}

function normalizeCandidate(candidate = {}) {
  const priceCents = nullableNumber(candidate.priceCents, true);
  return {
    id: String(candidate.id || crypto.randomUUID()),
    externalProductId: String(candidate.externalProductId || '').trim(),
    url: normalizeProductLink(candidate.url),
    title: String(candidate.title || '').trim(),
    priceCents,
    stock: nullableNumber(candidate.stock),
    sales: nullableNumber(candidate.sales),
    abnormal: candidate.abnormal === true || (priceCents !== null && priceCents >= 9_999_999),
    enabled: candidate.enabled !== false
  };
}

function resolveCandidateSet(candidates) {
  const normalized = (candidates || []).map(normalizeCandidate);
  const valid = normalized.filter((candidate) => candidate.enabled && !candidate.abnormal);
  if (!valid.length) return { state: 'missing', reason: '现场查询没有可用的正常价格商品', candidates: normalized };
  if (valid.length === 1) return { state: 'ready', candidate: valid[0], candidates: normalized, selectionMode: 'only-candidate' };
  const prices = new Set(valid.map((candidate) => candidate.priceCents).filter((value) => value !== null));
  if (prices.size === 1 && !valid.some((candidate) => candidate.priceCents === null)) {
    const ranked = [...valid].sort((left, right) => (
      (Number(right.stock) || 0) - (Number(left.stock) || 0)
      || (Number(right.sales) || 0) - (Number(left.sales) || 0)
    ));
    return { state: 'ready', candidate: ranked[0], candidates: normalized, selectionMode: 'same-price-ranked' };
  }
  return { state: 'needs-confirmation', reason: '现场查询到多个正常价格不同的商品，需要人工选择', candidates: normalized };
}

module.exports = { ALLOWED_LINK_HOSTS, normalizeProductLink, normalizeCandidate, resolveCandidateSet };
