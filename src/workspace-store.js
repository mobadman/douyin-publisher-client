const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_COLUMNS = {
  material: '素材链接',
  category: '产品类目',
  model: '产品型号',
  publishDate: '发布时间',
  allowPublish: '允许发布',
  aiGenerated: 'AI标识'
};

const DEFAULT_WORKSPACES = [
  {
    id: 'douyin-standard',
    name: '抖音主页号',
    platform: 'douyin',
    mode: 'standard',
    publisherAccountId: 'production-account',
    commerceAccountId: null,
    sheetUrl: '',
    commerceRequired: false,
    enabled: true
  },
  {
    id: 'douyin-commerce',
    name: '抖音商城号',
    platform: 'douyin',
    mode: 'commerce',
    publisherAccountId: 'production-account',
    commerceAccountId: null,
    sheetUrl: '',
    commerceRequired: true,
    enabled: true
  },
  {
    id: 'wechat-channels',
    name: '微信视频号',
    platform: 'wechat-channels',
    mode: 'standard',
    publisherAccountId: 'wechat-publisher',
    commerceAccountId: null,
    sheetUrl: '',
    commerceRequired: false,
    enabled: true
  }
];

function normalizeWorkspace(workspace) {
  const normalized = workspace.id === 'douyin-commerce'
    ? { ...workspace, publisherAccountId: 'production-account', commerceAccountId: null }
    : workspace;
  return {
    ...normalized,
    name: String(normalized.name || '').trim(),
    sheetUrl: String(normalized.sheetUrl || '').trim(),
    commerceRequired: normalized.mode === 'commerce' || normalized.commerceRequired === true,
    columns: { ...DEFAULT_COLUMNS, ...(normalized.columns || {}) }
  };
}

function validateFeishuUrl(value) {
  const text = String(value || '').trim();
  let url;
  try { url = new URL(text); } catch { throw new Error('飞书电子表格链接格式不正确，请重新从浏览器地址栏复制完整链接'); }
  const officialHost = url.hostname === 'feishu.cn' || url.hostname.endsWith('.feishu.cn');
  if (url.protocol !== 'https:' || !officialHost) {
    throw new Error('请填写飞书官方域名下以 https:// 开头的飞书电子表格或知识库链接');
  }
  return url.toString();
}

class WorkspaceStore {
  constructor(dataRoot) {
    this.filePath = path.join(dataRoot, 'workspaces.json');
    this.selectionPath = path.join(dataRoot, 'active-workspace.json');
  }

  initialize(legacySheetUrl = '') {
    if (!fs.existsSync(this.filePath)) {
      const createdAt = new Date().toISOString();
      const workspaces = DEFAULT_WORKSPACES.map((workspace, index) => normalizeWorkspace({
        ...workspace,
        sheetUrl: index === 0 ? String(legacySheetUrl || '') : '',
        createdAt
      }));
      this.write(workspaces);
    }
    const workspaces = this.list();
    if (!fs.existsSync(this.selectionPath) || !workspaces.some((item) => item.id === this.activeId())) {
      this.select(workspaces[0].id);
    }
    return workspaces;
  }

  read() {
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('工作区配置格式不正确');
    return parsed.map(normalizeWorkspace);
  }

  write(workspaces) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(workspaces.map(normalizeWorkspace), null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }

  list() { return this.read(); }

  get(id) {
    const workspace = this.read().find((item) => item.id === String(id));
    if (!workspace) throw new Error('没有找到这个发布工作区');
    return workspace;
  }

  update(id, input = {}) {
    const workspaces = this.read();
    const index = workspaces.findIndex((item) => item.id === String(id));
    if (index < 0) throw new Error('没有找到这个发布工作区');
    const next = normalizeWorkspace({
      ...workspaces[index],
      name: Object.hasOwn(input, 'name') ? input.name : workspaces[index].name,
      sheetUrl: Object.hasOwn(input, 'sheetUrl') ? input.sheetUrl : workspaces[index].sheetUrl,
      columns: Object.hasOwn(input, 'columns') ? input.columns : workspaces[index].columns,
      updatedAt: new Date().toISOString()
    });
    if (!next.name) throw new Error('工作区名称不能为空');
    if (next.sheetUrl) next.sheetUrl = validateFeishuUrl(next.sheetUrl);
    workspaces[index] = next;
    this.write(workspaces);
    return next;
  }

  activeId() {
    try { return String(JSON.parse(fs.readFileSync(this.selectionPath, 'utf8')).workspaceId || ''); }
    catch { return ''; }
  }

  active() { return this.get(this.activeId()); }

  select(id) {
    const workspace = this.get(id);
    const temporary = `${this.selectionPath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ workspaceId: workspace.id }, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.selectionPath);
    return workspace;
  }
}

module.exports = { WorkspaceStore, DEFAULT_WORKSPACES, DEFAULT_COLUMNS, normalizeWorkspace, validateFeishuUrl };
