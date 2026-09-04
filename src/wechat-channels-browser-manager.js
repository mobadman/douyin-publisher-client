const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { RunReporter } = require('./run-reporter');
const { normalizeTestPayload } = require('./test-publish');

const CHANNELS_HOME = 'https://channels.weixin.qq.com/platform';
const CHANNELS_CREATE = 'https://channels.weixin.qq.com/platform/post/create';

class WechatChannelsBrowserManager {
  constructor(reportsRoot, nativeDialogHelperPath, options = {}) {
    this.reportsRoot = reportsRoot;
    this.nativeDialogHelperPath = nativeDialogHelperPath;
    this.verificationTimeoutMs = options.verificationTimeoutMs || 180_000;
    this.active = null;
    this.cancelRequested = false;
  }

  beginAutomation() { this.cancelRequested = false; }
  requestCancel() { this.cancelRequested = true; }
  assertNotCancelled() {
    if (this.cancelRequested) throw new Error('用户已请求人工接管，视频号流程已停止并保留当前批次进度');
  }
  status() { return this.active ? { activeAccountId: this.active.accountId, open: true } : { activeAccountId: null, open: false }; }

  async open(account) {
    if (this.active && this.active.accountId !== account.id) throw new Error('另一个视频号账号浏览器仍在运行，请先关闭');
    if (this.active) { const page = await this.page(); await page.bringToFront(); return this.status(); }
    fs.mkdirSync(account.profilePath, { recursive: true });
    const context = await chromium.launchPersistentContext(account.profilePath, {
      channel: 'chrome', headless: false, viewport: null, args: ['--start-maximized'], slowMo: 100
    });
    this.active = { accountId: account.id, context };
    context.on('close', () => { if (this.active?.context === context) this.active = null; });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(CHANNELS_HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    return this.status();
  }

  async page() {
    if (!this.active) throw new Error('请先打开视频号助手 Chrome');
    return this.active.context.pages().find((page) => page.url().includes('channels.weixin.qq.com'))
      || this.active.context.pages()[0]
      || this.active.context.newPage();
  }

  async detect(accountId) {
    if (!this.active || this.active.accountId !== accountId) throw new Error('请先打开这个视频号账号的 Chrome');
    const page = await this.page();
    const body = await page.locator('body').innerText({ timeout: 15_000 }).catch(() => '');
    if (/扫码登录|请使用微信扫码|二维码/.test(body) && !/发表视频|内容管理|动态管理/.test(body)) {
      return { state: 'login-required', nickname: '', douyinId: '', message: '等待管理员微信扫码登录' };
    }
    const nickname = (await page.locator('[class*="nickname"], [class*="name"]').allTextContents().catch(() => []))
      .map((value) => value.trim()).find(Boolean) || '已登录视频号';
    return { state: 'logged-in', nickname, douyinId: nickname, message: '已识别视频号登录状态，请人工核对账号' };
  }

  async waitForHumanVerification(page) {
    const deadline = Date.now() + this.verificationTimeoutMs;
    let announced = false;
    while (Date.now() < deadline) {
      this.assertNotCancelled();
      let waiting = false;
      for (const frame of page.frames()) {
        const text = await frame.locator('body').innerText().catch(() => '');
        if (/实名验证|管理员扫码|扫码验证|安全验证/.test(text)) { waiting = true; break; }
      }
      if (!waiting) {
        if (announced) await this.onVerificationState?.('running', '管理员扫码验证已完成，继续当前视频');
        return;
      }
      if (!announced) {
        announced = true;
        await this.onVerificationState?.('waiting-human', '等待管理员微信扫码验证');
      }
      await page.waitForTimeout(1500);
    }
    const error = new Error('等待管理员扫码验证超时；当前批次进度已保留，完成扫码后可继续未完成视频');
    error.code = 'HUMAN_VERIFICATION_TIMEOUT';
    throw error;
  }

  async submitPlannedBatch(account, plan, hooks = {}) {
    if (!this.active || this.active.accountId !== account.id) throw new Error('请先打开并检测视频号发布账号');
    const candidates = plan.items.filter((item) => item.selected && item.ready && ['pending', 'failed', 'skipped'].includes(item.execution?.state || 'pending'));
    if (!candidates.length) throw new Error('当前没有可执行的视频号计划项');
    const reporter = new RunReporter(this.reportsRoot, `视频号批量定时发布-${account.label}`);
    let page = await this.page();
    let activeItem = null;
    try {
      for (const item of candidates) {
        this.assertNotCancelled();
        activeItem = item;
        this.onVerificationState = (state, detail) => hooks.onItemState?.(item, state, detail);
        await hooks.onItemState?.(item, 'running', '正在填写视频号发布页面');
        await page.goto(CHANNELS_HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        const publishEntry = page.locator('button.weui-desktop-btn').filter({ hasText: '发表视频' }).first();
        if (await publishEntry.isVisible({ timeout: 10_000 }).catch(() => false)) await publishEntry.click();
        await page.waitForURL((url) => url.href.includes('/platform/post/create'), { timeout: 30_000 }).catch(() => {});
        if (!page.url().includes('/platform/post/create')) await page.goto(CHANNELS_CREATE, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await this.waitForHumanVerification(page);
        await this.fillPublishPage(page, item);
        await this.waitForHumanVerification(page);
        await hooks.onItemState?.(item, 'verified', '视频号页面已提交发布');
        reporter.add(`完成计划第${item.sequence}条`, `${path.basename(item.videoPath)}；${item.scheduledLocal}`);
        activeItem = null;
      }
      const reportPath = await reporter.save('published', null, page);
      return { status: 'published', count: candidates.length, reportPath };
    } catch (error) {
      if (activeItem) await hooks.onItemState?.(activeItem, 'failed', error.message);
      const reportPath = await reporter.save('failed', error, page);
      const wrapped = new Error(`${error.message}。后续未完成视频可继续执行。错误报告：${reportPath}`);
      wrapped.code = error.code;
      throw wrapped;
    } finally {
      this.onVerificationState = null;
    }
  }

  async submitTestPublish(account, rawPayload) {
    if (account.id !== 'wechat-test' || account.role !== 'test') throw new Error('视频号测试发布只允许使用视频号测试账号');
    if (!this.active || this.active.accountId !== account.id) throw new Error('请先打开并检测视频号测试账号');
    if (account.lastDetected?.state !== 'logged-in') throw new Error('开始前必须先成功检测视频号测试账号');
    const payload = normalizeTestPayload(rawPayload);
    const item = {
      itemId: `wechat-test-${Date.now()}`, sequence: 1, selected: true, ready: true,
      execution: { state: 'pending' }, videoPath: payload.videoPath, coverPath: payload.coverPath,
      body: payload.body, tags: payload.tags, model: '视频号测试', category: '测试',
      scheduledLocal: `${payload.localDate} ${payload.localTime}`
    };
    return this.submitPlannedBatch(account, { date: payload.localDate, items: [item] });
  }

  async fillPublishPage(page, item) {
    let editorFrame = null;
    let fileInput = null;
    for (let attempt = 0; attempt < 60 && !fileInput; attempt += 1) {
      for (const frame of page.frames()) {
        const candidate = frame.locator('input[type="file"]').first();
        if (await candidate.count().catch(() => 0)) { editorFrame = frame; fileInput = candidate; break; }
      }
      if (!fileInput) await page.waitForTimeout(1000);
    }
    if (!fileInput || !editorFrame) throw new Error('60秒内没有找到视频号文件上传框；可能未从首页“发表视频”进入，或发布表单 iframe 未加载');
    await fileInput.setInputFiles(item.videoPath);

    const editor = editorFrame.locator('div.input-editor, [contenteditable="true"], textarea').first();
    await editor.waitFor({ state: 'visible', timeout: 60_000 });
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(item.body || item.model || path.basename(item.videoPath, path.extname(item.videoPath)));
    await page.keyboard.press('Enter');
    for (const tag of item.tags || []) {
      await page.keyboard.type(`#${tag}`);
      await page.keyboard.press('Space');
    }
    await this.waitForUploadComplete(page, editorFrame);
    // 合集、视频标注、原创声明保持平台默认值，不进行任何操作。
    await this.setShortTitle(editorFrame, item.body || item.model || '精彩视频内容分享');
    await this.setSchedule(editorFrame, item.scheduledLocal);
    await this.setPortraitCover(editorFrame, item.coverPath);
    const submit = editorFrame.locator('div.form-btns button').filter({ hasText: /^\s*发表\s*$/ }).first();
    if (!await submit.isVisible({ timeout: 20_000 }).catch(() => false)) throw new Error('没有找到视频号“发表”按钮');
    if (!await submit.isEnabled().catch(() => false)) throw new Error('视频号“发表”按钮不可用，未点击发布');
    const initialUrl = page.url();
    await submit.click({ timeout: 30_000 });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await this.waitForHumanVerification(page);
      if (page.url() !== initialUrl && !page.url().includes('/post/create')) return;
      if (!await submit.count().catch(() => 0)) return;
      const body = await editorFrame.locator('body').innerText().catch(() => '');
      if (/发表成功|发布成功/.test(body)) return;
      if (/发表失败|发布失败|上传失败/.test(body)) throw new Error('视频号返回发布失败，请检查页面提示');
      await page.waitForTimeout(1000);
    }
    const error = new Error('已点击一次“发表”，但60秒内没有确认成功或失败；禁止自动重试，请人工核对');
    error.code = 'PUBLISH_OUTCOME_UNCERTAIN';
    throw error;
  }

  async waitForUploadComplete(page, frame) {
    const deadline = Date.now() + 60 * 60_000;
    while (Date.now() < deadline) {
      this.assertNotCancelled();
      await this.waitForHumanVerification(page);
      const failure = frame.locator('div.status-msg.error').first();
      if (await failure.isVisible().catch(() => false)) throw new Error(`视频号视频上传失败：${await failure.innerText().catch(() => '页面提示上传错误')}`);
      const publish = frame.locator('div.form-btns button').filter({ hasText: /^\s*发表\s*$/ }).first();
      const className = String(await publish.getAttribute('class').catch(() => ''));
      if (await publish.isVisible().catch(() => false) && await publish.isEnabled().catch(() => false) && !className.includes('disabled')) return;
      await page.waitForTimeout(2000);
    }
    throw new Error('视频号视频上传超过60分钟仍未完成');
  }

  async setSchedule(frame, scheduledLocal) {
    const labels = frame.locator('label').filter({ hasText: '定时' });
    if (!await labels.count()) throw new Error('视频号发布页没有找到定时发表选项');
    await labels.last().click();
    const [date, time] = String(scheduledLocal).split(' ');
    const dateInput = frame.locator('input[placeholder="请选择发表时间"]').first();
    if (!await dateInput.count()) throw new Error('视频号发布页没有找到定时日期输入框');
    await dateInput.click();
    const day = String(Number(date.slice(8, 10)));
    const dayOptions = frame.locator('table.weui-desktop-picker__table a').filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) });
    let selected = false;
    for (let index = 0; index < await dayOptions.count(); index += 1) {
      const option = dayOptions.nth(index);
      const className = String(await option.getAttribute('class') || '');
      if (!className.includes('disabled') && await option.isVisible().catch(() => false)) { await option.click(); selected = true; break; }
    }
    if (!selected) throw new Error(`视频号日期选择器中无法选择${date}`);
    const timeInput = frame.locator('input[placeholder="请选择时间"]').first();
    await timeInput.click();
    await timeInput.press('Control+A');
    await timeInput.fill(time);
    await timeInput.press('Enter');
    const observed = `${await dateInput.inputValue().catch(() => '')} ${await timeInput.inputValue().catch(() => '')}`;
    if (!observed.includes(time)) throw new Error(`视频号定时时间写入后回读不一致：期望${scheduledLocal}，页面${observed}`);
  }

  async setShortTitle(frame, source) {
    const input = frame.locator('input[placeholder="填写短标题有机会获得更多流量"]').first();
    if (!await input.count()) return;
    let value = String(source || '').replace(/[^\p{L}\p{N}《》“”:+?%°]/gu, '').slice(0, 15);
    if (value.length < 7) value = `${value}精彩内容分享`.slice(0, 7);
    await input.fill(value);
  }

  async setPortraitCover(frame, coverPath) {
    if (!coverPath) return;
    const entry = frame.locator('div.vertical-cover-wrap').filter({ hasText: /3:4|个人主页卡片/ }).first();
    if (!await entry.isVisible().catch(() => false)) return;
    await entry.click();
    const dialog = frame.locator('div.weui-desktop-dialog').filter({ hasText: /编辑个人主页卡片|编辑封面/ }).first();
    if (!await dialog.isVisible({ timeout: 10_000 }).catch(() => false)) throw new Error('已点击视频号竖版封面，但没有出现封面编辑窗口');
    const input = dialog.locator('.single-cover-uploader-wrap input[type="file"], input[type="file"]').first();
    await input.setInputFiles(coverPath);
    const crop = frame.locator('div.weui-desktop-dialog').filter({ hasText: '裁剪封面图' }).first();
    if (await crop.isVisible({ timeout: 5000 }).catch(() => false)) {
      const cropConfirm = crop.locator('button').filter({ hasText: '确定' }).last();
      if (await cropConfirm.isVisible().catch(() => false)) await cropConfirm.click();
    }
    const confirm = dialog.locator('button').filter({ hasText: /确认/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
  }

  async close() {
    if (!this.active) return this.status();
    const context = this.active.context;
    this.active = null;
    await context.close().catch(() => {});
    return this.status();
  }
}

module.exports = { WechatChannelsBrowserManager, CHANNELS_HOME, CHANNELS_CREATE };
