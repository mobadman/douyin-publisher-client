const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const FEISHU_HOME = 'https://www.feishu.cn/';
const LOGIN_HOST_PATTERN = /accounts\.feishu\.cn|passport\.feishu\.cn/i;
const LOGIN_TEXT_PATTERN = /扫码登录|手机号登录|登录飞书|验证码登录|账号登录/;

function normalizeClipboardText(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function choosePreviewDownloadCandidate(containerBox, candidates) {
  return choosePreviewToolbarCandidate(containerBox, candidates, 1);
}

function choosePreviewCloseCandidate(containerBox, candidates) {
  return choosePreviewToolbarCandidate(containerBox, candidates, 0);
}

function choosePreviewToolbarCandidate(containerBox, candidates, indexFromRight) {
  if (!containerBox) return null;
  const rightEdge = containerBox.x + containerBox.width;
  const topEdge = containerBox.y;
  const filtered = candidates
    .filter((box) => box && box.width >= 10 && box.width <= 90 && box.height >= 10 && box.height <= 90)
    .filter((box) => box.x + box.width / 2 > containerBox.x + containerBox.width * 0.55)
    .filter((box) => box.y + box.height / 2 < topEdge + Math.min(110, containerBox.height * 0.25))
    .filter((box) => box.x >= containerBox.x && box.x + box.width <= rightEdge + 4)
    .sort((left, right) => (right.x + right.width / 2) - (left.x + left.width / 2));
  const distinct = [];
  for (const box of filtered) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    if (distinct.some((item) => Math.abs(item.centerX - centerX) < 8 && Math.abs(item.centerY - centerY) < 8)) continue;
    distinct.push({ box, centerX, centerY });
  }
  return distinct.length > indexFromRight ? distinct[indexFromRight].box : null;
}

class FeishuBrowserManager {
  constructor(profilePath) {
    this.profilePath = profilePath;
    this.context = null;
    this.lastDetection = null;
    this.sheetCursor = null;
    this.cancelRequested = false;
  }

  beginAutomation() { this.cancelRequested = false; }
  requestCancel() { this.cancelRequested = true; }
  assertNotCancelled() {
    if (this.cancelRequested) {
      const error = new Error('用户已连续按住达到防误操时长，素材拉取已停止，请人工接管并检查当前页面');
      error.code = 'USER_TAKEOVER';
      throw error;
    }
  }

  status() {
    return {
      open: Boolean(this.context),
      loggedIn: this.lastDetection?.state === 'logged-in',
      profilePath: this.profilePath,
      lastDetection: this.lastDetection
    };
  }

  async open(sheetUrl = FEISHU_HOME) {
    if (!this.context) {
      fs.mkdirSync(this.profilePath, { recursive: true });
      this.context = await chromium.launchPersistentContext(this.profilePath, {
        channel: 'chrome',
        headless: false,
        viewport: null,
        permissions: ['clipboard-read', 'clipboard-write'],
        args: ['--start-maximized'],
        slowMo: 80
      });
      const context = this.context;
      context.on('close', () => {
        if (this.context === context) {
          this.context = null;
          this.lastDetection = null;
          this.sheetCursor = null;
        }
      });
    }
    const page = await this.getPage();
    const target = /^https:\/\//i.test(String(sheetUrl || '')) ? sheetUrl : FEISHU_HOME;
    if (!page.url().startsWith(target)) {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    await page.bringToFront();
    return this.status();
  }

  async detect(sheetUrl) {
    if (!this.context) throw new Error('请先打开飞书 Chrome 并完成登录');
    const page = await this.getPage();
    if (sheetUrl && !page.url().includes('/sheets/')) {
      await page.goto(sheetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    await page.waitForTimeout(1500);
    const bodyText = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
    const loginPage = LOGIN_HOST_PATTERN.test(page.url()) || LOGIN_TEXT_PATTERN.test(bodyText.slice(0, 3000));
    this.lastDetection = loginPage
      ? { state: 'login-required', message: '尚未登录飞书，请在打开的 Chrome 中完成登录', checkedAt: new Date().toISOString() }
      : { state: 'logged-in', message: '飞书已登录，可以只读获取表格', checkedAt: new Date().toISOString(), url: page.url() };
    return this.lastDetection;
  }

  assertReady() {
    if (!this.context) throw new Error('飞书 Chrome 未打开，请先点击“打开飞书登录”');
    if (this.lastDetection?.state !== 'logged-in') throw new Error('尚未确认飞书登录状态，请先点击“检测飞书登录”');
  }

  async copySheet(sheetUrl, requiredHeaders) {
    this.assertNotCancelled();
    this.assertReady();
    const page = await this.getPage();
    await page.goto(sheetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    this.assertNotCancelled();
    await page.waitForTimeout(3500);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (LOGIN_HOST_PATTERN.test(page.url()) || LOGIN_TEXT_PATTERN.test(bodyText.slice(0, 3000))) {
      this.lastDetection = { state: 'login-required', message: '飞书登录已经失效，请重新登录', checkedAt: new Date().toISOString() };
      throw new Error('飞书登录已经失效，请重新登录并再次检测');
    }

    const copied = await this.copyFromGrid(page, requiredHeaders);
    this.sheetCursor = null;
    if (!copied) {
      throw new Error('没有从飞书表格复制到数据。请确认工作表已加载、当前账号有查看权限，并且页面没有弹窗遮挡');
    }
    const missingHeaders = requiredHeaders.filter((header) => header && !copied.includes(header));
    if (missingHeaders.length) {
      throw new Error(`复制到的表格数据缺少表头【${missingHeaders.join('】【')}】。请确认链接中的 sheet 参数指向“主页视频审核表”`);
    }
    return copied;
  }

  async copyFromGrid(page, requiredHeaders) {
    await page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
    const target = await this.findGridTarget(page);
    if (!target) throw new Error('没有识别到飞书电子表格的数据网格，可能是页面尚未加载完成或飞书页面结构已经变化');

    const clickX = Math.min(target.box.width - 20, Math.max(120, target.box.width * 0.35));
    const clickY = Math.min(target.box.height - 20, Math.max(100, target.box.height * 0.35));
    await target.candidate.click({ position: { x: clickX, y: clickY }, timeout: 10_000 });
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('Control+Home');
    await page.waitForTimeout(300);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.keyboard.press('Control+A');
      await page.waitForTimeout(250);
      await page.keyboard.press('Control+C');
      await page.waitForTimeout(700);
      const text = normalizeClipboardText(await this.readClipboard(page));
      if (text && requiredHeaders.every((header) => !header || text.includes(header))) return text;
    }
    return normalizeClipboardText(await this.readClipboard(page));
  }

  async findGridTarget(page) {
    const candidates = page.locator('canvas:visible, [class*="sheet-grid"]:visible, [class*="spreadsheet"]:visible, [role="grid"]:visible');
    let target = null;
    let largestArea = 0;
    for (let index = 0; index < await candidates.count(); index += 1) {
      const candidate = candidates.nth(index);
      const box = await candidate.boundingBox().catch(() => null);
      if (!box || box.width < 300 || box.height < 150) continue;
      const area = box.width * box.height;
      if (area > largestArea) {
        largestArea = area;
        target = { candidate, box };
      }
    }
    return target;
  }

  async readClipboard(page) {
    return page.evaluate(async () => {
      const plain = await navigator.clipboard.readText().catch(() => '');
      const items = await navigator.clipboard.read().catch(() => []);
      for (const item of items) {
        if (!item.types.includes('text/html')) continue;
        const html = await (await item.getType('text/html')).text();
        const documentCopy = new DOMParser().parseFromString(html, 'text/html');
        const rows = Array.from(documentCopy.querySelectorAll('tr')).map((row) => (
          Array.from(row.querySelectorAll('th,td')).map((cell) => {
            const link = Array.from(cell.querySelectorAll('a[href]'))
              .map((anchor) => anchor.href)
              .find((href) => /^https:\/\//i.test(href));
            const value = link || cell.innerText || cell.textContent || '';
            const clean = value.replace(/\r?\n/g, ' ').trim();
            return /[\t"\n]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
          }).join('\t')
        )).filter((row) => row.trim());
        if (rows.length) return rows.join('\n');
      }
      return plain;
    }).catch(() => '');
  }

  async download(url, outputPath) {
    this.assertNotCancelled();
    this.assertReady();
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('素材链接不是有效网址'); }
    if (parsed.protocol !== 'https:') throw new Error('素材链接必须是 HTTPS 地址');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const response = await this.context.request.get(url, { timeout: 60_000, failOnStatusCode: false }).catch(() => null);
    if (response?.ok()) {
      const contentType = String(response.headers()['content-type'] || '').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('application/json')) {
        fs.writeFileSync(outputPath, await response.body());
        return outputPath;
      }
    }

    const page = await this.context.newPage();
    try {
      let download = null;
      const directDownload = page.waitForEvent('download', { timeout: 12_000 }).catch(() => null);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((error) => {
        if (!/download|aborted/i.test(error.message)) throw error;
      });
      download = await directDownload;
      if (!download) {
        const controls = page.getByText(/下载|保存到本地/, { exact: false });
        for (let index = 0; index < await controls.count(); index += 1) {
          const control = controls.nth(index);
          if (!await control.isVisible().catch(() => false)) continue;
          const pending = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
          await control.click({ timeout: 10_000 });
          download = await pending;
          if (download) break;
        }
      }
      if (!download) throw new Error('素材页面已经打开，但没有触发下载。请确认当前飞书账号拥有下载权限');
      await download.saveAs(outputPath);
      return outputPath;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async downloadAttachment(sheetUrl, cellReference, outputPath, attachmentName) {
    this.assertNotCancelled();
    this.assertReady();
    if (!/^[A-Z]+\d+$/.test(String(cellReference || ''))) throw new Error('飞书附件单元格位置无效');
    const page = await this.getPage();
    if (!page.url().includes('/sheets/') || !page.url().includes(new URL(sheetUrl).searchParams.get('sheet'))) {
      await page.goto(sheetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(3000);
      this.sheetCursor = null;
    }
    await page.bringToFront();
    await this.goToCell(page, cellReference, attachmentName);
    this.assertNotCancelled();

    const container = await this.openAttachmentPreview(page, attachmentName);
    if (!container) {
      throw new Error(`已定位飞书单元格 ${cellReference}，但点击蓝色附件名称后没有打开预览窗`);
    }
    const download = await this.triggerAttachmentDownload(page, container);
    this.assertNotCancelled();
    if (!download) {
      throw new Error(`已打开飞书第${cellReference.replace(/^[A-Z]+/, '')}行附件，但没有识别到“下载”按钮`);
    }
    await download.saveAs(outputPath);
    await this.closeAttachmentPreview(page, container);
    // 飞书关闭附件预览后，焦点通常停留在关闭按钮或已经移除的预览层，
    // 不能继续假设方向键仍由表格接收。下一条必须重新聚焦网格并从 A1 定位。
    this.sheetCursor = null;
    return outputPath;
  }

  async goToCell(page, cellReference, attachmentName) {
    const target = await this.findGridTarget(page);
    if (!target) throw new Error('定位附件时没有识别到飞书表格网格');
    const match = cellReference.match(/^([A-Z]+)(\d+)$/);
    const column = match[1].split('').reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
    const row = Number(match[2]);
    const sheetKey = `${new URL(page.url()).pathname}?sheet=${new URL(page.url()).searchParams.get('sheet') || ''}`;
    if (!this.sheetCursor || this.sheetCursor.sheetKey !== sheetKey) {
      await target.candidate.click({
        position: {
          x: Math.min(target.box.width - 80, Math.max(220, target.box.width * 0.35)),
          y: Math.min(target.box.height - 100, Math.max(220, target.box.height * 0.5))
        }
      });
      await page.keyboard.press('Escape').catch(() => {});
      await page.keyboard.press('Control+Home');
      this.sheetCursor = { sheetKey, column: 1, row: 1 };
    }

    const columnDelta = column - this.sheetCursor.column;
    const rowDelta = row - this.sheetCursor.row;
    await this.pressMany(page, columnDelta >= 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(columnDelta));
    await this.pressMany(page, rowDelta >= 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(rowDelta));
    await page.waitForTimeout(500);
    const selectedText = await this.copySelectedCell(page);
    if (!selectedText || !selectedText.includes(attachmentName)) {
      this.sheetCursor = null;
      throw new Error(
        `附件定位校验失败：期望单元格 ${cellReference} 为“${attachmentName}”，实际复制到“${selectedText || '空'}”。为避免误点筛选，流程已停止`
      );
    }
    this.sheetCursor = { sheetKey, column, row };
  }

  async copySelectedCell(page) {
    await page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(500);
    return normalizeClipboardText(await page.evaluate(() => navigator.clipboard.readText()).catch(() => ''));
  }

  async pressMany(page, key, count) {
    if (!count) return;
    const codes = {
      ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
      ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
      ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
      ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 }
    };
    const definition = codes[key];
    const session = await page.context().newCDPSession(page);
    try {
      for (let index = 0; index < count; index += 1) {
        if (index % 50 === 0) this.assertNotCancelled();
        await session.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key,
          code: definition.code,
          windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
          nativeVirtualKeyCode: definition.windowsVirtualKeyCode,
          autoRepeat: false
        });
        await session.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key,
          code: definition.code,
          windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
          nativeVirtualKeyCode: definition.windowsVirtualKeyCode
        });
      }
    } finally {
      await session.detach().catch(() => {});
    }
  }

  async openAttachmentPreview(page, attachmentName) {
    this.assertNotCancelled();
    const overlaySelector = [
      '[role="dialog"]:visible',
      '.semi-portal:visible',
      '[class*="attachment"]:visible',
      '[class*="popover"]:visible',
      '[class*="preview"]:visible'
    ].join(', ');

    const grid = await this.findGridTarget(page);
    const attachmentTexts = page.getByText(attachmentName, { exact: true });
    for (let index = 0; index < await attachmentTexts.count(); index += 1) {
      const attachment = attachmentTexts.nth(index);
      if (!await attachment.isVisible().catch(() => false)) continue;
      const box = await attachment.boundingBox().catch(() => null);
      if (!box || !grid || box.x < grid.box.x || box.y < grid.box.y
        || box.x + box.width > grid.box.x + grid.box.width
        || box.y + box.height > grid.box.y + grid.box.height) continue;
      await attachment.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const preview = await this.findAttachmentPreview(page, overlaySelector, attachmentName);
      if (preview) return preview;
    }

    const selections = page.locator(
      '[class*="active-cell"]:visible, [class*="selected-cell"]:visible, [class*="cell-cursor"]:visible, [class*="selection"]:visible'
    );
    let selected = null;
    let smallestArea = Number.POSITIVE_INFINITY;
    for (let index = 0; index < await selections.count(); index += 1) {
      const candidate = selections.nth(index);
      const box = await candidate.boundingBox().catch(() => null);
      if (!box || box.width < 60 || box.height < 16 || box.height > 200) continue;
      if (grid && (box.x < grid.box.x || box.y < grid.box.y
        || box.x + box.width > grid.box.x + grid.box.width
        || box.y + box.height > grid.box.y + grid.box.height)) continue;
      if (grid && box.y < grid.box.y + 100) continue;
      const area = box.width * box.height;
      if (area < smallestArea) {
        smallestArea = area;
        selected = candidate;
      }
    }
    if (selected) {
      const box = await selected.boundingBox();
      if (!box) return null;
      await selected.click({
        force: true,
        position: { x: Math.min(box.width - 8, 32), y: box.height / 2 }
      }).catch(() => {});
      await page.waitForTimeout(1200);
      return this.findAttachmentPreview(page, overlaySelector, attachmentName);
    }
    const styledBox = grid ? await page.evaluate((gridBox) => {
      const looksBlue = (value) => Array.from(String(value || '').matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g))
        .some((match) => Number(match[3]) > 150 && Number(match[3]) > Number(match[1]) + 35);
      let best = null;
      for (const element of document.querySelectorAll('div,span')) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 60 || rect.height < 16 || rect.height > 200) continue;
        if (rect.left < gridBox.x || rect.top < gridBox.y
          || rect.right > gridBox.x + gridBox.width || rect.bottom > gridBox.y + gridBox.height) continue;
        if (rect.top < gridBox.y + 100) continue;
        const style = getComputedStyle(element);
        const colors = `${style.borderTopColor} ${style.borderRightColor} ${style.borderBottomColor} ${style.borderLeftColor} ${style.outlineColor} ${style.boxShadow}`;
        if (!looksBlue(colors)) continue;
        const borderWeight = parseFloat(style.borderTopWidth) + parseFloat(style.borderRightWidth)
          + parseFloat(style.borderBottomWidth) + parseFloat(style.borderLeftWidth) + parseFloat(style.outlineWidth || '0');
        if (borderWeight < 2 && style.boxShadow === 'none') continue;
        const area = rect.width * rect.height;
        if (!best || area < best.area) best = { x: rect.left, y: rect.top, width: rect.width, height: rect.height, area };
      }
      return best;
    }, grid.box).catch(() => null) : null;
    if (styledBox) {
      await page.mouse.click(styledBox.x + Math.min(32, styledBox.width - 8), styledBox.y + styledBox.height / 2);
      await page.waitForTimeout(1200);
      return this.findAttachmentPreview(page, overlaySelector, attachmentName);
    }
    return null;
  }

  async findAttachmentPreview(page, selector, attachmentName) {
    const overlays = page.locator(selector);
    let fallback = null;
    let fallbackArea = Number.POSITIVE_INFINITY;
    for (let index = 0; index < await overlays.count(); index += 1) {
      const overlay = overlays.nth(index);
      if (!await overlay.isVisible().catch(() => false)) continue;
      const box = await overlay.boundingBox().catch(() => null);
      if (!box || box.width < 320 || box.height < 240) continue;
      const text = String(await overlay.innerText().catch(() => ''));
      const hasControls = await overlay.locator('button, [role="button"], [aria-label], [title]').count() > 0;
      const hasVideo = await overlay.locator('video').count() > 0;
      if (!hasControls && !hasVideo) continue;
      if (attachmentName && text.includes(attachmentName)) return overlay;
      const area = box.width * box.height;
      if ((hasVideo || /下载|预览/.test(text)) && area < fallbackArea) {
        fallback = overlay;
        fallbackArea = area;
      }
    }
    return fallback;
  }

  async triggerAttachmentDownload(page, container) {
    this.assertNotCancelled();
    const direct = container.locator(
      'button[aria-label*="下载"], [role="button"][aria-label*="下载"], [title*="下载"], [data-tooltip*="下载"]'
    );
    for (let index = 0; index < await direct.count(); index += 1) {
      const control = direct.nth(index);
      if (!await control.isVisible().catch(() => false)) continue;
      const pending = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
      await control.click({ timeout: 10_000 });
      const download = await pending;
      if (download) return download;
    }

    const controls = container.locator('button:visible, [role="button"]:visible, [class*="icon"]:visible, svg:visible');
    const containerBox = await container.boundingBox().catch(() => null);
    const limit = Math.min(await controls.count(), 60);
    const candidates = [];
    for (let index = 0; index < limit; index += 1) {
      const control = controls.nth(index);
      const box = await control.boundingBox().catch(() => null);
      if (box) candidates.push({ control, box });
    }
    const chosenBox = choosePreviewDownloadCandidate(containerBox, candidates.map((item) => item.box));
    if (!chosenBox) return null;
    const chosen = candidates.find((item) => item.box === chosenBox);
    if (!chosen) return null;
    const pending = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
    await chosen.control.click({ timeout: 10_000 });
    const download = await pending;
    if (download) return download;
    return null;
  }

  async closeAttachmentPreview(page, container) {
    this.assertNotCancelled();
    const direct = container.locator(
      'button[aria-label*="关闭"], [role="button"][aria-label*="关闭"], [title*="关闭"], [data-tooltip*="关闭"]'
    );
    for (let index = 0; index < await direct.count(); index += 1) {
      const control = direct.nth(index);
      if (!await control.isVisible().catch(() => false)) continue;
      await control.click({ timeout: 10_000 });
      if (await this.waitForPreviewClosed(page, container)) return;
    }

    const controls = container.locator('button:visible, [role="button"]:visible, [class*="icon"]:visible, svg:visible');
    const containerBox = await container.boundingBox().catch(() => null);
    const candidates = [];
    const limit = Math.min(await controls.count(), 60);
    for (let index = 0; index < limit; index += 1) {
      const control = controls.nth(index);
      const box = await control.boundingBox().catch(() => null);
      if (box) candidates.push({ control, box });
    }
    const chosenBox = choosePreviewCloseCandidate(containerBox, candidates.map((item) => item.box));
    const chosen = candidates.find((item) => item.box === chosenBox);
    if (chosen) {
      await chosen.control.click({ timeout: 10_000 });
      if (await this.waitForPreviewClosed(page, container)) return;
    }

    await page.keyboard.press('Escape').catch(() => {});
    if (await this.waitForPreviewClosed(page, container)) return;
    throw new Error('素材已经下载，但飞书附件预览窗未能关闭。为避免遮挡后续操作，流程已停止');
  }

  async waitForPreviewClosed(page, container) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      this.assertNotCancelled();
      if (!await container.isVisible().catch(() => false)) return true;
      await page.waitForTimeout(200);
    }
    return false;
  }

  async getPage() {
    if (!this.context) throw new Error('飞书 Chrome 尚未打开');
    const pages = this.context.pages();
    return pages.find((page) => /feishu\.cn/i.test(page.url())) || pages[0] || this.context.newPage();
  }

  async close() {
    if (!this.context) return this.status();
    const context = this.context;
    this.context = null;
    this.lastDetection = null;
    this.sheetCursor = null;
    await context.close().catch(() => {});
    return this.status();
  }
}

module.exports = {
  FeishuBrowserManager,
  FEISHU_HOME,
  normalizeClipboardText,
  choosePreviewDownloadCandidate,
  choosePreviewCloseCandidate
};
