const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { parseAccountText } = require('./account-detection');
const { normalizeTestPayload } = require('./test-publish');
const { RunReporter } = require('./run-reporter');
const { selectFileInOpenDialog } = require('./native-file-dialog');
const {
  classifyPublishSnapshot,
  PUBLISH_SUCCESS_PATTERN,
  PUBLISH_ERROR_PATTERN
} = require('./publish-result');
const { asChineseError } = require('./chinese-error');

const CREATOR_HOME = 'https://creator.douyin.com/creator-micro/home';
const CREATOR_UPLOAD = 'https://creator.douyin.com/creator-micro/content/upload';
const VIDEO_UPLOAD_PROGRESS_PATTERN = /视频上传中|正在上传|上传进度|上传[^\n]{0,12}\d+%|视频处理中|封面检测中|封面检测[^\n]{0,12}\d+%/;
const VIDEO_UPLOAD_ERROR_PATTERN = /上传失败|视频处理失败|网络异常|格式不支持|文件损坏|上传中断/;
const NICKNAME_SELECTORS = [
  '[class*="nickname"]',
  '[class*="user-name"]',
  '[class*="account-name"]',
  '[class*="userName"]'
];

class BrowserManager {
  constructor(reportsRoot, nativeDialogHelperPath) {
    this.active = null;
    this.reportsRoot = reportsRoot;
    this.nativeDialogHelperPath = nativeDialogHelperPath;
    this.cancelRequested = false;
  }

  beginAutomation() { this.cancelRequested = false; }
  requestCancel() { this.cancelRequested = true; }
  assertNotCancelled() {
    if (this.cancelRequested) {
      const error = new Error('用户已连续按住达到防误操时长，自动流程已停止，请人工接管并检查当前页面');
      error.code = 'USER_TAKEOVER';
      throw error;
    }
  }

  status() {
    return this.active
      ? { activeAccountId: this.active.accountId, open: true }
      : { activeAccountId: null, open: false };
  }

  async open(account) {
    if (this.active && this.active.accountId !== account.id) {
      throw new Error('另一个账号的浏览器仍在运行。请先关闭，再打开当前账号。');
    }
    if (this.active) {
      const page = await this.getPage();
      await page.bringToFront();
      return this.status();
    }

    fs.mkdirSync(account.profilePath, { recursive: true });
    const context = await chromium.launchPersistentContext(account.profilePath, {
      channel: 'chrome',
      headless: false,
      viewport: null,
      args: ['--start-maximized'],
      slowMo: 80
    });
    this.active = { accountId: account.id, context };
    context.on('close', () => {
      if (this.active?.context === context) this.active = null;
    });
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    await page.goto(CREATOR_HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.bringToFront();
    return this.status();
  }

  async detect(accountId) {
    if (!this.active || this.active.accountId !== accountId) {
      throw new Error('请先打开这个账号的 Chrome');
    }
    const page = await this.getPage();
    if (!page.url().startsWith('https://creator.douyin.com/')) {
      await page.goto(CREATOR_HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    }
    await page.waitForTimeout(1500);
    const bodyText = await page.locator('body').innerText({ timeout: 15_000 });
    const nicknameCandidates = [];
    for (const selector of NICKNAME_SELECTORS) {
      const values = await page.locator(selector).allTextContents().catch(() => []);
      nicknameCandidates.push(...values);
    }
    return parseAccountText(bodyText, nicknameCandidates);
  }

  async submitTestPublish(account, rawPayload) {
    this.assertNotCancelled();
    if (account.role !== 'test' || account.id !== 'test-account') {
      throw new Error('独立测试发布只允许使用测试小号，正式账号已锁定');
    }
    if (!this.active || this.active.accountId !== account.id) {
      throw new Error('请先打开测试小号的 Chrome');
    }
    if (account.lastDetected?.state !== 'logged-in' || !account.lastDetected?.douyinId) {
      throw new Error('开始前必须先在客户端成功检测测试小号');
    }

    const payload = normalizeTestPayload(rawPayload);
    const reporter = new RunReporter(this.reportsRoot, '测试小号-实际定时发布');
    let page;
    try {
      reporter.add('校验本地输入', '视频、封面、正文、Tag和定时时间通过校验');
      const liveAccount = account.lastDetected;
      reporter.add('使用已检测账号', `测试小号 ${liveAccount.douyinId}`);
      page = await this.publishPayload(payload, reporter);
      await page.bringToFront();
      const reportPath = await reporter.save('published', null, page);
      return { status: 'published', reportPath, liveAccount, scheduledAt: payload.scheduledAt };
    } catch (error) {
      const explained = asChineseError(error, '单条测试发布');
      reporter.add('流程中止', explained.message);
      const status = error.code === 'PUBLISH_OUTCOME_UNCERTAIN' ? 'uncertain' : 'failed';
      if (!page) page = await this.getPage().catch(() => undefined);
      const reportPath = await reporter.save(status, explained, page);
      const wrapped = new Error(`${explained.message}。流程已停止，错误报告：${reportPath}`);
      wrapped.cause = explained;
      throw wrapped;
    }
  }

  async submitPlannedBatch(account, plan) {
    this.assertNotCancelled();
    if (!this.active || this.active.accountId !== account.id) throw new Error('请先打开计划所使用账号的 Chrome');
    if (account.lastDetected?.state !== 'logged-in' || !account.lastDetected?.douyinId) {
      throw new Error('开始批量发布前必须先在客户端成功检测当前账号');
    }
    if (!plan || !Array.isArray(plan.items) || !plan.items.length) throw new Error('当前没有可执行的发布计划');
    const blocked = plan.items.filter((item) => !item.ready);
    if (blocked.length) throw new Error(`计划中有${blocked.length}条素材未就绪，请先处理红色问题项`);

    const reporter = new RunReporter(this.reportsRoot, `批量定时发布-${account.label}`);
    let page;
    try {
      reporter.add('批次开始', `账号：${account.lastDetected.douyinId}；日期：${plan.date}；共${plan.items.length}条`);
      for (let index = 0; index < plan.items.length; index += 1) {
        this.assertNotCancelled();
        const item = plan.items[index];
        reporter.add(`开始第${index + 1}条`, `${path.basename(item.videoPath)}；${item.category}；${item.model}；${item.scheduledLocal}`);
        const scheduledAt = new Date(item.scheduledLocal.replace(' ', 'T'));
        const payload = normalizeTestPayload({
          videoPath: item.videoPath,
          coverPath: item.coverPath,
          body: item.body,
          tags: item.tags,
          scheduledAt: scheduledAt.toISOString()
        });
        page = await this.publishPayload(payload, reporter, `第${index + 1}条`);
        reporter.add(`完成第${index + 1}条`, '平台已确认发布成功');
      }
      const reportPath = await reporter.save('published', null, page);
      return { status: 'published', count: plan.items.length, reportPath };
    } catch (error) {
      const explained = asChineseError(error, '批量发布');
      reporter.add('整批停止', `${explained.message}；后续视频未执行，只允许人工接管`);
      const status = error.code === 'PUBLISH_OUTCOME_UNCERTAIN' ? 'uncertain' : 'failed';
      if (!page) page = await this.getPage().catch(() => undefined);
      const reportPath = await reporter.save(status, explained, page);
      throw new Error(`${explained.message}。整批已停止，后续视频未执行。错误报告：${reportPath}`);
    }
  }

  async publishPayload(payload, reporter, prefix = '') {
    this.assertNotCancelled();
    const label = prefix ? `${prefix}：` : '';
    const page = await this.getPage();
    await page.goto(CREATOR_UPLOAD, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    this.assertNotCancelled();
    await page.waitForTimeout(1500);
    reporter.add(`${label}打开发布页面`, page.url());

    const videoInput = await this.findFileInput(page, 'video');
    await videoInput.setInputFiles(payload.videoPath);
    this.assertNotCancelled();
    reporter.add(`${label}选择视频`, payload.videoPath);

    const editor = await this.waitForDescriptionEditor(page);
    await this.fillDescription(page, editor, payload.body, payload.tags);
    reporter.add(`${label}填写正文和Tag`, `正文汉字数：${(payload.body.match(/[\u3400-\u9fff]/g) || []).length}，Tag数：${payload.tags.length}`);

    if (payload.coverPath) {
      this.assertNotCancelled();
      await this.fillCover(page, payload.coverPath);
      reporter.add(`${label}填写封面`, payload.coverPath);
    }

    await this.fillSchedule(page, payload.localDate, payload.localTime);
    this.assertNotCancelled();
    reporter.add(`${label}填写定时发布`, `${payload.localDate} ${payload.localTime}`);
    await this.waitForVideoUploadComplete(page, reporter, label);
    await this.assertScheduleValue(page, payload.localDate, payload.localTime);
    reporter.add(`${label}提交前时间复核`, `${payload.localDate} ${payload.localTime}`);

    const publishResult = await this.clickPublishAndWait(page, reporter);
    reporter.add(`${label}发布结果`, publishResult.detail);
    return page;
  }

  async waitForVideoUploadComplete(page, reporter, label = '') {
    const deadline = Date.now() + 10 * 60_000;
    let stableSince = 0;
    reporter.add(`${label}等待视频上传完成`, '检查发布页右上角、右下角状态和发布按钮');
    while (Date.now() < deadline) {
      this.assertNotCancelled();
      const errorMessage = await this.firstVisibleText(page, VIDEO_UPLOAD_ERROR_PATTERN);
      if (errorMessage) throw new Error(`视频上传或处理失败：${errorMessage}`);
      const progressMessage = await this.firstVisibleText(page, VIDEO_UPLOAD_PROGRESS_PATTERN);
      const publishButton = page.getByRole('button', { name: '发布', exact: true }).last();
      const buttonReady = await publishButton.isVisible().catch(() => false)
        && await publishButton.isEnabled().catch(() => false);
      if (!progressMessage && buttonReady) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 2000) {
          reporter.add(`${label}视频上传完成`, '连续2秒未发现上传或检测状态，发布按钮可用');
          return;
        }
      } else {
        stableSince = 0;
      }
      await page.waitForTimeout(500);
    }
    throw new Error('等待视频上传完成超过10分钟，未点击发布，请人工检查页面右上角和右下角状态');
  }

  async clickPublishAndWait(page, reporter) {
    this.assertNotCancelled();
    await this.assertNoBlockingModal(page, '点击发布前检测到未关闭的弹窗');
    const candidates = page.getByRole('button', { name: '发布', exact: true });
    let publishButton = null;
    for (let index = 0; index < await candidates.count(); index += 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        publishButton = candidate;
        break;
      }
    }
    if (!publishButton) throw new Error('没有找到底部可见的“发布”按钮');
    if (!await publishButton.isEnabled().catch(() => false)) throw new Error('“发布”按钮当前不可用，未执行点击');

    const initialUrl = page.url();
    await publishButton.click({ timeout: 5_000 });
    reporter.add('点击发布', '已点击一次；此后绝不自动重试');

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const successMessage = await this.firstVisibleText(page, PUBLISH_SUCCESS_PATTERN);
      const errorMessage = await this.firstVisibleText(page, PUBLISH_ERROR_PATTERN);
      const result = classifyPublishSnapshot({
        initialUrl,
        currentUrl: page.url(),
        successMessage,
        errorMessage
      });
      if (result.state === 'published') return result;
      if (result.state === 'failed') throw new Error(`平台返回发布失败：${result.detail}`);
      await page.waitForTimeout(500);
    }

    const uncertain = new Error('已经点击发布，但90秒内没有识别到明确成功或失败结果。禁止再次点击发布，请立即人工检查作品管理');
    uncertain.code = 'PUBLISH_OUTCOME_UNCERTAIN';
    throw uncertain;
  }

  async firstVisibleText(page, pattern) {
    const matches = page.getByText(pattern);
    for (let index = 0; index < await matches.count(); index += 1) {
      const item = matches.nth(index);
      if (await item.isVisible().catch(() => false)) {
        return String(await item.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      }
    }
    return '';
  }

  async findFileInput(page, kind) {
    const inputs = page.locator('input[type="file"]');
    await inputs.first().waitFor({ state: 'attached', timeout: 20_000 });
    const count = await inputs.count();
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      const accept = String(await input.getAttribute('accept') || '').toLowerCase();
      if (kind === 'video' && (accept.includes('video') || accept.includes('.mp4') || (!accept && count === 1))) return input;
      if (kind === 'image' && (accept.includes('image') || accept.includes('.jpg') || accept.includes('.png'))) return input;
    }
    throw new Error(kind === 'video' ? '没有找到视频上传控件' : '没有找到封面上传控件');
  }

  async waitForDescriptionEditor(page) {
    const selectors = [
      'textarea[placeholder*="作品描述"]',
      'textarea[placeholder*="描述"]',
      '[contenteditable="true"][data-placeholder*="描述"]',
      '[contenteditable="true"]'
    ];
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        const candidates = page.locator(selector);
        const count = await candidates.count();
        for (let index = 0; index < count; index += 1) {
          const candidate = candidates.nth(index);
          if (await candidate.isVisible().catch(() => false)) return candidate;
        }
      }
      const bodyText = await page.locator('body').innerText().catch(() => '');
      if (VIDEO_UPLOAD_ERROR_PATTERN.test(bodyText)) {
        throw new Error('视频上传页面报告失败，请查看页面提示');
      }
      await page.waitForTimeout(1000);
    }
    throw new Error('等待视频上传或作品描述输入框超时');
  }

  async fillDescription(page, editor, body, tags) {
    await editor.click();
    await editor.press('Control+A');
    await editor.press('Backspace');
    if (body) await editor.pressSequentially(body, { delay: 60 });
    for (const tag of tags) {
      if (body || tag !== tags[0]) await editor.press('Space');
      await editor.pressSequentially(`#${tag}`, { delay: 80 });
      await editor.press('Space');
      await page.waitForTimeout(250);
    }
  }

  async fillCover(page, coverPath) {
    const trigger = page.getByText(/选择封面|上传封面|更换封面/, { exact: false }).first();
    if (!await trigger.isVisible().catch(() => false)) {
      throw new Error('没有找到打开封面设置的按钮');
    }
    await trigger.click();

    const modal = page.locator(
      '[role="modal"]:visible, .semi-modal-wrap:visible, .dy-creator-content-modal-wrap:visible'
    ).filter({ hasText: '设置竖封面' }).first();
    await modal.waitFor({ state: 'visible', timeout: 15_000 });

    await this.uploadCoverVariant(page, modal, '设置竖封面', coverPath);
    const horizontalStep = modal.getByText('设置横封面', { exact: true }).last();
    if (!await horizontalStep.isVisible().catch(() => false)) {
      throw new Error('竖封面上传后没有找到“设置横封面”步骤');
    }
    await horizontalStep.click();
    await this.uploadCoverVariant(page, modal, '设置横封面', coverPath);

    const done = modal.getByRole('button', { name: '完成', exact: true }).last();
    await done.waitFor({ state: 'visible', timeout: 15_000 });
    const deadline = Date.now() + 20_000;
    while (!await done.isEnabled().catch(() => false)) {
      if (Date.now() >= deadline) throw new Error('竖版和横版封面已上传，但“完成”按钮仍不可用');
      await page.waitForTimeout(300);
    }
    await done.click();
    await modal.waitFor({ state: 'hidden', timeout: 15_000 });
    await this.assertNoBlockingModal(page, '封面设置完成后仍有弹窗未关闭');
  }

  async uploadCoverVariant(page, modal, tabName, coverPath) {
    const tab = modal.getByText(tabName, { exact: true }).first();
    if (await tab.isVisible().catch(() => false)) await tab.click();
    const uploadWidget = await this.waitForCoverUploadControl(page, modal, tabName);
    await page.bringToFront();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
    await cdp.detach();
    await uploadWidget.click({ force: true, noWaitAfter: true, timeout: 5_000 });
    await selectFileInOpenDialog(this.nativeDialogHelperPath, coverPath);
    await this.waitForCoverUploadResult(page, tabName);
  }

  async waitForCoverUploadControl(page, modal, tabName) {
    const deadline = Date.now() + 15_000;
    let lastObservation = '尚未完成首次检查';
    while (Date.now() < deadline) {
      const namedWidgets = modal.locator('.semi-upload, [class*="upload"], [class*="Upload"]')
        .filter({ hasText: '上传封面' });
      const namedWidgetCount = await namedWidgets.count();
      for (let index = 0; index < namedWidgetCount; index += 1) {
        const candidate = namedWidgets.nth(index);
        if (await candidate.isVisible().catch(() => false)) return candidate;
      }

      const uploadTexts = modal.getByText('上传封面', { exact: true });
      const uploadTextCount = await uploadTexts.count();
      for (let index = 0; index < uploadTextCount; index += 1) {
        const text = uploadTexts.nth(index);
        if (!await text.isVisible().catch(() => false)) continue;
        const clickableAncestor = text.locator(
          'xpath=ancestor-or-self::*[self::label or self::button or contains(@class,"upload") or contains(@class,"Upload")][1]'
        );
        if (await clickableAncestor.count()) {
          const candidate = clickableAncestor.first();
          if (await candidate.isVisible().catch(() => false)) return candidate;
        }
        return text;
      }

      const imageInputs = modal.locator('input[type="file"]');
      const imageInputCount = await imageInputs.count();
      for (let index = 0; index < imageInputCount; index += 1) {
        const input = imageInputs.nth(index);
        const accept = String(await input.getAttribute('accept').catch(() => '') || '').toLowerCase();
        if (!accept || !/(image|jpg|jpeg|png)/.test(accept)) continue;
        const parent = input.locator('xpath=..');
        if (await parent.isVisible().catch(() => false)) return parent;
      }

      lastObservation = `同名组件${namedWidgetCount}个、同名文字${uploadTextCount}个、文件输入框${imageInputCount}个`;
      await page.waitForTimeout(250);
    }
    const modalText = String(await modal.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(`${tabName}等待15秒后仍没有找到可用的“上传封面”组件。观察结果：${lastObservation}${modalText ? `；弹窗文字：${modalText}` : ''}`);
  }

  async waitForCoverUploadResult(page, tabName) {
    const errorPattern = /不支持的图片格式|图片格式不可用|图片格式不支持|封面上传失败|上传图片失败|请重新上传/;
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const errors = page.getByText(errorPattern);
      const count = await errors.count();
      for (let index = 0; index < count; index += 1) {
        const item = errors.nth(index);
        if (await item.isVisible().catch(() => false)) {
          const message = String(await item.innerText().catch(() => '图片格式不可用')).trim();
          throw new Error(`${tabName}上传被平台拒绝：${message}`);
        }
      }
      await page.waitForTimeout(200);
    }
  }

  async assertNoBlockingModal(page, message) {
    const blocking = page.locator(
      '[role="modal"]:visible, .semi-modal-wrap:visible, .dy-creator-content-modal-wrap:visible'
    );
    if (await blocking.count()) {
      const text = String(await blocking.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
      throw new Error(`${message}${text ? `：${text}` : ''}`);
    }
  }

  async fillSchedule(page, date, time) {
    await this.assertNoBlockingModal(page, '设置定时发布前检测到未关闭的弹窗');
    const scheduleLabel = page.locator('label').filter({ hasText: /^\s*定时发布\s*$/ }).first();
    if (!await scheduleLabel.isVisible().catch(() => false)) throw new Error('没有找到“定时发布”选项标签');
    await scheduleLabel.click({ timeout: 5_000 });
    const selectedDeadline = Date.now() + 5_000;
    while (String(await scheduleLabel.getAttribute('data-checked')) !== 'true') {
      const radio = scheduleLabel.locator('input[type="radio"]').first();
      if (await radio.count() && await radio.isChecked().catch(() => false)) break;
      if (Date.now() >= selectedDeadline) throw new Error('已经点击“定时发布”，但页面没有切换为选中状态');
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(300);

    const requested = `${date} ${time}`;
    const combinedInput = scheduleLabel.locator('xpath=following::input[1]');
    if (await combinedInput.isVisible().catch(() => false)) {
      try {
        await combinedInput.fill(requested);
      } catch {
        await combinedInput.click();
        await combinedInput.press('Control+A');
        await combinedInput.pressSequentially(requested, { delay: 40 });
      }
      await combinedInput.press('Enter').catch(() => {});
    } else {
      const dateInput = page.locator('input[placeholder*="日期"], input[placeholder*="年月日"]').first();
      const timeInput = page.locator('input[placeholder*="时间"], input[placeholder*="时分"]').first();
      if (!await dateInput.isVisible().catch(() => false) || !await timeInput.isVisible().catch(() => false)) {
        throw new Error('没有找到定时发布的日期或时间输入框');
      }
      await dateInput.fill(date);
      await timeInput.fill(time);
      await timeInput.press('Enter').catch(() => {});
    }
    await page.waitForTimeout(500);
    await this.assertScheduleValue(page, date, time);
  }

  async assertScheduleValue(page, date, time) {
    const requested = `${date} ${time}`;
    const visibleInputs = page.locator('input:visible');
    const values = [];
    for (let index = 0; index < await visibleInputs.count(); index += 1) {
      const value = await visibleInputs.nth(index).inputValue().catch(() => '');
      if (value) values.push(value.trim());
    }
    if (!values.some((value) => value.includes(date) && value.includes(time))) {
      const observed = values.filter((value) => /\d{4}-\d{2}-\d{2}/.test(value)).join('；') || '未读取到日期时间';
      throw new Error(`定时发布时间写入后回读不一致。期望：${requested}；页面：${observed}`);
    }
  }

  async getPage() {
    if (!this.active) throw new Error('Chrome 尚未打开');
    const pages = this.active.context.pages();
    return pages.find((page) => page.url().startsWith('https://creator.douyin.com/'))
      || pages[0]
      || this.active.context.newPage();
  }

  async close() {
    if (!this.active) return this.status();
    const current = this.active;
    this.active = null;
    await current.context.close().catch(() => {});
    return this.status();
  }
}

module.exports = {
  BrowserManager,
  CREATOR_HOME,
  CREATOR_UPLOAD,
  VIDEO_UPLOAD_PROGRESS_PATTERN,
  VIDEO_UPLOAD_ERROR_PATTERN
};
