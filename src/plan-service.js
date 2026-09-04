const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildPlan, normalizeDate } = require('./plan-engine');
const { normalizeTags } = require('./test-publish');
const { resolveCandidateSet } = require('./product-catalog');

const EXECUTABLE_STATES = new Set(['pending', 'failed', 'skipped']);
const LOCKED_STATES = new Set(['verified', 'id-resolved']);

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function defaultExecution() {
  return { state: 'pending', detail: '', attempts: 0, updatedAt: null, evidence: [] };
}

function validateEditableItem(item) {
  const retained = (item.problems || []).filter((problem) => (
    /^\u7d20\u6750\u4e0b\u8f7d\u5931\u8d25\uff1a/.test(problem)
    || problem === '\u7d20\u6750\u94fe\u63a5'
  ));
  if (!item.videoPath || !fs.existsSync(item.videoPath)) retained.push('\u89c6\u9891\u6587\u4ef6\u4e0d\u5b58\u5728');
  if (!String(item.category || '').trim()) retained.push('\u4ea7\u54c1\u7c7b\u76ee\u4e3a\u7a7a');
  if (!String(item.model || '').trim()) retained.push('\u4ea7\u54c1\u578b\u53f7\u4e3a\u7a7a');
  if (!item.coverPath || !fs.existsSync(item.coverPath)) retained.push('\u5c01\u9762\u6587\u4ef6\u4e0d\u5b58\u5728');
  if (!Array.isArray(item.tags) || !item.tags.length) retained.push('Tag\u4e3a\u7a7a');
  if (item.commerce?.required) {
    if (!String(item.commerce.productShortTitle || '').trim()) retained.push('\u5546\u54c1\u77ed\u6807\u9898\u4e3a\u7a7a');
    if (!String(item.commerce.productUrl || '').trim()) retained.push('\u5546\u54c1\u94fe\u63a5\u672a\u786e\u8ba4');
  }
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(item.scheduledLocal || ''))) retained.push('\u53d1\u5e03\u65f6\u95f4\u683c\u5f0f\u4e0d\u6b63\u786e');
  item.problems = [...new Set(retained)];
  item.ready = item.problems.length === 0;
  return item;
}

function upgradeItem(item, index) {
  return {
    ...item,
    aiGenerated: item.aiGenerated === true,
    itemId: item.itemId || crypto.randomUUID(),
    sequence: index + 1,
    selected: item.selected !== false,
    sourceRelativeRow: Number(item.sourceRelativeRow || item.sourceRow || index + 2),
    sourceActualRow: Number(item.sourceActualRow || item.actualSourceRow || 0) || null,
    actualMaterialCell: item.actualMaterialCell || '',
    originalMaterialName: item.originalMaterialName || item.materialText || path.basename(item.videoPath || ''),
    execution: { ...defaultExecution(), ...(item.execution || {}) },
    publish: {
      internalId: '', videoId: '', videoUrl: '', idState: 'pending', matchedAt: null,
      ...(item.publish || {})
    }
  };
}

function upgradePlan(plan) {
  if (!plan || plan.invalid) return plan;
  return { ...plan, schemaVersion: 2, items: (plan.items || []).map(upgradeItem) };
}

class PlanService {
  constructor(configStore, libraryStore, feishuService, options = {}) {
    this.configStore = configStore;
    this.libraryStore = libraryStore;
    this.feishuService = feishuService;
    this.workspace = options.workspace || null;
    this.productMappingStore = options.productMappingStore || null;
    this.planPath = path.join(libraryStore.cacheRoot, 'current-plan.json');
  }

  settings() {
    if (!this.workspace) return this.configStore.settings();
    return {
      sheetUrl: this.workspace.sheetUrl,
      columns: this.workspace.columns
    };
  }

  updateWorkspace(workspace) {
    if (!workspace || workspace.id !== this.workspace?.id) {
      throw new Error('不能把其他工作区配置同步到当前发布计划服务');
    }
    this.workspace = workspace;
    return this.settings();
  }

  async create(targetDate, options = {}) {
    const date = normalizeDate(targetDate);
    if (!date || date !== targetDate) throw new Error('请选择有效的发布日期');
    const settings = this.settings();
    if (!settings.sheetUrl) throw new Error('\u8bf7\u5148\u4e3a\u5f53\u524d\u5de5\u4f5c\u533a\u914d\u7f6e\u98de\u4e66\u7535\u5b50\u8868\u683c\u94fe\u63a5');
    const filterMode = options.filterMode || 'auto';
    const result = await this.feishuService.rowsForDate(settings, date, { filterMode });
    const { rows, allowColumnExists } = result;
    if (!rows.length) throw new Error(`【${date}】没有找到允许发布的视频`);
    if (rows.length > 44) throw new Error(`【${date}】共有${rows.length}条视频，超过单日44条上限`);
    const ordered = buildPlan(rows, date, { lane: this.workspace?.mode === 'commerce' ? 5 : 0 });
    const items = [];
    for (let index = 0; index < ordered.length; index += 1) {
      this.feishuService.browserManager?.assertNotCancelled?.();
      const item = ordered[index];
      let videoPath = null;
      let fileHash = '';
      try {
        videoPath = await this.feishuService.downloadMaterial(item, this.libraryStore.cacheRoot);
        fileHash = await hashFile(videoPath);
      } catch (error) {
        throw new Error(`飞书第${item.sourceRow}行素材获取失败：${error.message}`);
      }
      const library = this.libraryStore.match(item, index);
      const problems = [...item.sourceMissing, ...library.missing];
      let commerce = null;
      if (this.workspace?.commerceRequired) {
        const mapping = this.productMappingStore?.resolve(item.model) || {
          state: 'missing', reason: '\u4ea7\u54c1\u578b\u53f7\u6620\u5c04\u8868\u672a\u521d\u59cb\u5316'
        };
        commerce = {
          required: true,
          state: mapping.state === 'ready' ? 'pending-live-search' : mapping.state,
          selectionMode: null,
          searchModel: mapping.searchModel || '',
          productShortTitle: library.productShortTitle,
          productUrl: '', productLinkId: null, externalProductId: '', productTitle: '', candidates: [],
          fetchedAt: null
        };
        if (!library.productShortTitle) problems.push('\u5546\u54c1\u77ed\u6807\u9898');
        if (mapping.state !== 'ready') problems.push(`\u5546\u54c1\u578b\u53f7\u6620\u5c04\uff1a${mapping.reason}`);
        else problems.push('\u5546\u54c1\u94fe\u63a5\u5f85\u73b0\u573a\u83b7\u53d6');
      }
      const originalMaterialName = item.materialText || path.basename(videoPath || '');
      items.push(upgradeItem({
        ...item,
        itemId: crypto.randomUUID(),
        sourceRelativeRow: item.sourceRow,
        sourceActualRow: item.actualSourceRow || null,
        actualMaterialCell: item.actualMaterialCell || '',
        originalMaterialName,
        sourceKey: crypto.createHash('sha256').update([
          settings.sheetUrl, date, item.actualSourceRow || item.sourceRow, originalMaterialName, fileHash
        ].join('|')).digest('hex'),
        fileHash,
        videoPath,
        body: library.body,
        tags: library.tags,
        coverPath: library.coverPath,
        commerce,
        problems,
        ready: problems.length === 0,
        selected: true
      }, index));
    }
    return this.save({
      schemaVersion: 2,
      id: crypto.randomUUID(),
      date,
      createdAt: new Date().toISOString(),
      source: {
        sheetUrl: settings.sheetUrl,
        mode: 'browser-session',
        filterMode: result.filterMode || filterMode,
        allowColumnExists
      },
      workspace: this.workspace ? {
        id: this.workspace.id,
        name: this.workspace.name,
        platform: this.workspace.platform,
        mode: this.workspace.mode,
        publisherAccountId: this.workspace.publisherAccountId,
        commerceAccountId: this.workspace.commerceAccountId || null
      } : null,
      warnings: [],
      status: 'draft',
      statusDetail: '',
      items
    });
  }

  save(plan) {
    const normalized = upgradePlan(plan);
    normalized.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.planPath), { recursive: true });
    const temporary = `${this.planPath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.planPath);
    return normalized;
  }

  current() {
    if (!fs.existsSync(this.planPath)) return null;
    try {
      return upgradePlan(JSON.parse(fs.readFileSync(this.planPath, 'utf8')));
    } catch (error) {
      return {
        invalid: true,
        status: 'invalid',
        statusDetail: `当前计划缓存文件格式损坏，已安全忽略：${error.message}`,
        items: [],
        warnings: ['账号、登录资料和本地素材库不受影响。请重新生成计划。']
      };
    }
  }

  requirePlan() {
    const plan = this.current();
    if (!plan || plan.invalid) throw new Error('当前没有有效的发布计划，请重新生成');
    return plan;
  }

  updateItem(itemId, input = {}) {
    const plan = this.requirePlan();
    const item = plan.items.find((candidate) => candidate.itemId === String(itemId));
    if (!item) throw new Error('没有找到要编辑的计划项目');
    if (LOCKED_STATES.has(item.execution.state)) throw new Error('已经后台核验成功的视频不能直接修改');
    const previousModel = String(item.model || '');
    if (Object.hasOwn(input, 'body')) item.body = String(input.body || '').trim();
    if (Object.hasOwn(input, 'category')) item.category = String(input.category || '').trim();
    if (Object.hasOwn(input, 'model')) item.model = String(input.model || '').trim();
    if (Object.hasOwn(input, 'tags')) item.tags = normalizeTags(input.tags);
    if (Object.hasOwn(input, 'coverPath')) item.coverPath = String(input.coverPath || '').trim() || null;
    if (item.commerce?.required && item.model !== previousModel) {
      const library = this.libraryStore.match(item, Math.max(0, Number(item.sequence || 1) - 1));
      const mapping = this.productMappingStore?.resolve(item.model) || { state: 'missing' };
      item.commerce = {
        required: true,
        state: mapping.state === 'ready' ? 'pending-live-search' : mapping.state,
        selectionMode: null,
        searchModel: mapping.searchModel || '',
        productShortTitle: library.productShortTitle,
        productUrl: '', productLinkId: null, externalProductId: '', productTitle: '', candidates: [], fetchedAt: null
      };
    }
    if (item.commerce?.required && Object.hasOwn(input, 'productShortTitle') && input.productShortTitle !== undefined) {
      item.commerce.productShortTitle = String(input.productShortTitle || '').trim().slice(0, 10);
    }
    if (item.commerce?.required && Object.hasOwn(input, 'productLinkId') && input.productLinkId !== undefined) {
      const candidate = (item.commerce.candidates || []).find((value) => value.id === String(input.productLinkId));
      if (!candidate) throw new Error('\u6ca1\u6709\u627e\u5230\u9009\u4e2d\u7684\u5546\u54c1\u94fe\u63a5');
      item.commerce.productLinkId = candidate.id;
      item.commerce.productUrl = candidate.url;
      item.commerce.productTitle = candidate.title || '';
      item.commerce.state = 'ready';
      item.commerce.selectionMode = 'manual-plan';
    }
    if (Object.hasOwn(input, 'scheduledLocal')) {
      const value = String(input.scheduledLocal || '').trim().replace('T', ' ');
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) throw new Error('定时发布时间格式不正确');
      item.scheduledLocal = value;
    }
    if (Object.hasOwn(input, 'selected')) item.selected = Boolean(input.selected);
    validateEditableItem(item);
    const duplicate = plan.items.find((candidate) => candidate.itemId !== item.itemId
      && candidate.selected && item.selected && candidate.scheduledLocal === item.scheduledLocal
      && !LOCKED_STATES.has(candidate.execution?.state));
    if (duplicate) throw new Error(`\u53d1\u5e03\u65f6\u95f4${item.scheduledLocal}\u4e0e\u7b2c${duplicate.sequence}\u6761\u91cd\u590d`);
    return this.save(plan);
  }

  applyCommerceCandidates(itemId, candidates) {
    const plan = this.requirePlan();
    const item = plan.items.find((candidate) => candidate.itemId === String(itemId));
    if (!item?.commerce?.required) throw new Error('没有找到对应的商城计划项');
    const resolution = resolveCandidateSet(candidates);
    item.commerce.candidates = resolution.candidates.map((candidate) => ({
      id: candidate.id, url: candidate.url, title: candidate.title,
      externalProductId: candidate.externalProductId, priceCents: candidate.priceCents,
      stock: candidate.stock, sales: candidate.sales, abnormal: candidate.abnormal
    }));
    item.commerce.state = resolution.state;
    item.commerce.selectionMode = resolution.selectionMode || null;
    item.commerce.fetchedAt = new Date().toISOString();
    item.commerce.productUrl = resolution.candidate?.url || '';
    item.commerce.productLinkId = resolution.candidate?.id || null;
    item.commerce.externalProductId = resolution.candidate?.externalProductId || '';
    item.commerce.productTitle = resolution.candidate?.title || '';
    item.problems = (item.problems || []).filter((problem) => !/^\u5546\u54c1\u94fe\u63a5/.test(problem));
    if (resolution.state === 'needs-confirmation') item.problems.push('\u5546\u54c1\u94fe\u63a5\u9700\u8981\u4eba\u5de5\u9009\u62e9');
    if (resolution.state === 'missing') item.problems.push(`\u5546\u54c1\u94fe\u63a5\uff1a${resolution.reason}`);
    validateEditableItem(item);
    return this.save(plan);
  }

  setSelections(itemIds, selected) {
    const plan = this.requirePlan();
    const ids = new Set((itemIds || []).map(String));
    for (const item of plan.items) {
      if (!ids.has(item.itemId) || LOCKED_STATES.has(item.execution.state)) continue;
      item.selected = Boolean(selected);
      if (!selected && item.execution.state === 'pending') item.execution.state = 'skipped';
      if (selected && item.execution.state === 'skipped') item.execution.state = 'pending';
    }
    return this.save(plan);
  }

  executableItems() {
    return this.requirePlan().items.filter((item) => (
      item.selected && item.ready && EXECUTABLE_STATES.has(item.execution.state)
    ));
  }

  markItem(itemId, state, detail = '', evidence = null) {
    const plan = this.requirePlan();
    const item = plan.items.find((candidate) => candidate.itemId === String(itemId));
    if (!item) throw new Error('没有找到要更新状态的计划项目');
    item.execution = { ...defaultExecution(), ...item.execution };
    item.execution.state = state;
    item.execution.detail = String(detail || '');
    item.execution.updatedAt = new Date().toISOString();
    if (state === 'running') item.execution.attempts += 1;
    if (evidence) item.execution.evidence.push({ at: new Date().toISOString(), ...evidence });
    if (LOCKED_STATES.has(state)) item.selected = false;
    return this.save(plan);
  }

  confirmUncertain(itemId, published) {
    return this.markItem(itemId, published ? 'verified' : 'failed', published
      ? '人工已在作品管理确认存在'
      : '人工已确认作品管理中不存在，允许重新发布', { kind: 'human-confirmation' });
  }

  updatePublishIdentity(itemId, identity = {}) {
    const plan = this.requirePlan();
    const item = plan.items.find((candidate) => candidate.itemId === String(itemId));
    if (!item) throw new Error('没有找到要写入视频ID的计划项目');
    item.publish = { ...item.publish, ...identity, matchedAt: new Date().toISOString() };
    if (item.publish.videoId) {
      item.publish.idState = 'resolved';
      item.execution.state = 'id-resolved';
      item.selected = false;
    }
    return this.save(plan);
  }

  updateStatus(status, detail = '') {
    const plan = this.requirePlan();
    plan.status = status;
    plan.statusDetail = detail;
    return this.save(plan);
  }

  exportIdRecords() {
    const plan = this.requirePlan();
    fs.mkdirSync(this.libraryStore.recordsRoot, { recursive: true });
    const filePath = path.join(this.libraryStore.recordsRoot, `${plan.date}-${plan.id}.txt`);
    const csvPath = path.join(this.libraryStore.recordsRoot, `${plan.date}-${plan.id}.csv`);
    const orderedItems = [...plan.items].sort((left, right) => {
      const leftRow = Number(left.sourceActualRow || left.sourceRelativeRow || left.sourceRow) || Number.MAX_SAFE_INTEGER;
      const rightRow = Number(right.sourceActualRow || right.sourceRelativeRow || right.sourceRow) || Number.MAX_SAFE_INTEGER;
      return leftRow - rightRow || Number(left.sequence || 0) - Number(right.sequence || 0);
    });
    const recordRows = orderedItems.map((item) => [
      item.sourceActualRow || item.sourceRelativeRow || item.sourceRow || '',
      item.originalMaterialName || path.basename(item.videoPath || ''),
      item.publish?.videoId || '',
      item.publish?.videoUrl || '',
      item.publish?.idState === 'resolved' ? '\u5df2\u83b7\u53d6' : '\u5f85\u83b7\u53d6'
    ].map((value) => String(value).replace(/[\t\r\n]+/g, ' ')));
    const headers = ['\u6240\u5728\u884c', '\u89c6\u9891\u540d\u79f0', '\u53d1\u5e03ID', '\u89c6\u9891\u7f51\u5740', '\u83b7\u53d6\u72b6\u6001'];
    const lines = [
      headers.join('\t'),
      ...recordRows.map((row) => row.join('\t'))
    ];
    const escapeCsv = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const csvLines = [headers, ...recordRows].map((row) => row.map(escapeCsv).join(','));
    const clipboardText = `${lines.join('\r\n')}\r\n`;
    const resolvedIds = orderedItems
      .map((item) => String(item.publish?.videoId || '').trim())
      .filter((videoId) => /^\d+$/.test(videoId));
    const idClipboardText = resolvedIds.join('\r\n');
    fs.writeFileSync(filePath, `\uFEFF${clipboardText}`, 'utf8');
    fs.writeFileSync(csvPath, `\uFEFF${csvLines.join('\r\n')}\r\n`, 'utf8');
    return {
      filePath, csvPath, clipboardText, idClipboardText, copyCount: resolvedIds.length,
      resolved: plan.items.filter((item) => item.publish?.videoId).length,
      total: plan.items.length
    };
  }
}

module.exports = { PlanService, EXECUTABLE_STATES, LOCKED_STATES, upgradePlan, hashFile, validateEditableItem };
