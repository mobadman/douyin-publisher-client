const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountStore } = require('../src/account-store');

test('首次初始化会创建测试小号和发布账号', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-publisher-'));
  const store = new AccountStore(root);
  const accounts = store.initialize();
  assert.deepEqual(accounts.map((item) => item.id), ['test-account', 'production-account']);
  assert.equal(accounts[1].label, '发布账号');
  assert.ok(accounts.every((item) => item.profilePath.startsWith(root)));
});

test('升级时把旧称最终发布大号迁移为发布账号', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-publisher-'));
  const store = new AccountStore(root);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(store.filePath, JSON.stringify([
    { id: 'test-account', label: '测试小号', role: 'test', lastDetected: null },
    { id: 'production-account', label: '最终发布大号', role: 'production', lastDetected: null }
  ]));
  const accounts = store.initialize();
  assert.equal(accounts.find((item) => item.id === 'production-account').label, '发布账号');
});

test('允许修改显示昵称但不改变账号身份', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-publisher-'));
  const store = new AccountStore(root);
  store.initialize();
  const renamed = store.rename('production-account', '品牌发布账号');
  assert.equal(renamed.label, '品牌发布账号');
  assert.equal(renamed.id, 'production-account');
  assert.equal(renamed.role, 'production');
});

test('重置账号会清除检测信息并保留固定角色', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-publisher-'));
  const store = new AccountStore(root);
  store.initialize();
  store.rename('test-account', '临时小号');
  store.saveDetection('test-account', { state: 'logged-in', nickname: '小号', douyinId: 'test01' });
  const reset = store.reset('test-account');
  assert.equal(reset.label, '测试小号');
  assert.equal(reset.role, 'test');
  assert.equal(reset.lastDetected, null);
});

test('检测结果会保存且不改变账号身份', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-publisher-'));
  const store = new AccountStore(root);
  store.initialize();
  store.saveDetection('test-account', {
    state: 'logged-in', nickname: '测试账号', douyinId: 'abc123', message: '已识别登录账号'
  });
  const saved = store.get('test-account');
  assert.equal(saved.label, '测试小号');
  assert.equal(saved.lastDetected.douyinId, 'abc123');
});
