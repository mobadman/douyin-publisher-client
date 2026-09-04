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
const {
  formatLocalMinute,
  extractProfileApiRecords,
  mergeProfileRecords,
  selectProfileRecord
} = require('./douyin-profile-id');

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

  contextFor(accountId) {
    if (!this.active || this.active.accountId !== String(accountId)) throw new Error('请先打开并检测抖音发布账号');
    return this.active.context;
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
      const outcome = await this.publishPayload(payload, reporter);
      page = outcome.page;
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

  async submitPlannedBatch(account, plan, hooks = {}) {
    this.assertNotCancelled();
    if (!this.active || this.active.accountId !== account.id) throw new Error('请先打开计划所使用账号的 Chrome');
    if (account.lastDetected?.state !== 'logged-in' || !account.lastDetected?.douyinId) {
      throw new Error('开始批量发布前必须先在客户端成功检测当前账号');
    }
    if (!plan || !Array.isArray(plan.items) || !plan.items.length) throw new Error('当前没有可执行的发布计划');
    const candidates = plan.items.filter((item) => (
      item.selected && ['pending', 'failed', 'skipped'].includes(item.execution?.state || 'pending')
    ));
    if (!candidates.length) throw new Error('当前没有勾选且可继续执行的视频');
    const blocked = candidates.filter((item) => !item.ready);
    if (blocked.length) throw new Error(`勾选项目中有${blocked.length}条素材未就绪，请先处理红色问题项`);

    const reporter = new RunReporter(this.reportsRoot, `批量定时发布-${account.label}`);
    let page;
    let activeItem = null;
    try {
      reporter.add('批次开始', `账号：${account.lastDetected.douyinId}；日期：${plan.date}；本次勾选${candidates.length}条`);
      for (const item of candidates) {
        this.assertNotCancelled();
        activeItem = item;
        await hooks.onItemState?.(item, 'running', '正在填写发布页面');
        reporter.add(`开始计划第${item.sequence}条`, `${path.basename(item.videoPath)}；${item.category}；${item.model}；${item.scheduledLocal}`);
        const scheduledAt = new Date(item.scheduledLocal.replace(' ', 'T'));
        const payload = normalizeTestPayload({
          videoPath: item.videoPath,
          coverPath: item.coverPath,
          body: item.body,
          tags: item.tags,
          scheduledAt: scheduledAt.toISOString()
        });
        payload.aiGenerated = item.aiGenerated === true;
        if (item.commerce?.required) payload.commerce = { ...item.commerce };
        const outcome = await this.publishPayload(payload, reporter, `计划第${item.sequence}条`);
        page = outcome.page;
        await hooks.onItemState?.(item, 'verified', '平台成功提示及作品管理记录均已核验', outcome.verification);
        reporter.add(`完成计划第${item.sequence}条`, '平台成功提示及作品管理记录均已核验');
        activeItem = null;
        await page.waitForTimeout(1500);
      }
      const reportPath = await reporter.save('published', null, page);
      return { status: 'published', count: candidates.length, reportPath };
    } catch (error) {
      if (activeItem) {
        await hooks.onItemState?.(
          activeItem,
          error.code === 'PUBLISH_OUTCOME_UNCERTAIN' ? 'uncertain' : 'failed',
          error.message
        ).catch(() => {});
      }
      const explained = asChineseError(error, '批量发布');
      reporter.add('批次停止并保留进度', `${explained.message}；已完成项目不会重复，未完成项目可稍后继续`);
      const status = error.code === 'PUBLISH_OUTCOME_UNCERTAIN' ? 'uncertain' : 'failed';
      if (!page) page = await this.getPage().catch(() => undefined);
      const reportPath = await reporter.save(status, explained, page);
      throw new Error(`${explained.message}。当前进度已保存，可处理后继续未完成项目。错误报告：${reportPath}`);
    }
  }

  async scanPublishedIds(account, plan) {
    if (!this.active || this.active.accountId !== account.id) throw new Error('请先打开发布账号的 Chrome');
    if (account.role !== 'production') throw new Error('发布ID只能从发布账号获取');
    const page = await this.getPage();
    const records = await this.readSelfProfileRecords(page);
    const unresolved = (plan?.items || []).filter((item) => !item.publish?.videoId && ['verified','id-resolved'].includes(item.execution?.state));
    const matches = [];
    for (const item of unresolved) {
      const selected = selectProfileRecord(records, item.body, item.scheduledLocal);
      if (selected.state !== 'matched') continue;
      matches.push({
        itemId: item.itemId,
        videoId: selected.record.videoId,
        videoUrl: selected.record.videoUrl
      });
    }
    return { matches, unresolved: unresolved.length - matches.length };
  }

  async scanTestPublishedId(account, rawInput = {}) {
    if (!this.active || this.active.accountId !== account.id) throw new Error('请先打开测试小号的 Chrome');
    if (account.role !== 'test') throw new Error('这个测试流程只允许使用测试小号');
    if (account.lastDetected?.state !== 'logged-in' || !account.lastDetected?.douyinId) {
      throw new Error('获取ID前必须先在客户端成功检测测试小号');
    }
    const body = String(rawInput.body || '').trim();
    const scheduledAt = new Date(String(rawInput.scheduledAt || ''));
    if (!body) throw new Error('请保留刚才发布时使用的测试文案，否则无法匹配视频');
    if (Number.isNaN(scheduledAt.getTime())) throw new Error('请保留刚才发布时使用的定时时间');
    const scheduledLocal = formatLocalMinute(scheduledAt);
    const page = await this.getPage();
    const records = await this.readSelfProfileRecords(page);
    const selected = selectProfileRecord(records, body, scheduledLocal);
    if (selected.state === 'matched') {
      return {
        videoId: selected.record.videoId,
        videoUrl: selected.record.videoUrl,
        matchedTitle: selected.titleNeedle,
        matchedTime: scheduledLocal,
        scheduleDetail: selected.record.scheduleDetail || ''
      };
    }
    if (selected.state === 'ambiguous') {
      throw new Error(`个人主页找到多条同时匹配文案和${scheduledLocal}的视频，无法安全确定唯一ID`);
    }
    if (selected.state === 'time-mismatch') {
      throw new Error(`个人主页已找到匹配文案，但没有读取到定时时间${scheduledLocal}对应的视频ID`);
    }
    throw new Error(`个人主页没有找到同时匹配文案和定时时间${scheduledLocal}的视频ID`);
  }

  async readSelfProfileRecords(page) {
    const apiRecords = [];
    const responseTasks = [];
    const captureResponse = (response) => {
      if (!response.url().includes('/aweme/v1/web/aweme/post/')) return;
      responseTasks.push(response.json()
        .then((payload) => { apiRecords.push(...extractProfileApiRecords(payload)); })
        .catch(() => {}));
    };
    page.on('response', captureResponse);
    try {
      await page.goto('https://www.douyin.com/user/self', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2500);
      let previousCount = 0;
      let unchangedRounds = 0;
      for (let round = 0; round < 5 && unchangedRounds < 2; round += 1) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await page.waitForTimeout(1200);
        await Promise.allSettled(responseTasks);
        if (apiRecords.length === previousCount) unchangedRounds += 1;
        else unchangedRounds = 0;
        previousCount = apiRecords.length;
      }
    } finally {
      page.off('response', captureResponse);
      await Promise.allSettled(responseTasks);
    }
    const linkRecords = await page.locator('a[href*="/video/"]').evaluateAll((anchors) => anchors.map((anchor) => {
      const href = String(anchor.href || anchor.getAttribute('href') || '');
      const videoId = href.match(/\/video\/(\d+)/)?.[1] || '';
      return {
        videoId,
        videoUrl: videoId ? `https://www.douyin.com/video/${videoId}` : href,
        body: String(anchor.innerText || anchor.textContent || ''),
        scheduledLocal: '',
        scheduleDetail: '',
        source: 'profile-link'
      };
    })).catch(() => []);
    return mergeProfileRecords(apiRecords, linkRecords);
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
      const coverResult = await this.fillCover(page, payload.coverPath);
      reporter.add(`${label}填写封面`, `${payload.coverPath}；竖封面和横封面均已设置${coverResult.recommendationDismissed ? '；已关闭“设置横封面获取多流量”提示' : ''}`);
    }

    if (payload.aiGenerated) {
      this.assertNotCancelled();
      await this.fillAiDeclaration(page);
      reporter.add(`${label}添加自主声明`, '内容由AI生成');
    }

    if (payload.commerce?.required) {
      this.assertNotCancelled();
      await this.fillCommerceProduct(page, payload.commerce);
      reporter.add(`${label}添加购物车商品`, `${payload.commerce.productShortTitle}；${payload.commerce.productUrl}`);
    }

    await this.fillSchedule(page, payload.localDate, payload.localTime);
    this.assertNotCancelled();
    reporter.add(`${label}填写定时发布`, `${payload.localDate} ${payload.localTime}`);
    await this.waitForVideoUploadComplete(page, reporter, label);
    await this.assertScheduleValue(page, payload.localDate, payload.localTime);
    reporter.add(`${label}提交前时间复核`, `${payload.localDate} ${payload.localTime}`);

    const publishResult = await this.clickPublishAndWait(page, reporter);
    reporter.add(`${label}发布结果`, publishResult.detail);
    const verification = await this.verifyScheduledEntry(page, payload);
    reporter.add(`${label}作品管理复核`, verification.detail);
    return { page, publishResult, verification };
  }

  async fillCommerceProduct(page, commerce) {
    const productUrl = String(commerce.productUrl || '').trim();
    const shortTitle = String(commerce.productShortTitle || '').trim().slice(0, 10);
    if (!/^https:\/\//.test(productUrl)) throw new Error('商城视频缺少已确认的商品链接');
    if (!shortTitle) throw new Error('商城视频缺少商品短标题');
    await this.assertNoBlockingModal(page, '添加购物车商品前检测到未关闭的弹窗');

    const labelText = page.getByText('标签', { exact: true }).first();
    if (!await labelText.isVisible({ timeout: 15_000 }).catch(() => false)) throw new Error('发布页面没有找到“标签”设置');
    const field = labelText.locator('xpath=following::*[self::div or self::span][1]');
    const select = page.locator('.semi-select, [role="combobox"]').filter({ hasText: /位置|购物车|小程序|标记万物/ }).first();
    if (await select.isVisible().catch(() => false)) await select.click();
    else await field.click();
    const cart = page.getByText('购物车', { exact: true }).last();
    if (!await cart.isVisible({ timeout: 10_000 }).catch(() => false)) throw new Error('标签下拉菜单中没有找到“购物车”');
    await cart.click();

    const linkInput = page.locator('input[placeholder*="链接"], input:not([type="hidden"])');
    let targetInput = null;
    for (let index = 0; index < await linkInput.count(); index += 1) {
      const candidate = linkInput.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const value = String(await candidate.inputValue().catch(() => ''));
      const placeholder = String(await candidate.getAttribute('placeholder') || '');
      if (/链接|http/i.test(`${value} ${placeholder}`) || !value) { targetInput = candidate; break; }
    }
    if (!targetInput) throw new Error('选择购物车后没有找到商品链接输入框');
    await targetInput.fill(productUrl);
    const addLink = page.getByText('添加链接', { exact: true }).last();
    if (!await addLink.isVisible({ timeout: 10_000 }).catch(() => false)) throw new Error('没有找到“添加链接”按钮');
    await addLink.click();

    const modal = page.locator('[role="dialog"]:visible, .semi-modal-wrap:visible').filter({ hasText: '编辑商品' }).last();
    if (!await modal.isVisible({ timeout: 20_000 }).catch(() => false)) throw new Error('添加商品链接后没有出现“编辑商品”窗口');
    const titleInput = modal.locator('input[placeholder*="商品短标题"], input').last();
    if (!await titleInput.isVisible().catch(() => false)) throw new Error('编辑商品窗口中没有找到商品短标题输入框');
    await titleInput.fill(shortTitle);
    const complete = modal.getByRole('button', { name: /完成编辑/ }).first();
    if (!await complete.isEnabled().catch(() => false)) throw new Error('商品短标题填写后“完成编辑”按钮仍不可用');
    await complete.click();
    await modal.waitFor({ state: 'hidden', timeout: 15_000 });

    const body = await page.locator('body').innerText().catch(() => '');
    if (!body.includes(shortTitle)) throw new Error('商品编辑窗口已关闭，但发布页面没有回显商品短标题');
  }

  async fillAiDeclaration(page) {
    await this.assertNoBlockingModal(page, '添加AI自主声明前检测到未关闭的弹窗');
    const entryPrompt = page.getByText(/请选择自主声明/, { exact: false }).first();
    const entryLabel = page.getByText('自主声明', { exact: true }).first();
    if (await entryPrompt.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await entryPrompt.click({ timeout: 5_000 });
    } else if (await entryLabel.isVisible().catch(() => false)) {
      const row = entryLabel.locator('xpath=..');
      await row.click({ timeout: 5_000 });
    } else {
      throw new Error('AI标识已勾选，但发布页面没有找到“自主声明”入口');
    }

    const modal = page.locator('[role="modal"]:visible, .semi-modal-wrap:visible, .dy-creator-content-modal-wrap:visible')
      .filter({ hasText: /对作品内容添加声明|请选择声明类型/ }).first();
    if (!await modal.isVisible({ timeout: 8_000 }).catch(() => false)) {
      throw new Error('点击“自主声明”后没有打开声明类型窗口');
    }
    const optionText = modal.getByText('内容由AI生成', { exact: true }).first();
    if (!await optionText.isVisible().catch(() => false)) throw new Error('自主声明窗口没有找到“内容由AI生成”选项');
    const optionRow = optionText.locator('xpath=ancestor::*[self::label or @role="radio"][1]');
    if (await optionRow.count()) await optionRow.click({ timeout: 5_000 });
    else await optionText.click({ timeout: 5_000 });

    const confirm = modal.getByRole('button', { name: '确定', exact: true }).first();
    if (!await confirm.isEnabled({ timeout: 5_000 }).catch(() => false)) {
      throw new Error('已选择“内容由AI生成”，但声明窗口的“确定”按钮仍不可用');
    }
    await confirm.click({ timeout: 5_000 });
    await modal.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {
      throw new Error('确认AI自主声明后弹窗没有关闭');
    });
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

  async verifyScheduledEntry(page, payload) {
    const manageUrl = 'https://creator.douyin.com/creator-micro/content/manage?enter_from=publish';
    if (!/\/creator-micro\/(content\/manage|manage)/.test(page.url())) {
      await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    }
    const titleNeedle = String(payload.body || '').replace(/\s+/g, '').slice(0, 18);
    if (!titleNeedle) {
      const error = new Error('正文为空，无法在作品管理中唯一复核对应视频');
      error.code = 'PUBLISH_OUTCOME_UNCERTAIN';
      throw error;
    }
    const monthDay = payload.localDate.slice(5);
    const timeNeedles = [
      `${payload.localDate} ${payload.localTime}`,
      `${monthDay} ${payload.localTime}`,
      payload.localTime
    ];
    const deadline = Date.now() + 45_000;
    let refreshed = false;
    while (Date.now() < deadline) {
      this.assertNotCancelled();
      const visibleText = String(await page.locator('body').innerText().catch(() => ''));
      const compact = visibleText.replace(/\s+/g, '');
      const titleMatched = compact.includes(titleNeedle);
      const timeMatched = timeNeedles.some((needle) => visibleText.includes(needle));
      if (titleMatched && timeMatched) {
        const links = page.locator('a[href*="/video/"], a[href*="item_id="], a[href*="itemId="]');
        let videoUrl = '';
        for (let index = 0; index < await links.count(); index += 1) {
          const link = links.nth(index);
          if (!await link.isVisible().catch(() => false)) continue;
          const containerText = String(await link.locator('xpath=ancestor::div[1]').innerText().catch(() => ''));
          if (containerText.replace(/\s+/g, '').includes(titleNeedle)) {
            videoUrl = String(await link.getAttribute('href') || '');
            break;
          }
        }
        const videoId = videoUrl.match(/\/video\/(\d+)/)?.[1]
          || videoUrl.match(/[?&](?:item_id|itemId)=(\d+)/)?.[1]
          || '';
        return {
          detail: `已在作品管理找到文案和时间对应记录：${payload.localDate} ${payload.localTime}`,
          videoUrl,
          videoId,
          matchedTitle: titleNeedle,
          scheduledLocal: `${payload.localDate} ${payload.localTime}`
        };
      }
      if (!refreshed && Date.now() + 20_000 >= deadline) {
        refreshed = true;
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
      }
      await page.waitForTimeout(1000);
    }
    const error = new Error(`平台出现成功提示，但作品管理中未找到文案和时间对应记录：${payload.localDate} ${payload.localTime}`);
    error.code = 'PUBLISH_OUTCOME_UNCERTAIN';
    throw error;
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
      if (Date.now() >= deadline) throw new Error('竖封面和横封面已上传，但“完成”按钮仍不可用');
      await page.waitForTimeout(300);
    }
    await done.click();
    const recommendationDismissed = await this.dismissKnownHorizontalRecommendation(page);
    await modal.waitFor({ state: 'hidden', timeout: 15_000 });
    await this.assertNoBlockingModal(page, '封面设置完成后仍有弹窗未关闭');
    return { recommendationDismissed };
  }

  async dismissKnownHorizontalRecommendation(page) {
    const title = page.getByText('设置横封面获取多流量', { exact: true }).last();
    const detectionDeadline = Date.now() + 3_000;
    while (!await title.isVisible().catch(() => false)) {
      if (Date.now() >= detectionDeadline) return false;
      await page.waitForTimeout(150);
    }
    const prompt = title.locator(
      'xpath=ancestor::*[@role="modal" or contains(@class,"semi-modal-wrap") or contains(@class,"modal")][1]'
    );
    if (!await prompt.count()) throw new Error('检测到“设置横封面获取多流量”提示，但无法定位其弹窗范围');
    const skip = prompt.getByRole('button', { name: '暂不设置', exact: true }).last();
    await skip.waitFor({ state: 'visible', timeout: 5_000 });
    if (!await skip.isEnabled().catch(() => false)) throw new Error('“设置横封面获取多流量”弹窗的“暂不设置”按钮不可用');
    await skip.click();
    await prompt.waitFor({ state: 'hidden', timeout: 10_000 });
    return true;
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
