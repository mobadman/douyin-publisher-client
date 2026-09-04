const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceStore } = require('../src/workspace-store');

test('初始化三个彼此独立的发布工作区', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'short-video-workspace-'));
  const store = new WorkspaceStore(root);
  const workspaces = store.initialize('https://example.feishu.cn/sheets/legacy');
  assert.deepEqual(workspaces.map((item) => item.id), [
    'douyin-standard', 'douyin-commerce', 'wechat-channels'
  ]);
  assert.equal(workspaces[0].sheetUrl, 'https://example.feishu.cn/sheets/legacy');
  assert.equal(workspaces[1].sheetUrl, '');
  assert.equal(workspaces[0].publisherAccountId, workspaces[1].publisherAccountId);
  assert.equal(store.active().id, 'douyin-standard');
});

test('飞书知识库中的电子表格链接也允许保存', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'short-video-workspace-'));
  const store = new WorkspaceStore(root);
  store.initialize();
  const saved = store.update('wechat-channels', { sheetUrl: 'https://team.feishu.cn/wiki/abcdef?sheet=sheet01' });
  assert.match(saved.sheetUrl, /^https:\/\/team\.feishu\.cn\/wiki\//);
});

test('切换工作区不会串改其他工作区的飞书链接', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'short-video-workspace-'));
  const store = new WorkspaceStore(root);
  store.initialize();
  store.update('douyin-commerce', { sheetUrl: 'https://team.feishu.cn/sheets/commerce' });
  store.select('douyin-commerce');
  assert.equal(store.active().sheetUrl, 'https://team.feishu.cn/sheets/commerce');
  assert.equal(store.get('douyin-standard').sheetUrl, '');
});
