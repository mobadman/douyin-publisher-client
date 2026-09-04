const path = require('node:path');
const { chromium } = require('playwright');

const targetId = process.argv[2];
const accountId = process.argv[3] || 'test-account';

if (!/^\d{10,}$/.test(String(targetId || ''))) {
  throw new Error('用法：node scripts/diagnose-profile-id.js <modal_id> [test-account|production-account]');
}

const profilePath = path.join(
  process.env.APPDATA,
  'short-video-publisher-client-runtime',
  'chrome-profiles',
  accountId
);

const pickedKeys = new Set([
  'aweme_id', 'item_id', 'itemId', 'modal_id', 'desc', 'title',
  'create_time', 'publish_time', 'schedule_time', 'status', 'is_top'
]);

function findTargetObjects(value, trail = '$', results = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value) || results.length >= 20) return results;
  seen.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  const text = JSON.stringify(value);
  if (text.includes(targetId)) {
    const summary = {};
    for (const [key, child] of Object.entries(value)) {
      if (pickedKeys.has(key) || String(child) === targetId) summary[key] = child;
    }
    if (Object.keys(summary).length) results.push({ trail, summary });
  }
  for (const [key, child] of entries) {
    if (child && typeof child === 'object') findTargetObjects(child, `${trail}.${key}`, results, seen);
  }
  return results;
}

(async () => {
  const context = await chromium.launchPersistentContext(profilePath, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
    slowMo: 80
  });
  const page = context.pages()[0] || await context.newPage();
  const responseFindings = [];
  page.on('response', async (response) => {
    if (responseFindings.length >= 30) return;
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('json')) return;
    try {
      const json = await response.json();
      const matches = findTargetObjects(json);
      if (matches.length) responseFindings.push({ url: response.url(), matches });
    } catch {}
  });

  await page.goto(`https://www.douyin.com/user/self?modal_id=${targetId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000
  });
  await page.waitForTimeout(8_000);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const links = await page.locator('a[href]').evaluateAll((anchors) => anchors
    .map((anchor) => ({ href: anchor.href, text: String(anchor.innerText || anchor.textContent || '').trim() }))
    .filter((entry) => entry.href.includes('/video/') || entry.href.includes('modal_id=')));
  const metas = await page.locator('meta[name="description"], meta[property="og:description"], meta[property="og:title"]')
    .evaluateAll((nodes) => nodes.map((node) => ({ key: node.getAttribute('name') || node.getAttribute('property'), content: node.getAttribute('content') })));
  const relevantLines = bodyText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .filter((line) => /21:38|2026[-/.年]08[-/.月]25|明天|定时|发布时间|发布于/.test(line));

  console.log(JSON.stringify({
    targetId,
    accountId,
    finalUrl: page.url(),
    pageTitle: await page.title(),
    targetIdInUrl: new URL(page.url()).searchParams.get('modal_id') === targetId,
    targetIdInBody: bodyText.includes(targetId),
    relevantLines: [...new Set(relevantLines)].slice(0, 100),
    links: links.slice(0, 100),
    metas,
    responseFindings,
    bodyPreview: bodyText.slice(0, 12_000)
  }, null, 2));
  await context.close();
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
