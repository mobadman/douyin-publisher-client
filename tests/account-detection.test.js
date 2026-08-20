const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAccountText } = require('../src/account-detection');

test('识别已登录账号的昵称和抖音号', () => {
  const result = parseAccountText('抖音创作者中心\n示例昵称\n抖音号：demo_123\n作品管理');
  assert.equal(result.state, 'logged-in');
  assert.equal(result.nickname, '示例昵称');
  assert.equal(result.douyinId, 'demo_123');
});

test('识别扫码登录页面', () => {
  const result = parseAccountText('欢迎使用抖音创作者中心\n扫码登录\n手机号登录');
  assert.equal(result.state, 'logged-out');
});

test('信息不足时不猜测账号', () => {
  const result = parseAccountText('抖音创作者中心\n页面加载中');
  assert.equal(result.state, 'uncertain');
  assert.equal(result.douyinId, null);
});
