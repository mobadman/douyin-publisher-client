const fs = require('node:fs');
const { chromium } = require('playwright');

const PRODUCT_LIST_URL = 'https://fxg.jinritemai.com/ffa/g/list';

function numberFromText(text) {
  const value = Number(String(text || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(value) ? value : null;
}

function candidateFromRowText(text, url = '') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const productId = normalized.match(/(?:商品)?ID[：:]?\s*(\d{8,})/i)?.[1] || '';
  const price = normalized.match(/[￥¥]\s*([\d,.]+)/)?.[1];
  const stock = normalized.match(/(?:总库存|库存)[：:]?\s*(\d+)/)?.[1];
  const sales = normalized.match(/(?:总销量|销量)[：:]?\s*(\d+)/)?.[1];
  return {
    externalProductId: productId,
    url,
    title: normalized.slice(0, 180),
    priceCents: price ? Math.round(Number(price.replace(/,/g, '')) * 100) : null,
    stock: stock ? Number(stock) : null,
    sales: sales ? Number(sales) : null
  };
}

async function searchCandidatesOnPage(page, model) {
  const keyword = String(model || '').trim();
  if (!keyword) throw new Error('抖店搜索型号不能为空');
  if (!page.url().startsWith(PRODUCT_LIST_URL)) await page.goto(PRODUCT_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const search = page.locator('input:not([type="hidden"])').first();
  const likelySearch = page.locator('input[placeholder*="搜索"], input[placeholder*="商品"], input[placeholder*="名称"]').first();
  const input = await likelySearch.count() ? likelySearch : search;
  await input.fill(keyword);
  const query = page.getByRole('button', { name: /查询|搜索/ }).first();
  if (await query.isVisible().catch(() => false)) await query.click();
  else await input.press('Enter');
  await page.waitForTimeout(1800);
  const rows = page.locator('tr').filter({ hasText: '复制链接' });
  const candidates = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const text = await row.innerText().catch(() => '');
    const copy = row.getByText('复制链接', { exact: true }).first();
    if (!await copy.isVisible().catch(() => false)) continue;
    await page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
    await copy.click();
    await page.waitForTimeout(200);
    const url = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    if (/^https:\/\//.test(url)) candidates.push(candidateFromRowText(text, url));
  }
  if (!candidates.length) throw new Error(`抖店中没有读取到“${keyword}”的可复制商品链接，请人工检查搜索结果`);
  return candidates;
}

class DoudianBrowserManager {
  constructor() { this.active = null; }
  status() { return this.active ? { activeAccountId: this.active.accountId, open: true } : { activeAccountId: null, open: false }; }

  async open(account) {
    if (this.active && this.active.accountId !== account.id) throw new Error('另一个抖店账号浏览器仍在运行，请先关闭');
    if (this.active) { const page = await this.page(); await page.bringToFront(); return this.status(); }
    fs.mkdirSync(account.profilePath, { recursive: true });
    const context = await chromium.launchPersistentContext(account.profilePath, {
      channel: 'chrome', headless: false, viewport: null, args: ['--start-maximized'], slowMo: 100,
      permissions: ['clipboard-read', 'clipboard-write']
    });
    this.active = { accountId: account.id, context };
    context.on('close', () => { if (this.active?.context === context) this.active = null; });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(PRODUCT_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    return this.status();
  }

  async page() {
    if (!this.active) throw new Error('请先打开抖店商品账号 Chrome');
    return this.active.context.pages().find((page) => page.url().includes('fxg.jinritemai.com'))
      || this.active.context.pages()[0]
      || this.active.context.newPage();
  }

  async detect(accountId) {
    if (!this.active || this.active.accountId !== accountId) throw new Error('请先打开抖店商品账号 Chrome');
    const page = await this.page();
    const body = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
    if (/扫码登录|登录抖店|手机号登录/.test(body) && !/商品管理|订单管理/.test(body)) {
      return { state: 'login-required', nickname: '', douyinId: '', message: '等待抖店账号登录' };
    }
    const nickname = (await page.locator('[class*="name"], [class*="nickname"]').allTextContents().catch(() => []))
      .map((value) => value.trim()).find((value) => value && value.length < 40) || '已登录抖店';
    return { state: 'logged-in', nickname, douyinId: nickname, message: '已识别抖店登录状态，请人工核对店铺' };
  }

  async searchCandidates(model) {
    const page = await this.page();
    return searchCandidatesOnPage(page, model);
  }

  async close() {
    if (!this.active) return this.status();
    const context = this.active.context;
    this.active = null;
    await context.close().catch(() => {});
    return this.status();
  }
}

module.exports = { DoudianBrowserManager, PRODUCT_LIST_URL, candidateFromRowText, numberFromText, searchCandidatesOnPage };
