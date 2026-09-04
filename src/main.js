const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const { AccountStore } = require('./account-store');
const { BrowserManager } = require('./browser-manager');
const { ConfigStore } = require('./config-store');
const { LibraryStore } = require('./library-store');
const { FeishuService } = require('./feishu-service');
const { FeishuBrowserManager } = require('./feishu-browser-manager');
const { PlanService } = require('./plan-service');
const { asChineseError } = require('./chinese-error');
const { DurationStore } = require('./duration-store');
const { AutomationGuard } = require('./automation-guard');
const { WorkspaceStore } = require('./workspace-store');
const { ProductMappingStore } = require('./product-mapping-store');
const { searchCandidatesOnPage } = require('./doudian-browser-manager');
const { WechatChannelsBrowserManager } = require('./wechat-channels-browser-manager');
const { createPublishingAdapter } = require('./publishing-adapters');

let mainWindow;
let accountStore;
let browserManager;
let feishuBrowserManager;
let configStore;
let libraryStore;
let planService;
let durationStore;
let automationGuard;
let workspaceStore;
let productMappingStore;
let wechatBrowserManager;
let publishingAdapter;
let nativeDialogHelperPath;

function elapsedText(durationMs) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function planTotalBytes(plan) {
  const fs = require('node:fs');
  return (plan?.items || []).reduce((sum, item) => {
    try { return sum + fs.statSync(item.videoPath).size; } catch { return sum; }
  }, 0);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.restore();
  mainWindow.focus();
}

function startGuard(kind) {
  if (kind === 'pull') feishuBrowserManager.beginAutomation();
  else if (kind === 'test') browserManager.beginAutomation();
  else publishingAdapter.beginAutomation();
  // 1.0.3 临时停用全屏覆盖层。它会拦截封面上传所需的 Windows 原生鼠标操作。
}

function allBrowserManagers() {
  return [browserManager, wechatBrowserManager].filter(Boolean);
}

function managerForAccount(account) {
  if (account.platform === 'wechat-channels') return wechatBrowserManager;
  return browserManager;
}

function combinedBrowserStatus() {
  const active = allBrowserManagers().map((manager) => manager.status()).find((status) => status.open);
  return active || { activeAccountId: null, open: false };
}

async function rebuildWorkspaceRuntime() {
  const workspace = workspaceStore.active();
  libraryStore = new LibraryStore(app.getPath('userData'), workspace.id);
  libraryStore.initialize();
  productMappingStore = new ProductMappingStore(libraryStore.productMappingFile);
  productMappingStore.initialize();
  feishuBrowserManager = new FeishuBrowserManager(path.join(
    app.getPath('userData'), '工作区', workspace.id, 'browser-profiles', 'feishu'
  ));
  browserManager = new BrowserManager(libraryStore.logsRoot, nativeDialogHelperPath);
  wechatBrowserManager = new WechatChannelsBrowserManager(libraryStore.logsRoot, nativeDialogHelperPath);
  publishingAdapter = createPublishingAdapter(workspace, {
    douyin: browserManager,
    wechat: wechatBrowserManager
  });
  planService = new PlanService(configStore, libraryStore, new FeishuService(feishuBrowserManager), {
    workspace,
    productMappingStore
  });
  return workspace;
}

function safeAccountProfile(accountId) {
  const account = accountStore.get(String(accountId));
  const profilesRoot = path.resolve(accountStore.profilesRoot);
  const profilePath = path.resolve(account.profilePath);
  const relative = path.relative(profilesRoot, profilePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('账号资料目录不在软件管理范围内，已拒绝操作');
  }
  return { account, profilePath };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 620,
    title: '短视频批量发布助手',
    icon: path.join(__dirname, 'renderer', 'assets', 'app-icon.png'),
    backgroundColor: '#f5f5f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });
}

function registerIpc() {
  ipcMain.on('guard:takeover', (event) => {
    if (automationGuard.owns(event.sender)) automationGuard.requestTakeover();
  });
  ipcMain.handle('workspaces:list', () => ({ active: workspaceStore.active(), items: workspaceStore.list() }));
  ipcMain.handle('workspace:update', (_event, workspaceId, input) => {
    const updated = workspaceStore.update(String(workspaceId), input || {});
    if (updated.id === workspaceStore.activeId()) planService.updateWorkspace(updated);
    return updated;
  });
  ipcMain.handle('workspace:select', async (_event, workspaceId) => {
    if (combinedBrowserStatus().open || feishuBrowserManager.status().open) {
      throw new Error('切换工作区前请先关闭当前发布账号、抖店和飞书 Chrome');
    }
    workspaceStore.select(String(workspaceId));
    return rebuildWorkspaceRuntime();
  });
  ipcMain.handle('accounts:list', () => accountStore.list());
  ipcMain.handle('browser:status', () => combinedBrowserStatus());
  ipcMain.handle('browser:open', async (_event, accountId) => {
    const account = accountStore.get(String(accountId));
    const other = allBrowserManagers().find((manager) => manager !== managerForAccount(account) && manager.status().open);
    if (other) throw new Error('另一个平台或账号的 Chrome 仍在运行，请先关闭后再切换');
    return managerForAccount(account).open(account);
  });
  ipcMain.handle('browser:detect', async (_event, accountId) => {
    const account = accountStore.get(String(accountId));
    const detection = await managerForAccount(account).detect(account.id);
    accountStore.saveDetection(account.id, detection);
    return detection;
  });
  ipcMain.handle('account:rename', (_event, accountId, label) => accountStore.rename(String(accountId), label));
  ipcMain.handle('account:open-folder', async (_event, accountId) => {
    const { profilePath } = safeAccountProfile(accountId);
    fs.mkdirSync(profilePath, { recursive: true });
    const result = await shell.openPath(profilePath);
    if (result) throw new Error(`打开账号目录失败：${result}`);
    return profilePath;
  });
  ipcMain.handle('account:reset', async (_event, accountId) => {
    const normalizedId = String(accountId);
    const { account, profilePath } = safeAccountProfile(normalizedId);
    if (managerForAccount(account).status().activeAccountId === normalizedId) {
      throw new Error('请先关闭这个账号的 Chrome，再删除账号登录资料');
    }
    if (fs.existsSync(profilePath)) {
      const information = fs.lstatSync(profilePath);
      if (information.isSymbolicLink()) throw new Error('账号资料目录是链接，已拒绝删除');
      await shell.trashItem(profilePath);
    }
    const reset = accountStore.reset(normalizedId);
    return { account: reset, removedProfile: account.label, recoverable: true };
  });
  ipcMain.handle('browser:close', async () => {
    await Promise.all(allBrowserManagers().map((manager) => manager.close()));
    return combinedBrowserStatus();
  });
  ipcMain.handle('file:choose-video', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择测试视频',
      properties: ['openFile'],
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'webm'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('file:choose-cover', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择封面图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('test-publish:submit', async (_event, payload) => {
    const platform = payload?.platform === 'wechat-channels' ? 'wechat-channels' : 'douyin';
    const account = accountStore.get(platform === 'wechat-channels' ? 'wechat-test' : 'test-account');
    if (account.lastDetected?.state !== 'logged-in') throw new Error('请先打开、检测并人工核对当前测试账号');
    if (platform === 'wechat-channels') wechatBrowserManager.beginAutomation();
    else browserManager.beginAutomation();
    const startedAt = Date.now();
    try {
      const result = platform === 'wechat-channels'
        ? await wechatBrowserManager.submitTestPublish(account, payload || {})
        : await browserManager.submitTestPublish(account, payload || {});
      automationGuard.stop();
      focusMainWindow();
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '测试发布完成', message: `${platform === 'wechat-channels' ? '视频号' : '抖音'}测试视频已经提交`,
        detail: `耗时${elapsedText(Date.now() - startedAt)}。请前往作品管理人工检查。`
      });
      return result;
    } finally {
      automationGuard.stop();
    }
  });
  ipcMain.handle('test-publish:resolve-id', async (_event, input) => {
    const account = accountStore.get('test-account');
    return browserManager.scanTestPublishedId(account, input || {});
  });
  ipcMain.handle('settings:get', () => configStore.publicConfig());
  ipcMain.handle('settings:save', (_event, input) => configStore.save(input || {}));
  ipcMain.handle('feishu-browser:status', () => feishuBrowserManager.status());
  ipcMain.handle('feishu-browser:open', () => feishuBrowserManager.open(workspaceStore.active().sheetUrl));
  ipcMain.handle('feishu-browser:detect', () => feishuBrowserManager.detect(workspaceStore.active().sheetUrl));
  ipcMain.handle('feishu-browser:close', () => feishuBrowserManager.close());
  ipcMain.handle('library:paths', () => libraryStore.paths());
  ipcMain.handle('library:open', async (_event, key) => {
    const paths = libraryStore.paths();
    if (!['covers', 'copy', 'tags', 'shortTitles', 'productConfig', 'cache', 'logs', 'records', 'root'].includes(String(key))) throw new Error('不允许打开这个目录');
    const result = await shell.openPath(paths[key]);
    if (result) throw new Error(`打开目录失败：${result}`);
    return paths[key];
  });
  ipcMain.handle('product-mapping:list', () => productMappingStore.list());
  ipcMain.handle('plan:current', () => planService.current());
  ipcMain.handle('plan:prepare-commerce', async () => {
    const workspace = workspaceStore.active();
    if (workspace.mode !== 'commerce') throw new Error('当前不是商城号工作区');
    const plan = planService.requirePlan();
    const account = accountStore.get(workspace.publisherAccountId);
    const context = browserManager.contextFor(account.id);
    const page = context.pages().find((candidate) => candidate.url().includes('fxg.jinritemai.com')) || await context.newPage();
    let fetched = 0;
    let needsConfirmation = 0;
    const failures = [];
    for (const item of plan.items.filter((candidate) => candidate.selected && candidate.commerce?.required)) {
      if (!item.commerce.searchModel) { failures.push(`${item.model}：缺少抖店搜索型号映射`); continue; }
      try {
        const candidates = await searchCandidatesOnPage(page, item.commerce.searchModel);
        const updated = planService.applyCommerceCandidates(item.itemId, candidates);
        const currentItem = updated.items.find((candidate) => candidate.itemId === item.itemId);
        if (currentItem.commerce.state === 'needs-confirmation') needsConfirmation += 1;
        else if (currentItem.commerce.state === 'ready') fetched += 1;
      } catch (error) {
        planService.applyCommerceCandidates(item.itemId, []);
        failures.push(`${item.model}：${error.message}`);
      }
    }
    await page.bringToFront();
    return { plan: planService.current(), fetched, needsConfirmation, failures };
  });
  ipcMain.handle('duration:estimates', () => durationStore.estimates(planService.current()));
  ipcMain.handle('plan:create', async (_event, input) => {
    const date = typeof input === 'string' ? input : input?.date;
    const filterMode = typeof input === 'object' ? input?.filterMode : 'auto';
    const startedAt = Date.now();
    startGuard('pull');
    try {
      const plan = await planService.create(String(date || ''), { filterMode });
      const durationMs = Date.now() - startedAt;
      durationStore.record('pull', plan.items.length, durationMs);
      automationGuard.stop();
      focusMainWindow();
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '素材拉取完成', message: `已生成${plan.items.length}条发布计划`,
        detail: `实际耗时${elapsedText(durationMs)}。请逐行检查文件、产品、时间、文案、Tag和封面。`
      });
      return plan;
    } catch (error) {
      throw asChineseError(error, '生成发布计划');
    } finally {
      automationGuard.stop();
    }
  });
  ipcMain.handle('plan:update-item', (_event, itemId, input) => planService.updateItem(itemId, input || {}));
  ipcMain.handle('plan:set-selection', (_event, itemIds, selected) => planService.setSelections(itemIds, selected));
  ipcMain.handle('plan:confirm-uncertain', (_event, itemId, published) => planService.confirmUncertain(itemId, Boolean(published)));
  ipcMain.handle('plan:choose-cover', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '为计划项选择封面', properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('plan:export-ids', () => planService.exportIdRecords());
  ipcMain.handle('plan:copy-id-table', () => {
    const records = planService.exportIdRecords();
    if (!records.idClipboardText) throw new Error('当前计划还没有已获取的发布ID，无法复制');
    clipboard.writeText(records.idClipboardText);
    return { ...records, clipboardText: undefined, idClipboardText: undefined };
  });
  ipcMain.handle('plan:sync-ids', async () => {
    const plan = planService.requirePlan();
    const activeAccountId = publishingAdapter.status().activeAccountId;
    if (!activeAccountId) throw new Error('请先打开并检测发布账号');
    const account = accountStore.get(activeAccountId);
    const result = await publishingAdapter.syncIds(account, plan);
    for (const match of result.matches) planService.updatePublishIdentity(match.itemId, match);
    const records = planService.exportIdRecords();
    return { ...result, records };
  });
  ipcMain.handle('plan:open-id-records', async () => {
    fs.mkdirSync(libraryStore.recordsRoot, { recursive: true });
    const result = await shell.openPath(libraryStore.recordsRoot);
    if (result) throw new Error(`打开发布ID记录目录失败：${result}`);
    return libraryStore.recordsRoot;
  });
  ipcMain.handle('plan:execute', async () => {
    const plan = planService.current();
    if (!plan || plan.invalid) throw new Error('当前计划缓存已损坏，请重新生成计划后再发布');
    const activeAccountId = publishingAdapter.status().activeAccountId;
    if (!activeAccountId) throw new Error('请先打开并检测要发布的账号');
    const account = accountStore.get(activeAccountId);
    if (account.id !== plan.workspace?.publisherAccountId && plan.workspace) throw new Error('当前账号与计划锁定的发布账号不一致');
    if (account.role !== 'production') throw new Error('正式批量发布只允许使用“发布账号”；测试请进入测试工具');
    planService.updateStatus('executing', `正在使用${account.label}发布`);
    const startedAt = Date.now();
    startGuard('publish');
    try {
      const result = await publishingAdapter.execute(account, plan, {
        onItemState: async (item, state, detail, evidence) => {
          planService.markItem(item.itemId, state, detail, evidence || null);
          if (state === 'verified' && evidence?.videoId) {
            planService.updatePublishIdentity(item.itemId, {
              videoId: evidence.videoId,
              videoUrl: evidence.videoUrl || `https://www.douyin.com/video/${evidence.videoId}`
            });
          }
          mainWindow?.webContents.send('plan:item-state', { itemId: item.itemId, state, detail });
        }
      });
      planService.updateStatus('published', `已发布${result.count}条；日志：${result.reportPath}`);
      const records = planService.exportIdRecords();
      result.records = records;
      const durationMs = Date.now() - startedAt;
      durationStore.record('publish', result.count, durationMs, planTotalBytes(plan));
      automationGuard.stop();
      focusMainWindow();
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '批量发布完成', message: `全部${result.count}条视频已经提交`,
        detail: `实际耗时${elapsedText(durationMs)}。请前往作品管理核对发布数量和定时时间。\nID记录：${records.filePath}\nID表格：${records.csvPath}`
      });
      return result;
    } catch (error) {
      planService.updateStatus('failed', error.message);
      throw error;
    } finally {
      automationGuard.stop();
    }
  });
  ipcMain.handle('cache:clear', () => libraryStore.clearCache());
}

app.whenReady().then(() => {
  accountStore = new AccountStore(app.getPath('userData'));
  accountStore.initialize();
  configStore = new ConfigStore(app.getPath('userData'));
  configStore.initialize();
  workspaceStore = new WorkspaceStore(app.getPath('userData'));
  workspaceStore.initialize(configStore.settings().sheetUrl);
  durationStore = new DurationStore(app.getPath('userData'));
  automationGuard = new AutomationGuard();
  nativeDialogHelperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'FileDialogHelper.exe')
    : path.join(__dirname, '..', 'native', 'FileDialogHelper.exe');
  rebuildWorkspaceRuntime();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', async () => {
  await Promise.all([...allBrowserManagers().map((manager) => manager.close()), feishuBrowserManager.close()]);
  app.quit();
});

app.on('before-quit', () => {
  automationGuard?.stop();
  for (const manager of allBrowserManagers()) manager.close().catch(() => {});
  feishuBrowserManager.close().catch(() => {});
});
