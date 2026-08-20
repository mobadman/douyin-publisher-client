const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyPublishSnapshot } = require('../src/publish-result');

test('平台成功提示判定为已发布', () => {
  assert.equal(classifyPublishSnapshot({
    initialUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    currentUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    successMessage: '发布成功'
  }).state, 'published');
});

test('跳转作品管理判定为已发布', () => {
  assert.equal(classifyPublishSnapshot({
    initialUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    currentUrl: 'https://creator.douyin.com/creator-micro/content/manage'
  }).state, 'published');
});

test('失败提示优先于成功提示', () => {
  assert.deepEqual(classifyPublishSnapshot({
    initialUrl: 'a',
    currentUrl: 'b',
    successMessage: '发布成功',
    errorMessage: '网络异常，请稍后重试'
  }), { state: 'failed', detail: '网络异常，请稍后重试' });
});
