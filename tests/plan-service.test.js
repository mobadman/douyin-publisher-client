const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PlanService } = require('../src/plan-service');

test('损坏的当前计划不会阻断账号等其他模块初始化', () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-plan-'));
  fs.writeFileSync(path.join(cacheRoot, 'current-plan.json'), '{"tags":[美的官方旗舰店]}', 'utf8');
  const service = new PlanService({ settings: () => ({}) }, { cacheRoot }, {});
  const plan = service.current();
  assert.equal(plan.invalid, true);
  assert.equal(plan.status, 'invalid');
  assert.deepEqual(plan.items, []);
  assert.match(plan.statusDetail, /格式损坏/);
});

test('保存当前工作区链接后计划服务立即读取新链接', () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-link-sync-'));
  const workspace = { id: 'douyin-standard', sheetUrl: '', columns: { material: '素材链接' } };
  const service = new PlanService({ settings: () => ({}) }, { cacheRoot }, {}, { workspace });
  service.updateWorkspace({
    ...workspace,
    sheetUrl: 'https://team.feishu.cn/wiki/example?sheet=mlxXMF'
  });
  assert.equal(service.settings().sheetUrl, 'https://team.feishu.cn/wiki/example?sheet=mlxXMF');
});

test('计划项勾选、状态持久化和ID导出互不影响', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-plan-v2-'));
  const cacheRoot = path.join(root, '下载缓存');
  const recordsRoot = path.join(root, '发布ID记录');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const videoPath = path.join(cacheRoot, 'a.mp4');
  const videoPath2 = path.join(cacheRoot, 'b.mp4');
  const coverPath = path.join(root, 'a.jpg');
  fs.writeFileSync(videoPath, 'video');
  fs.writeFileSync(videoPath2, 'video');
  fs.writeFileSync(coverPath, 'cover');
  const service = new PlanService({ settings: () => ({}) }, { cacheRoot, recordsRoot }, {});
  service.save({ id: 'p1', date: '2026-08-25', status: 'draft', items: [{
    itemId: 'i2', sourceRow: 18, sourceActualRow: 1800, originalMaterialName: '后行素材.mp4', videoPath: videoPath2, coverPath,
    body: '文案', tags: ['Tag'], scheduledLocal: '2026-08-25 19:30', ready: true, selected: true, problems: []
  }, {
    itemId: 'i1', sourceRow: 12, sourceActualRow: 1737, originalMaterialName: '原素材.mp4', videoPath, coverPath,
    body: '文案', tags: ['Tag'], scheduledLocal: '2026-08-25 19:00', ready: true, selected: true, problems: []
  }] });
  service.setSelections(['i1'], false);
  assert.equal(service.current().items.find((item) => item.itemId === 'i1').execution.state, 'skipped');
  service.setSelections(['i1'], true);
  service.markItem('i1', 'verified', '作品管理已核验');
  service.updatePublishIdentity('i1', { videoId: '7676796249760189746', videoUrl: 'https://www.douyin.com/video/7676796249760189746' });
  service.updatePublishIdentity('i2', { videoId: '8888888888888888888', videoUrl: 'https://www.douyin.com/video/8888888888888888888' });
  const exported = service.exportIdRecords();
  const text = fs.readFileSync(exported.filePath, 'utf8');
  assert.match(text, /1737\t原素材\.mp4\t7676796249760189746/);
  assert.ok(text.indexOf('1737\t原素材.mp4') < text.indexOf('1800\t后行素材.mp4'));
  const csv = fs.readFileSync(exported.csvPath, 'utf8');
  assert.match(csv, /"所在行","视频名称","发布ID","视频网址","获取状态"/);
  assert.ok(csv.indexOf('"1737","原素材.mp4"') < csv.indexOf('"1800","后行素材.mp4"'));
  assert.ok(exported.clipboardText.indexOf('1737\t原素材.mp4') < exported.clipboardText.indexOf('1800\t后行素材.mp4'));
  assert.equal(exported.idClipboardText, '7676796249760189746\r\n8888888888888888888');
  assert.doesNotMatch(exported.idClipboardText, /发布ID|视频名称|\t/);
  assert.equal(service.current().items.find((item) => item.itemId === 'i1').selected, false);
});

test('商城计划固定工作区、商品短标题和人工确认后的商品链接', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-plan-'));
  const cacheRoot = path.join(root, '下载缓存');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const videoPath = path.join(cacheRoot, '商品视频.mp4');
  fs.writeFileSync(videoPath, 'video');
  const workspace = {
    id: 'douyin-commerce', name: '抖音商城号', platform: 'douyin', mode: 'commerce',
    publisherAccountId: 'production-account', commerceAccountId: null, commerceRequired: true,
    sheetUrl: 'https://team.feishu.cn/sheets/commerce', columns: {}
  };
  const libraryStore = {
    cacheRoot,
    match: () => ({ body: '商品文案', tags: ['商品'], coverPath: path.join(root, 'cover.jpg'), productShortTitle: 'G23微蒸烤', missing: [] })
  };
  fs.writeFileSync(libraryStore.match().coverPath, 'cover');
  const feishuService = {
    rowsForDate: async () => ({ rows: [{ sourceRow: 14, actualSourceRow: 1737, materialText: '商品视频.mp4', category: '微蒸烤', model: 'G23', sourceMissing: [] }], allowColumnExists: false }),
    downloadMaterial: async () => videoPath
  };
  const productMappingStore = { resolve: () => ({ state: 'ready', searchModel: 'G23-REAL' }) };
  const service = new PlanService({ settings: () => ({}) }, libraryStore, feishuService, { workspace, productMappingStore });
  let plan = await service.create('2026-08-27');
  assert.equal(plan.workspace.id, 'douyin-commerce');
  assert.equal(plan.workspace.publisherAccountId, 'production-account');
  assert.equal(plan.items[0].commerce.productShortTitle, 'G23微蒸烤');
  assert.equal(plan.items[0].commerce.searchModel, 'G23-REAL');
  assert.equal(plan.items[0].commerce.productLinkId, null);
  assert.equal(plan.items[0].ready, false);
  plan = service.applyCommerceCandidates(plan.items[0].itemId, [
    { id: 'link-a', url: 'https://haohuo.jinritemai.com/ecommerce/trade/detail?id=1', title: 'G23商品', priceCents: 209900 }
  ]);
  assert.equal(plan.items[0].commerce.productLinkId, 'link-a');
  assert.equal(plan.items[0].ready, true);
});
