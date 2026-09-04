const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

test('3.0.6多平台版本名称和工作区入口完整显示', () => {
  assert.match(html, /短视频工具/);
  assert.match(html, /短视频批量发布助手/);
  assert.match(html, /开发版 3\.0\.6/);
  assert.match(html, /id="workspace-select"/);
  assert.match(html, /id="commerce-panel"/);
  assert.match(html, /商品短标题库/);
  assert.match(html, /id="prepare-commerce"/);
  assert.match(html, /产品型号映射\.csv/);
  assert.doesNotMatch(html, /data-page="guide"/);
  assert.match(html, /id="test-platform"/);
});

test('计划支持勾选、编辑、续发和ID记录', () => {
  assert.match(html, /id="select-all"/);
  assert.match(html, /id="edit-plan-modal"/);
  assert.match(html, /发布已勾选的未完成视频/);
  assert.match(html, /id="sync-ids"/);
  assert.match(html, /id="edit-plan-category"/);
  assert.match(html, /id="edit-plan-model"/);
  assert.match(html, /飞书实际行/);
  assert.match(html, /id="test-resolve-id"/);
  assert.match(html, /id="copy-id-table"/);
  assert.match(html, /AI声明/);
  assert.doesNotMatch(html, /id="create-plan"/);
  assert.match(html, /id="create-plan-current-filter"/);
});

test('文案字数只提示不限制', () => {
  assert.match(html, /正文（字数不限，可为空）/);
  assert.doesNotMatch(html, /正文（最多20个汉字/);
});

test('删除账号界面包含三重验证', () => {
  assert.match(html, /id="delete-check"/);
  assert.match(html, /id="delete-account-name"/);
  assert.match(html, /id="delete-confirm-phrase"/);
  assert.match(app, /delete-confirm-phrase/);
  assert.match(app, /=== '删除账号'/);
});

test('正式界面包含本地打赏二维码和实验功能提示', () => {
  assert.match(html, /assets\/donation-qr\.jpg/);
  assert.match(html, /功能开发中，敬请期待/);
});
