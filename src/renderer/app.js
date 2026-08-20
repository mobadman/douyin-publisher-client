const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'global-status','accounts-main','accounts-test','settings-accounts','sheet-url','save-sheet','open-feishu','detect-feishu','close-feishu','settings-status','settings-state','plan-date','create-plan','clear-cache','plan-body','plan-status','plan-summary','batch-confirm','execute-plan','batch-status','pull-estimate','publish-estimate','choose-video','choose-cover','video-path','cover-path','test-body','body-count','test-tags','scheduled-at','test-confirm','prepare-test','prepare-status','watermark-enabled','guard-seconds','save-preferences','preferences-status','close-browser','settings-close-feishu','finish-guide','open-donation','donation-modal','delete-account-modal','delete-account-description','delete-check','delete-account-name','delete-confirm-phrase','confirm-delete-account','delete-account-status'
].map((id) => [id, byId(id)]));
let accounts = [], browserStatus = {}, settings = {}, feishuStatus = {}, libraryPaths = {}, currentPlan = null, estimates = {};
let videoPath = null, coverPath = null, busy = false, activePage = 'main';
let pendingDeleteAccountId = null;

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]); }
function basename(value) { return String(value || '').split(/[\\/]/).pop() || '—'; }
function setStatus(message, type = '') { ui['global-status'].textContent = message; ui['global-status'].className = type; }

function showPage(name) {
  activePage = name;
  document.querySelectorAll('[data-page-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.pagePanel === name));
  document.querySelectorAll('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  document.querySelector('main').scrollTo?.(0, 0);
}

function detectionHtml(account) {
  const detected = account.lastDetected;
  if (!detected) return '<span>尚未检测。首次使用需要扫码登录。</span>';
  if (detected.state === 'logged-in') return `<strong>${escapeHtml(detected.nickname || '已登录账号')}</strong><br>抖音号：${escapeHtml(detected.douyinId || '未识别')}<br><small>上次检测：${new Date(detected.checkedAt).toLocaleString()}</small>`;
  return `<span>${escapeHtml(detected.message)}</span>`;
}

function accountCard(account) {
  const active = browserStatus.activeAccountId === account.id;
  const otherActive = browserStatus.open && !active;
  return `<article class="card ${active ? 'active' : ''}"><div class="card-head"><h2>${escapeHtml(account.label)}</h2><span class="role ${account.role}">${account.role === 'production' ? '正式账号' : '测试账号'}</span></div><div class="details">${detectionHtml(account)}<span class="path">本地专用资料：${escapeHtml(account.profilePath)}</span></div><div class="actions"><button data-account-action="open" data-id="${account.id}" ${busy || otherActive ? 'disabled' : ''}>${active ? '切回 Chrome' : '打开 Chrome 登录'}</button><button class="secondary" data-account-action="detect" data-id="${account.id}" ${busy || !active ? 'disabled' : ''}>检测当前账号</button></div></article>`;
}

function accountSettingsCard(account) {
  const active = browserStatus.activeAccountId === account.id;
  const detectedId = account.lastDetected?.douyinId || '尚未检测';
  return `<article class="account-settings-card"><div class="card-head"><div><strong>${escapeHtml(account.label)}</strong><div class="panel-note">${account.role === 'production' ? '发布账号' : '测试账号'} · 抖音号：${escapeHtml(detectedId)}</div></div><span class="role ${account.role}">${account.role === 'production' ? '正式' : '测试'}</span></div><label class="field"><span>软件内显示昵称</span><input data-account-label="${account.id}" value="${escapeHtml(account.label)}" maxlength="24"></label><div class="actions"><button data-settings-account-action="rename" data-id="${account.id}" ${busy ? 'disabled' : ''}>修改昵称</button><button class="secondary" data-settings-account-action="detect" data-id="${account.id}" ${busy || !active ? 'disabled' : ''}>核对信息</button><button class="secondary" data-settings-account-action="folder" data-id="${account.id}" ${busy ? 'disabled' : ''}>打开本地文件夹</button><button class="danger" data-settings-account-action="delete" data-id="${account.id}" ${busy || active ? 'disabled' : ''}>删除账号</button></div>${active ? '<p class="panel-note">删除前请先关闭这个账号的 Chrome。</p>' : ''}</article>`;
}

function renderSettingsAccounts() {
  ui['settings-accounts'].innerHTML = accounts.map(accountSettingsCard).join('');
}

function closeModal(id) {
  const modal = ui[id];
  if (modal) modal.hidden = true;
  if (id === 'delete-account-modal') pendingDeleteAccountId = null;
}

function openDeleteAccountModal(accountId) {
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return;
  pendingDeleteAccountId = accountId;
  ui['delete-account-description'].textContent = `目标：${account.label}（${account.role === 'production' ? '发布账号' : '测试账号'}）。将删除本地 Chrome 登录资料并清除检测信息，账号角色会保留。`;
  ui['delete-check'].checked = false;
  ui['delete-account-name'].value = '';
  ui['delete-confirm-phrase'].value = '';
  ui['delete-account-status'].textContent = '';
  ui['delete-account-modal'].hidden = false;
  updateDeleteConfirmation();
}

function updateDeleteConfirmation() {
  const account = accounts.find((item) => item.id === pendingDeleteAccountId);
  const verified = Boolean(account)
    && ui['delete-check'].checked
    && ui['delete-account-name'].value.trim() === account.label
    && ui['delete-confirm-phrase'].value.trim() === '删除账号';
  ui['confirm-delete-account'].disabled = !verified || busy;
}

function renderPlan() {
  if (currentPlan?.invalid) {
    ui['plan-body'].innerHTML = '<tr class="problem-row"><td colspan="9">当前计划缓存文件损坏，已忽略；账号和登录资料没有丢失</td></tr>';
    ui['plan-summary'].textContent = '计划不可用';
    ui['plan-status'].textContent = `${currentPlan.statusDetail}；${(currentPlan.warnings || []).join('；')}`;
    ui['plan-status'].className = 'panel-note error';
    return;
  }
  if (!currentPlan?.items?.length) {
    ui['plan-body'].innerHTML = '<tr><td colspan="9">等待生成计划</td></tr>';
    ui['plan-summary'].textContent = '';
    return;
  }
  ui['plan-summary'].textContent = `${currentPlan.date} · ${currentPlan.items.length}条 · ${currentPlan.items.filter((item) => item.ready).length}条就绪`;
  ui['plan-body'].innerHTML = currentPlan.items.map((item) => `<tr class="${item.ready ? '' : 'problem-row'}"><td>${item.sequence}</td><td title="${escapeHtml(item.videoPath)}">${escapeHtml(basename(item.videoPath))}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.model)}</td><td>${escapeHtml(item.scheduledLocal.slice(11))}</td><td title="${escapeHtml(item.body)}">${escapeHtml(item.body || '—')}</td><td title="${escapeHtml((item.tags || []).join('、'))}">${escapeHtml((item.tags || []).join('、') || '—')}</td><td title="${escapeHtml(item.coverPath)}">${escapeHtml(basename(item.coverPath))}</td><td class="${item.ready ? 'success' : 'error'}">${item.ready ? '就绪' : escapeHtml(item.problems.join('；'))}</td></tr>`).join('');
  const warnings = currentPlan.warnings?.length ? `；${currentPlan.warnings.join('；')}` : '';
  ui['plan-status'].textContent = `计划状态：${currentPlan.status}${currentPlan.statusDetail ? `；${currentPlan.statusDetail}` : ''}${warnings}`;
  ui['plan-status'].className = currentPlan.items.every((item) => item.ready) ? 'panel-note success' : 'panel-note error';
}

function render() {
  ui['accounts-main'].innerHTML = accounts.filter((item) => item.role === 'production').map(accountCard).join('');
  ui['accounts-test'].innerHTML = accounts.filter((item) => item.role === 'test').map(accountCard).join('');
  const production = accounts.find((item) => item.role === 'production');
  const test = accounts.find((item) => item.role === 'test');
  const planReady = currentPlan?.items?.length && currentPlan.items.every((item) => item.ready) && !['executing','published'].includes(currentPlan.status);
  ui['execute-plan'].disabled = busy || !planReady || browserStatus.activeAccountId !== production?.id || production?.lastDetected?.state !== 'logged-in';
  ui['prepare-test'].disabled = busy || browserStatus.activeAccountId !== test?.id || test?.lastDetected?.state !== 'logged-in';
  ui['create-plan'].disabled = busy || !feishuStatus.loggedIn;
  for (const id of ['save-sheet','open-feishu','clear-cache']) ui[id].disabled = busy;
  ui['save-preferences'].disabled = true;
  ui['watermark-enabled'].disabled = true;
  ui['guard-seconds'].disabled = true;
  ui['detect-feishu'].disabled = busy || !feishuStatus.open;
  ui['close-feishu'].disabled = busy || !feishuStatus.open;
  ui['close-browser'].disabled = busy || !browserStatus.open;
  ui['settings-close-feishu'].disabled = busy || !feishuStatus.open;
  ui['pull-estimate'].textContent = estimates.pull || '预计约6–13分钟（按8–20条）';
  ui['publish-estimate'].textContent = estimates.publish || '完成计划后显示';
  renderSettingsAccounts();
  renderPlan();
}

async function refresh() {
  const results = await Promise.allSettled([
    window.publisher.listAccounts(), window.publisher.getBrowserStatus(), window.publisher.getSettings(), window.publisher.getFeishuBrowserStatus(), window.publisher.getLibraryPaths(), window.publisher.getCurrentPlan(), window.publisher.getDurationEstimates()
  ]);
  if (results[0].status === 'rejected') throw results[0].reason;
  accounts = results[0].value;
  browserStatus = results[1].status === 'fulfilled' ? results[1].value : { open: false, activeAccountId: null };
  settings = results[2].status === 'fulfilled' ? results[2].value : settings;
  feishuStatus = results[3].status === 'fulfilled' ? results[3].value : { open: false, loggedIn: false };
  libraryPaths = results[4].status === 'fulfilled' ? results[4].value : libraryPaths;
  currentPlan = results[5].status === 'fulfilled' ? results[5].value : { invalid: true, status: 'invalid', statusDetail: results[5].reason?.message || '当前计划读取失败', items: [] };
  estimates = results[6].status === 'fulfilled' ? results[6].value : estimates;
  const nonAccountErrors = results.slice(1).filter((result) => result.status === 'rejected');
  if (nonAccountErrors.length) setStatus(`账号模块已正常加载；另有${nonAccountErrors.length}个模块初始化失败，请查看对应区域。`, 'error');
  ui['sheet-url'].value = settings.sheetUrl || '';
  ui['watermark-enabled'].checked = settings.watermarkEnabled !== false;
  ui['guard-seconds'].value = settings.guardSeconds || 2;
  ui['settings-state'].textContent = feishuStatus.loggedIn ? '飞书已登录' : feishuStatus.open ? '等待登录检测' : '飞书未打开';
  render();
}

async function run(action, successMessage, target = null) {
  busy = true; render(); setStatus('正在处理，请稍候…');
  try { await action(); await refresh(); setStatus(successMessage, 'success'); }
  catch (error) { const message = error.message || String(error); setStatus(message, 'error'); if (target) { target.textContent = message; target.className = 'error'; } }
  finally { busy = false; render(); }
}

document.addEventListener('click', (event) => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) showPage(pageButton.dataset.page);
  const accountButton = event.target.closest('[data-account-action]');
  if (accountButton) {
    const accountId = accountButton.dataset.id;
    if (accountButton.dataset.accountAction === 'open') run(() => window.publisher.openBrowser(accountId), 'Chrome 已打开。登录后请返回客户端检测账号。');
    else run(() => window.publisher.detectAccount(accountId), '账号检测完成，请人工核对显示的账号。');
  }
  const settingsAccountButton = event.target.closest('[data-settings-account-action]');
  if (settingsAccountButton) {
    const accountId = settingsAccountButton.dataset.id;
    const action = settingsAccountButton.dataset.settingsAccountAction;
    if (action === 'rename') {
      const input = document.querySelector(`[data-account-label="${accountId}"]`);
      run(() => window.publisher.renameAccount(accountId, input?.value || ''), '账号昵称已修改。');
    } else if (action === 'detect') {
      run(() => window.publisher.detectAccount(accountId), '账号信息核对完成。');
    } else if (action === 'folder') {
      run(() => window.publisher.openAccountFolder(accountId), '账号本地文件夹已打开。');
    } else if (action === 'delete') {
      openDeleteAccountModal(accountId);
    }
  }
  const libraryButton = event.target.closest('[data-library]');
  if (libraryButton) window.publisher.openLibrary(libraryButton.dataset.library).then(() => setStatus(`已打开目录：${libraryPaths[libraryButton.dataset.library] || ''}`, 'success')).catch((error) => setStatus(error.message, 'error'));
});

document.addEventListener('click', (event) => {
  const closeButton = event.target.closest('[data-close-modal]');
  if (closeButton) closeModal(closeButton.dataset.closeModal);
});

for (const control of [ui['delete-check'], ui['delete-account-name'], ui['delete-confirm-phrase']]) {
  control.addEventListener('input', updateDeleteConfirmation);
  control.addEventListener('change', updateDeleteConfirmation);
}

ui['open-donation'].addEventListener('click', () => { ui['donation-modal'].hidden = false; });
ui['confirm-delete-account'].addEventListener('click', () => {
  const accountId = pendingDeleteAccountId;
  if (!accountId || ui['confirm-delete-account'].disabled) return;
  run(async () => {
    await window.publisher.resetAccount(accountId);
    closeModal('delete-account-modal');
  }, '账号登录资料已移入回收站，账号槽位已重置。', ui['delete-account-status']);
});

ui['save-sheet'].addEventListener('click', () => run(async () => { settings = await window.publisher.saveSettings({ ...settings, sheetUrl: ui['sheet-url'].value }); ui['settings-status'].textContent = '链接已保存'; }, '飞书表格链接已保存。', ui['settings-status']));
ui['open-feishu'].addEventListener('click', () => run(() => window.publisher.openFeishuBrowser(), '飞书 Chrome 已打开。登录并看到目标表格后点击检测登录。', ui['settings-status']));
ui['detect-feishu'].addEventListener('click', () => run(async () => { const result = await window.publisher.detectFeishuLogin(); ui['settings-status'].textContent = result.message; }, '飞书登录检测完成。', ui['settings-status']));
ui['close-feishu'].addEventListener('click', () => run(() => window.publisher.closeFeishuBrowser(), '飞书 Chrome 已关闭，登录状态保留。', ui['settings-status']));
ui['settings-close-feishu'].addEventListener('click', () => run(() => window.publisher.closeFeishuBrowser(), '飞书 Chrome 已关闭，登录状态保留。'));
ui['close-browser'].addEventListener('click', () => run(() => window.publisher.closeBrowser(), '抖音 Chrome 已关闭，登录状态保留。'));

ui['create-plan'].addEventListener('click', () => {
  if (!ui['plan-date'].value) { ui['plan-status'].textContent = '请先选择发布日期'; ui['plan-status'].className = 'panel-note error'; return; }
  run(async () => { ui['plan-status'].textContent = '正在只读获取飞书数据、下载视频并匹配本地素材…'; currentPlan = await window.publisher.createPlan(ui['plan-date'].value); ui['batch-confirm'].checked = false; }, '计划已经生成，请逐行人工检查。', ui['plan-status']);
});
ui['execute-plan'].addEventListener('click', () => {
  if (!ui['batch-confirm'].checked) { ui['batch-status'].textContent = '请先勾选人工检查和批量发布授权'; ui['batch-status'].className = 'error'; return; }
  if (!confirm(`即将在正式账号实际发布 ${currentPlan?.items?.length || 0} 条视频。任意错误会停止整批，确认继续吗？`)) return;
  run(async () => { ui['batch-status'].textContent = '正在逐条发布，请勿操作设备…'; const result = await window.publisher.executePlan(); ui['batch-status'].textContent = `全部${result.count}条已提交。日志：${result.reportPath}`; ui['batch-status'].className = 'success'; }, '批量发布完成，请前往作品管理核对。', ui['batch-status']);
});
ui['clear-cache'].addEventListener('click', () => { if (!confirm('只删除下载缓存和当前计划，保留素材库与发布日志。确认清理吗？')) return; run(async () => { const result = await window.publisher.clearCache(); currentPlan = null; ui['batch-confirm'].checked = false; ui['plan-status'].textContent = `缓存已清理，共移除${result.removed}项。`; }, '下载缓存已经清理，发布日志保持不变。', ui['plan-status']); });

ui['choose-video'].addEventListener('click', async () => { const value = await window.publisher.chooseVideo(); if (value) { videoPath = value; ui['video-path'].textContent = value; } });
ui['choose-cover'].addEventListener('click', async () => { const value = await window.publisher.chooseCover(); if (value) { coverPath = value; ui['cover-path'].textContent = value; } });
ui['test-body'].addEventListener('input', () => { const count = (ui['test-body'].value.match(/[\u3400-\u9fff]/g) || []).length; ui['body-count'].textContent = `${count} 个汉字`; ui['body-count'].className = count > 20 ? 'error' : ''; });
ui['prepare-test'].addEventListener('click', () => { if (!ui['test-confirm'].checked) { ui['prepare-status'].textContent = '请先确认测试账号并授权实际发布'; ui['prepare-status'].className = 'error'; return; } if (!confirm('本次会在测试小号实际点击一次发布，确认继续吗？')) return; run(async () => { const result = await window.publisher.submitTestPublish({ videoPath, coverPath, body: ui['test-body'].value, tags: ui['test-tags'].value, scheduledAt: ui['scheduled-at'].value }); ui['prepare-status'].textContent = `已提交。报告：${result.reportPath}`; ui['prepare-status'].className = 'success'; }, '测试视频已提交，请立即人工检查。', ui['prepare-status']); });

ui['save-preferences'].addEventListener('click', () => run(async () => { settings = await window.publisher.saveSettings({ ...settings, sheetUrl: ui['sheet-url'].value, watermarkEnabled: ui['watermark-enabled'].checked, guardSeconds: Number(ui['guard-seconds'].value) }); ui['preferences-status'].textContent = '设置已保存'; ui['preferences-status'].className = 'success'; }, '防误操设置已保存。', ui['preferences-status']));
ui['finish-guide'].addEventListener('click', () => run(async () => { settings = await window.publisher.saveSettings({ ...settings, sheetUrl: ui['sheet-url'].value, guideCompleted: true }); showPage('main'); }, '准备状态已记录，可以开始使用主工作台。'));
window.publisher.onAutomationTakeover((kind) => { setStatus(kind === 'pull' ? '已请求人工接管，素材拉取将在安全检查点停止。' : '已请求人工接管，发布将在安全检查点停止。', 'error'); });

const tomorrow = new Date(Date.now() + 86400000);
ui['plan-date'].value = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
refresh().then(() => { if (!settings.guideCompleted) showPage('guide'); setStatus('本地配置已就绪。'); }).catch((error) => setStatus(error.message, 'error'));
