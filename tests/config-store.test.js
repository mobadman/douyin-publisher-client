const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConfigStore } = require('../src/config-store');

test('只保存飞书表格链接，不再需要开放平台凭证', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-config-'));
  const store = new ConfigStore(root);
  store.initialize();
  const config = store.save({ sheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1' });
  assert.equal(config.sheetUrl, 'https://example.feishu.cn/sheets/token?sheet=sheet1');
  assert.equal(Object.hasOwn(config, 'appId'), false);
  assert.equal(Object.hasOwn(config, 'encryptedAppSecret'), false);
});

test('拒绝非飞书电子表格链接', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-config-'));
  const store = new ConfigStore(root);
  store.initialize();
  assert.throws(() => store.save({ sheetUrl: 'https://example.com/file' }), /飞书电子表格/);
});

test('升级时从本地设置中移除旧版 App ID 和加密 Secret', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-config-'));
  const store = new ConfigStore(root);
  fs.writeFileSync(store.filePath, JSON.stringify({
    sheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1',
    appId: 'cli_old',
    encryptedAppSecret: 'legacy-secret'
  }));
  store.initialize();
  const stored = fs.readFileSync(store.filePath, 'utf8');
  assert.equal(stored.includes('cli_old'), false);
  assert.equal(stored.includes('legacy-secret'), false);
});

test('保存正式版新手指引和防误操设置', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-config-'));
  const store = new ConfigStore(root);
  store.initialize();
  const config = store.save({
    sheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1',
    guideCompleted: true,
    watermarkEnabled: false,
    guardSeconds: 3.5
  });
  assert.equal(config.guideCompleted, true);
  assert.equal(config.watermarkEnabled, false);
  assert.equal(config.guardSeconds, 3.5);
});

test('防误操时长限制为1到10秒', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-config-'));
  const store = new ConfigStore(root);
  store.initialize();
  assert.throws(() => store.save({ sheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', guardSeconds: 0 }), /1到10秒/);
});
