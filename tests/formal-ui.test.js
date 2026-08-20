const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

test('1.1.0正式版名称和版本完整显示', () => {
  assert.match(html, /短视频工具/);
  assert.match(html, /抖音批量发布助手/);
  assert.match(html, /正式版 1\.1\.0/);
  assert.doesNotMatch(html, /正式版 1\.0</);
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
