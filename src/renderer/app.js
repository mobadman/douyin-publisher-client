const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'global-status','accounts-main','accounts-test','settings-accounts','workspace-select','select-workspace','workspace-status','workspace-badge','workspace-platform','sheet-url','save-sheet','open-feishu','detect-feishu','close-feishu','settings-status','settings-state','commerce-panel','open-short-titles','prepare-commerce','commerce-status','mapping-list','plan-date','create-plan-current-filter','clear-cache','plan-body','plan-status','plan-summary','batch-confirm','execute-plan','batch-status','pull-estimate','publish-estimate','select-all','select-none','selection-summary','sync-ids','export-ids','copy-id-table','open-id-records','edit-plan-modal','edit-plan-file','edit-plan-category','edit-plan-model','edit-plan-time','edit-plan-body','edit-plan-tags','edit-plan-choose-cover','edit-plan-cover','edit-commerce-fields','edit-product-short-title','edit-product-link','save-plan-item','edit-plan-status','test-platform','test-platform-badge','test-id-tool','choose-video','choose-cover','video-path','cover-path','test-body','body-count','test-tags','scheduled-at','test-confirm','prepare-test','prepare-status','test-resolve-id','test-id-status','watermark-enabled','guard-seconds','save-preferences','preferences-status','close-browser','settings-close-feishu','finish-guide','open-donation','donation-modal','delete-account-modal','delete-account-description','delete-check','delete-account-name','delete-confirm-phrase','confirm-delete-account','delete-account-status'
].map((id) => [id, byId(id)]));
let workspaces = [], activeWorkspace = null, accounts = [], browserStatus = {}, settings = {}, feishuStatus = {}, libraryPaths = {}, productMappings = [], currentPlan = null, estimates = {};
let videoPath = null, coverPath = null, busy = false, activePage = 'main';
let testPlatform = 'douyin';
let pendingDeleteAccountId = null;
let editingItemId = null;
let editingCoverPath = null;

const stateLabels = {
  pending: '待发布', running: '执行中', verified: '已发布并核验',
  failed: '失败，可续发', uncertain: '结果待人工确认', skipped: '未勾选', 'id-resolved': '已获取ID',
  'waiting-human': '等待管理员扫码'
};

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
  if (detected.state === 'logged-in') return `<strong>${escapeHtml(detected.nickname || '已登录账号')}</strong><br>账号标识：${escapeHtml(detected.douyinId || '未识别')}<br><small>上次检测：${new Date(detected.checkedAt).toLocaleString()}</small>`;
  return `<span>${escapeHtml(detected.message)}</span>`;
}

function accountCard(account) {
  const active = browserStatus.activeAccountId === account.id;
  const otherActive = browserStatus.open && !active;
  const role = account.surface === 'shop' ? '抖店商品账号' : account.role === 'production' ? '正式发布账号' : '测试账号';
  return `<article class="card ${active ? 'active' : ''}"><div class="card-head"><h2>${escapeHtml(account.label)}</h2><span class="role ${account.role}">${role}</span></div><div class="details">${detectionHtml(account)}<span class="path">本地专用资料：${escapeHtml(account.profilePath)}</span></div><div class="actions"><button data-account-action="open" data-id="${account.id}" ${busy || otherActive ? 'disabled' : ''}>${active ? '切回 Chrome' : '打开 Chrome 登录'}</button><button class="secondary" data-account-action="detect" data-id="${account.id}" ${busy || !active ? 'disabled' : ''}>检测当前账号</button></div></article>`;
}

function activeWorkspaceAccounts() {
  if (!activeWorkspace) return [];
  const ids = new Set([activeWorkspace.publisherAccountId, activeWorkspace.commerceAccountId].filter(Boolean));
  return accounts.filter((account) => ids.has(account.id));
}

function renderProductMappings() {
  if (!ui['mapping-list']) return;
  ui['mapping-list'].innerHTML = productMappings.length
    ? productMappings.map((item) => `<span>${escapeHtml(item.sourceModel)} → <strong>${escapeHtml(item.searchModel)}</strong></span>`).join('')
    : '<span class="error">映射表尚未填写产品。</span>';
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
    ui['plan-body'].innerHTML = '<tr class="problem-row"><td colspan="15">当前计划缓存文件损坏，已忽略；账号和登录资料没有丢失</td></tr>';
    ui['plan-summary'].textContent = '计划不可用';
    ui['plan-status'].textContent = `${currentPlan.statusDetail}；${(currentPlan.warnings || []).join('；')}`;
    ui['plan-status'].className = 'panel-note error';
    return;
  }
  if (!currentPlan?.items?.length) {
    ui['plan-body'].innerHTML = '<tr><td colspan="15">等待生成计划</td></tr>';
    ui['plan-summary'].textContent = '';
    ui['selection-summary'].textContent = '';
    return;
  }
  const selected = currentPlan.items.filter((item) => item.selected && ['pending','failed','skipped'].includes(item.execution?.state || 'pending'));
  const completed = currentPlan.items.filter((item) => ['verified','id-resolved'].includes(item.execution?.state)).length;
  const uncertain = currentPlan.items.filter((item) => item.execution?.state === 'uncertain').length;
  ui['plan-summary'].textContent = `${currentPlan.date} · ${currentPlan.items.length}条 · ${completed}条已完成`;
  ui['selection-summary'].textContent = `本次将执行 ${selected.length} 条${uncertain ? `；${uncertain}条待人工确认` : ''}`;
  ui['plan-body'].innerHTML = currentPlan.items.map((item) => {
    const state = item.execution?.state || 'pending';
    const locked = ['verified','id-resolved','running','uncertain'].includes(state);
    const statusText = !item.ready ? item.problems.join('；') : (stateLabels[state] || state);
    const uncertainActions = state === 'uncertain'
      ? `<button class="mini" data-plan-confirm="published" data-item-id="${item.itemId}">确认已发布</button><button class="mini secondary" data-plan-confirm="missing" data-item-id="${item.itemId}">确认未发布</button>` : '';
    const commerceText = item.commerce?.required ? `${item.commerce.searchModel || '缺型号映射'} / ${item.commerce.productShortTitle || '缺短标题'} / ${item.commerce.productUrl ? '本批链接已确认' : item.commerce.state === 'needs-confirmation' ? '待人工选链接' : '待现场查询'}` : '不挂车';
    return `<tr class="${item.ready ? '' : 'problem-row'}"><td><input type="checkbox" data-plan-select="${item.itemId}" ${item.selected ? 'checked' : ''} ${locked ? 'disabled' : ''}></td><td><div class="table-actions"><button class="mini" data-plan-edit="${item.itemId}" ${locked ? 'disabled' : ''}>编辑</button>${uncertainActions}</div></td><td>${item.sequence}</td><td title="筛选结果中的相对行：${escapeHtml(item.sourceRelativeRow || item.sourceRow || '—')}">${escapeHtml(item.sourceActualRow || '待重新拉取')}</td><td title="${escapeHtml(item.videoPath)}">${escapeHtml(item.originalMaterialName || basename(item.videoPath))}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.model)}</td><td>${escapeHtml(item.scheduledLocal?.slice(11) || '—')}</td><td>${item.aiGenerated ? '内容由AI生成' : '无需声明'}</td><td title="${escapeHtml(item.body)}">${escapeHtml(item.body || '—')}</td><td title="${escapeHtml((item.tags || []).join('、'))}">${escapeHtml((item.tags || []).join('、') || '—')}</td><td title="${escapeHtml(item.coverPath)}">${escapeHtml(basename(item.coverPath))}</td><td title="${escapeHtml(item.commerce?.productUrl || '')}">${escapeHtml(commerceText)}</td><td class="${item.ready && !['failed','uncertain'].includes(state) ? 'success' : 'error'}" title="${escapeHtml(item.execution?.detail || '')}">${escapeHtml(statusText)}</td><td>${escapeHtml(item.publish?.videoId || '待获取')}</td></tr>`;
  }).join('');
  const warnings = currentPlan.warnings?.length ? `；${currentPlan.warnings.join('；')}` : '';
  ui['plan-status'].textContent = `计划状态：${currentPlan.status}${currentPlan.statusDetail ? `；${currentPlan.statusDetail}` : ''}${warnings}`;
  ui['plan-status'].className = currentPlan.items.every((item) => item.ready) ? 'panel-note success' : 'panel-note error';
}

function openPlanEditor(itemId) {
  const item = currentPlan?.items?.find((candidate) => candidate.itemId === itemId);
  if (!item) return;
  editingItemId = itemId;
  editingCoverPath = item.coverPath || '';
  ui['edit-plan-file'].textContent = `视频文件（不可修改）：${item.originalMaterialName || basename(item.videoPath)}`;
  ui['edit-plan-category'].value = item.category || '';
  ui['edit-plan-model'].value = item.model || '';
  ui['edit-plan-time'].value = String(item.scheduledLocal || '').replace(' ', 'T');
  ui['edit-plan-body'].value = item.body || '';
  ui['edit-plan-tags'].value = (item.tags || []).join('\n');
  ui['edit-plan-cover'].textContent = editingCoverPath || '尚未选择';
  ui['edit-commerce-fields'].hidden = !item.commerce?.required;
  ui['edit-product-short-title'].value = item.commerce?.productShortTitle || '';
  ui['edit-product-link'].innerHTML = (item.commerce?.candidates || []).filter((candidate) => !candidate.abnormal).map((candidate) => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === item.commerce.productLinkId ? 'selected' : ''}>${escapeHtml(candidate.title || candidate.url)} · ￥${candidate.priceCents == null ? '未知' : (candidate.priceCents / 100).toFixed(2)}</option>`).join('');
  ui['edit-plan-status'].textContent = '';
  ui['edit-plan-modal'].hidden = false;
}

function render() {
  ui['accounts-main'].innerHTML = activeWorkspaceAccounts().map(accountCard).join('');
  ui['accounts-test'].innerHTML = accounts.filter((item) => item.role === 'test' && item.platform === testPlatform).map(accountCard).join('');
  const production = accounts.find((item) => item.id === activeWorkspace?.publisherAccountId);
  const test = accounts.find((item) => item.role === 'test' && item.platform === testPlatform);
  const executable = currentPlan?.items?.filter((item) => item.selected
    && item.ready && ['pending','failed','skipped'].includes(item.execution?.state || 'pending')) || [];
  const planReady = executable.length > 0 && currentPlan?.items?.every((item) => !item.selected || item.ready);
  ui['execute-plan'].disabled = busy || !planReady || browserStatus.activeAccountId !== production?.id || production?.lastDetected?.state !== 'logged-in';
  ui['prepare-test'].disabled = busy || browserStatus.activeAccountId !== test?.id || test?.lastDetected?.state !== 'logged-in';
  ui['test-resolve-id'].disabled = busy || browserStatus.activeAccountId !== test?.id || test?.lastDetected?.state !== 'logged-in';
  ui['test-id-tool'].hidden = testPlatform === 'wechat-channels';
  ui['test-platform-badge'].textContent = testPlatform === 'wechat-channels' ? '视频号测试' : '抖音测试';
  ui['create-plan-current-filter'].disabled = busy || !feishuStatus.loggedIn;
  ui['prepare-commerce'].disabled = busy || activeWorkspace?.mode !== 'commerce' || !currentPlan?.items?.length
    || browserStatus.activeAccountId !== production?.id || production?.lastDetected?.state !== 'logged-in';
  for (const id of ['save-sheet','open-feishu','clear-cache']) ui[id].disabled = busy;
  ui['save-preferences'].disabled = true;
  ui['watermark-enabled'].disabled = true;
  ui['guard-seconds'].disabled = true;
  ui['detect-feishu'].disabled = busy || !feishuStatus.open;
  ui['close-feishu'].disabled = busy || !feishuStatus.open;
  ui['close-browser'].disabled = busy || !browserStatus.open;
  ui['settings-close-feishu'].disabled = busy || !feishuStatus.open;
  for (const id of ['select-all','select-none','sync-ids','export-ids','copy-id-table','open-id-records']) ui[id].disabled = busy || !currentPlan?.items?.length;
  ui['pull-estimate'].textContent = estimates.pull || '预计约6–13分钟（按8–20条）';
  ui['publish-estimate'].textContent = estimates.publish || '完成计划后显示';
  ui['workspace-select'].innerHTML = workspaces.map((workspace) => `<option value="${escapeHtml(workspace.id)}" ${workspace.id === activeWorkspace?.id ? 'selected' : ''}>${escapeHtml(workspace.name)}</option>`).join('');
  ui['workspace-badge'].textContent = activeWorkspace?.name || '未选择工作区';
  ui['workspace-platform'].textContent = activeWorkspace?.platform === 'wechat-channels' ? '微信视频号' : activeWorkspace?.mode === 'commerce' ? '抖音商城号' : '抖音主页号';
  ui['commerce-panel'].hidden = activeWorkspace?.mode !== 'commerce';
  ui['open-short-titles'].hidden = activeWorkspace?.mode !== 'commerce';
  ui['sync-ids'].hidden = activeWorkspace?.platform === 'wechat-channels';
  renderProductMappings();
  renderSettingsAccounts();
  renderPlan();
}

async function refresh() {
  const results = await Promise.allSettled([
    window.publisher.listWorkspaces(), window.publisher.listAccounts(), window.publisher.getBrowserStatus(), window.publisher.getSettings(), window.publisher.getFeishuBrowserStatus(), window.publisher.getLibraryPaths(), window.publisher.listProductMappings(), window.publisher.getCurrentPlan(), window.publisher.getDurationEstimates()
  ]);
  if (results[0].status === 'rejected') throw results[0].reason;
  workspaces = results[0].value.items;
  activeWorkspace = results[0].value.active;
  if (results[1].status === 'rejected') throw results[1].reason;
  accounts = results[1].value;
  browserStatus = results[2].status === 'fulfilled' ? results[2].value : { open: false, activeAccountId: null };
  settings = results[3].status === 'fulfilled' ? results[3].value : settings;
  feishuStatus = results[4].status === 'fulfilled' ? results[4].value : { open: false, loggedIn: false };
  libraryPaths = results[5].status === 'fulfilled' ? results[5].value : libraryPaths;
  productMappings = results[6].status === 'fulfilled' ? results[6].value : productMappings;
  currentPlan = results[7].status === 'fulfilled' ? results[7].value : { invalid: true, status: 'invalid', statusDetail: results[7].reason?.message || '当前计划读取失败', items: [] };
  estimates = results[8].status === 'fulfilled' ? results[8].value : estimates;
  const nonAccountErrors = results.slice(1).filter((result) => result.status === 'rejected');
  if (nonAccountErrors.length) setStatus(`账号模块已正常加载；另有${nonAccountErrors.length}个模块初始化失败，请查看对应区域。`, 'error');
  ui['sheet-url'].value = activeWorkspace?.sheetUrl || '';
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
  const editButton = event.target.closest('[data-plan-edit]');
  if (editButton) openPlanEditor(editButton.dataset.planEdit);
  const confirmButton = event.target.closest('[data-plan-confirm]');
  if (confirmButton) {
    const published = confirmButton.dataset.planConfirm === 'published';
    const message = published ? '确认你已在作品管理中找到该视频？确认后不会重复发布。' : '确认作品管理中没有该视频？确认后将允许重新发布。';
    if (confirm(message)) run(() => window.publisher.confirmUncertain(confirmButton.dataset.itemId, published), '人工确认结果已保存。');
  }
});

document.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-plan-select]');
  if (checkbox) run(() => window.publisher.setPlanSelection([checkbox.dataset.planSelect], checkbox.checked), '本次发布选择已更新。');
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

ui['select-workspace'].addEventListener('click', () => {
  const nextId = ui['workspace-select'].value;
  if (nextId === activeWorkspace?.id) return;
  if (!confirm('切换后将使用另一套账号、飞书表格、本地素材库和计划缓存。确认切换吗？')) return;
  run(() => window.publisher.selectWorkspace(nextId), '发布工作区已切换。', ui['workspace-status']);
});
ui['save-sheet'].addEventListener('click', () => run(async () => {
  activeWorkspace = await window.publisher.updateWorkspace(activeWorkspace.id, { sheetUrl: ui['sheet-url'].value });
  ui['settings-status'].textContent = '当前工作区链接已保存';
}, '当前工作区的飞书表格链接已保存。', ui['settings-status']));
ui['prepare-commerce'].addEventListener('click', () => run(async () => {
  ui['commerce-status'].textContent = '正在同一账号的抖店商品管理中逐个现场查询…';
  const result = await window.publisher.prepareCommercePlan();
  currentPlan = result.plan;
  ui['commerce-status'].textContent = `自动确认${result.fetched}条；${result.needsConfirmation}条价格不同需在计划“编辑”中人工选择；查询失败${result.failures.length}条${result.failures.length ? `：${result.failures.join('；')}` : ''}`;
}, '本批商品链接现场查询完成。', ui['commerce-status']));
ui['open-feishu'].addEventListener('click', () => run(() => window.publisher.openFeishuBrowser(), '飞书 Chrome 已打开。登录并看到目标表格后点击检测登录。', ui['settings-status']));
ui['detect-feishu'].addEventListener('click', () => run(async () => { const result = await window.publisher.detectFeishuLogin(); ui['settings-status'].textContent = result.message; }, '飞书登录检测完成。', ui['settings-status']));
ui['close-feishu'].addEventListener('click', () => run(() => window.publisher.closeFeishuBrowser(), '飞书 Chrome 已关闭，登录状态保留。', ui['settings-status']));
ui['settings-close-feishu'].addEventListener('click', () => run(() => window.publisher.closeFeishuBrowser(), '飞书 Chrome 已关闭，登录状态保留。'));
ui['close-browser'].addEventListener('click', () => run(() => window.publisher.closeBrowser(), '当前平台 Chrome 已关闭，登录状态保留。'));

ui['test-platform'].addEventListener('change', () => {
  testPlatform = ui['test-platform'].value === 'wechat-channels' ? 'wechat-channels' : 'douyin';
  ui['test-confirm'].checked = false;
  render();
});

function createPlan() {
  if (!ui['plan-date'].value) { ui['plan-status'].textContent = '请先选择发布日期'; ui['plan-status'].className = 'panel-note error'; return; }
  run(async () => { ui['plan-status'].textContent = '正在使用当前飞书筛选结果拉取…'; currentPlan = await window.publisher.createPlan(ui['plan-date'].value, 'current'); ui['batch-confirm'].checked = false; }, '计划已经生成，请逐行人工检查。', ui['plan-status']);
}
ui['create-plan-current-filter'].addEventListener('click', createPlan);
ui['select-all'].addEventListener('click', () => {
  const ids = currentPlan?.items?.filter((item) => item.ready && !['verified','id-resolved','running','uncertain'].includes(item.execution?.state)).map((item) => item.itemId) || [];
  run(() => window.publisher.setPlanSelection(ids, true), `已选中${ids.length}条可发布项。`);
});
ui['select-none'].addEventListener('click', () => {
  const ids = currentPlan?.items?.filter((item) => !['verified','id-resolved','running','uncertain'].includes(item.execution?.state)).map((item) => item.itemId) || [];
  run(() => window.publisher.setPlanSelection(ids, false), '已取消本次发布选择。');
});
ui['export-ids'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.exportPlanIds();
  ui['batch-status'].textContent = `ID记录已更新：${result.resolved}/${result.total}条已获取；TXT：${result.filePath}；表格：${result.csvPath}`;
}, 'ID记录已更新。', ui['batch-status']));
ui['copy-id-table'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.copyPlanIdTable();
  ui['batch-status'].textContent = `已按飞书行号复制${result.copyCount}个发布ID，每行一个纯数字。`;
}, '发布ID已复制。', ui['batch-status']));
ui['sync-ids'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.syncPlanIds();
  ui['batch-status'].textContent = `本次获取${result.matches.length}个ID，仍有${result.unresolved}条待获取。`;
}, '视频ID同步完成。', ui['batch-status']));
ui['open-id-records'].addEventListener('click', () => run(() => window.publisher.openIdRecords(), '已打开发布ID记录目录。'));
ui['execute-plan'].addEventListener('click', () => {
  if (!ui['batch-confirm'].checked) { ui['batch-status'].textContent = '请先勾选人工检查和批量发布授权'; ui['batch-status'].className = 'error'; return; }
  const selectedCount = currentPlan?.items?.filter((item) => item.selected && item.ready && ['pending','failed','skipped'].includes(item.execution?.state || 'pending')).length || 0;
  if (!confirm(`即将在正式账号实际发布 ${selectedCount} 条未完成视频。已核验项不会重复执行，确认继续吗？`)) return;
  run(async () => { ui['batch-status'].textContent = '正在逐条发布，请勿操作设备…'; const result = await window.publisher.executePlan(); ui['batch-status'].textContent = `全部${result.count}条已提交。日志：${result.reportPath}`; ui['batch-status'].className = 'success'; }, '批量发布完成，请前往作品管理核对。', ui['batch-status']);
});
ui['edit-plan-choose-cover'].addEventListener('click', async () => {
  const value = await window.publisher.choosePlanCover();
  if (value) { editingCoverPath = value; ui['edit-plan-cover'].textContent = value; }
});
ui['save-plan-item'].addEventListener('click', () => {
  if (!editingItemId) return;
  run(async () => {
    currentPlan = await window.publisher.updatePlanItem(editingItemId, {
      category: ui['edit-plan-category'].value,
      model: ui['edit-plan-model'].value,
      scheduledLocal: ui['edit-plan-time'].value,
      body: ui['edit-plan-body'].value,
      tags: ui['edit-plan-tags'].value,
      coverPath: editingCoverPath,
      productShortTitle: ui['edit-commerce-fields'].hidden ? undefined : ui['edit-product-short-title'].value,
      productLinkId: ui['edit-commerce-fields'].hidden ? undefined : ui['edit-product-link'].value
    });
    closeModal('edit-plan-modal');
    editingItemId = null;
  }, '计划项已保存。', ui['edit-plan-status']);
});
ui['clear-cache'].addEventListener('click', () => { if (!confirm('只删除下载缓存和当前计划，保留素材库与发布日志。确认清理吗？')) return; run(async () => { const result = await window.publisher.clearCache(); currentPlan = null; ui['batch-confirm'].checked = false; ui['plan-status'].textContent = `缓存已清理，共移除${result.removed}项。`; }, '下载缓存已经清理，发布日志保持不变。', ui['plan-status']); });

ui['choose-video'].addEventListener('click', async () => { const value = await window.publisher.chooseVideo(); if (value) { videoPath = value; ui['video-path'].textContent = value; } });
ui['choose-cover'].addEventListener('click', async () => { const value = await window.publisher.chooseCover(); if (value) { coverPath = value; ui['cover-path'].textContent = value; } });
ui['test-body'].addEventListener('input', () => { const count = (ui['test-body'].value.match(/[\u3400-\u9fff]/g) || []).length; ui['body-count'].textContent = `${count} 个汉字，仅供参考`; ui['body-count'].className = ''; });
ui['prepare-test'].addEventListener('click', () => { if (!ui['test-confirm'].checked) { ui['prepare-status'].textContent = '请先确认测试账号并授权实际发布'; ui['prepare-status'].className = 'error'; return; } if (!confirm(`本次会在${testPlatform === 'wechat-channels' ? '视频号' : '抖音'}测试账号实际点击一次发布，确认继续吗？`)) return; run(async () => { const result = await window.publisher.submitTestPublish({ platform: testPlatform, videoPath, coverPath, body: ui['test-body'].value, tags: ui['test-tags'].value, scheduledAt: ui['scheduled-at'].value }); ui['prepare-status'].textContent = `已提交。报告：${result.reportPath}`; ui['prepare-status'].className = 'success'; }, '测试视频已提交，请立即人工检查。', ui['prepare-status']); });
ui['test-resolve-id'].addEventListener('click', () => run(async () => {
  const result = await window.publisher.resolveTestPublishId({
    body: ui['test-body'].value,
    scheduledAt: ui['scheduled-at'].value
  });
  ui['test-id-status'].textContent = `获取成功：${result.videoId}；${result.videoUrl}`;
  ui['test-id-status'].className = 'success';
}, '小号视频ID获取成功。', ui['test-id-status']));

ui['save-preferences'].addEventListener('click', () => run(async () => { settings = await window.publisher.saveSettings({ ...settings, watermarkEnabled: ui['watermark-enabled'].checked, guardSeconds: Number(ui['guard-seconds'].value) }); ui['preferences-status'].textContent = '设置已保存'; ui['preferences-status'].className = 'success'; }, '防误操设置已保存。', ui['preferences-status']));
ui['finish-guide'].addEventListener('click', () => run(async () => { settings = await window.publisher.saveSettings({ ...settings, guideCompleted: true }); showPage('main'); }, '准备状态已记录，可以开始使用主工作台。'));
window.publisher.onAutomationTakeover((kind) => { setStatus(kind === 'pull' ? '已请求人工接管，素材拉取将在安全检查点停止。' : '已请求人工接管，发布将在安全检查点停止。', 'error'); });
window.publisher.onPlanItemState(() => {
  window.publisher.getCurrentPlan().then((plan) => { currentPlan = plan; renderPlan(); }).catch(() => {});
});

const tomorrow = new Date(Date.now() + 86400000);
ui['plan-date'].value = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
refresh().then(() => { showPage('main'); setStatus('本地配置已就绪。'); }).catch((error) => setStatus(error.message, 'error'));
