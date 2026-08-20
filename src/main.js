const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
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

let mainWindow;
let accountStore;
let browserManager;
let feishuBrowserManager;
let configStore;
let libraryStore;
let planService;
let durationStore;
let automationGuard;

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
  else browserManager.beginAutomation();
  // 1.0.3 临时停用全屏覆盖层。它会拦截封面上传所需的 Windows 原生鼠标操作。
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
    title: '抖音批量发布助手',
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
  ipcMain.handle('accounts:list', () => accountStore.list());
  ipcMain.handle('browser:status', () => browserManager.status());
  ipcMain.handle('browser:open', async (_event, accountId) => {
    const account = accountStore.get(String(accountId));
    return browserManager.open(account);
  });
  ipcMain.handle('browser:detect', async (_event, accountId) => {
    const account = accountStore.get(String(accountId));
    const detection = await browserManager.detect(account.id);
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
    if (browserManager.status().activeAccountId === normalizedId) {
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
  ipcMain.handle('browser:close', () => browserManager.close());
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
    const account = accountStore.get('test-account');
    startGuard('publish');
    const startedAt = Date.now();
    try {
      const result = await browserManager.submitTestPublish(account, payload || {});
      automationGuard.stop();
      focusMainWindow();
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '测试发布完成', message: '测试视频已经提交',
        detail: `耗时${elapsedText(Date.now() - startedAt)}。请前往作品管理人工检查。`
      });
      return result;
    } finally {
      automationGuard.stop();
    }
  });
  ipcMain.handle('settings:get', () => configStore.publicConfig());
  ipcMain.handle('settings:save', (_event, input) => configStore.save(input || {}));
  ipcMain.handle('feishu-browser:status', () => feishuBrowserManager.status());
  ipcMain.handle('feishu-browser:open', () => feishuBrowserManager.open(configStore.settings().sheetUrl));
  ipcMain.handle('feishu-browser:detect', () => feishuBrowserManager.detect(configStore.settings().sheetUrl));
  ipcMain.handle('feishu-browser:close', () => feishuBrowserManager.close());
  ipcMain.handle('library:paths', () => libraryStore.paths());
  ipcMain.handle('library:open', async (_event, key) => {
    const paths = libraryStore.paths();
    if (!['covers', 'copy', 'tags', 'cache', 'logs', 'root'].includes(String(key))) throw new Error('不允许打开这个目录');
    const result = await shell.openPath(paths[key]);
    if (result) throw new Error(`打开目录失败：${result}`);
    return paths[key];
  });
  ipcMain.handle('plan:current', () => planService.current());
  ipcMain.handle('duration:estimates', () => durationStore.estimates(planService.current()));
  ipcMain.handle('plan:create', async (_event, date) => {
    const startedAt = Date.now();
    startGuard('pull');
    try {
      const plan = await planService.create(String(date || ''));
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
  ipcMain.handle('plan:execute', async () => {
    const plan = planService.current();
    if (!plan || plan.invalid) throw new Error('当前计划缓存已损坏，请重新生成计划后再发布');
    const activeAccountId = browserManager.status().activeAccountId;
    if (!activeAccountId) throw new Error('请先打开并检测要发布的账号');
    const account = accountStore.get(activeAccountId);
    if (account.role !== 'production') throw new Error('正式批量发布只允许使用“发布账号”；测试请进入测试工具');
    planService.updateStatus('executing', `正在使用${account.label}发布`);
    const startedAt = Date.now();
    startGuard('publish');
    try {
      const result = await browserManager.submitPlannedBatch(account, plan);
      planService.updateStatus('published', `已发布${result.count}条；日志：${result.reportPath}`);
      const durationMs = Date.now() - startedAt;
      durationStore.record('publish', result.count, durationMs, planTotalBytes(plan));
      automationGuard.stop();
      focusMainWindow();
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: '批量发布完成', message: `全部${result.count}条视频已经提交`,
        detail: `实际耗时${elapsedText(durationMs)}。请前往作品管理核对发布数量和定时时间。`
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
  libraryStore = new LibraryStore(app.getPath('userData'));
  libraryStore.initialize();
  configStore = new ConfigStore(app.getPath('userData'));
  configStore.initialize();
  durationStore = new DurationStore(app.getPath('userData'));
  automationGuard = new AutomationGuard();
  feishuBrowserManager = new FeishuBrowserManager(path.join(app.getPath('userData'), 'browser-profiles', 'feishu'));
  planService = new PlanService(configStore, libraryStore, new FeishuService(feishuBrowserManager));
  const nativeDialogHelperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'FileDialogHelper.exe')
    : path.join(__dirname, '..', 'native', 'FileDialogHelper.exe');
  browserManager = new BrowserManager(libraryStore.logsRoot, nativeDialogHelperPath);
  registerIpc();
  createWindow();
});

app.on('window-all-closed', async () => {
  await Promise.all([browserManager.close(), feishuBrowserManager.close()]);
  app.quit();
});

app.on('before-quit', () => {
  automationGuard?.stop();
  browserManager.close().catch(() => {});
  feishuBrowserManager.close().catch(() => {});
});
