const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyPublishSnapshot, createPlatformSubmissionEvidence } = require('../src/publish-result');

test('平台成功提示判定为已发布', () => {
  assert.equal(classifyPublishSnapshot({
    initialUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    currentUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    successMessage: '发布成功'
  }).state, 'published');
});

test('仅跳转作品管理不能判定为已发布', () => {
  assert.equal(classifyPublishSnapshot({
    initialUrl: 'https://creator.douyin.com/creator-micro/content/upload',
    currentUrl: 'https://creator.douyin.com/creator-micro/content/manage'
  }).state, 'responded');
});

test('失败提示优先于成功提示', () => {
  assert.deepEqual(classifyPublishSnapshot({
    initialUrl: 'a',
    currentUrl: 'b',
    successMessage: '发布成功',
    errorMessage: '网络异常，请稍后重试'
  }), { state: 'failed', detail: '网络异常，请稍后重试' });
});

test('平台明确成功后生成提交证据，不再依赖作品管理即时记录', () => {
  assert.deepEqual(createPlatformSubmissionEvidence({
    localDate: '2026-09-05',
    localTime: '13:00'
  }, {
    state: 'published',
    detail: '发布成功'
  }), {
    detail: '平台已明确返回“发布成功”；作品ID待批次完成后同步',
    source: 'platform-success-message',
    confirmation: '发布成功',
    scheduledLocal: '2026-09-05 13:00',
    videoUrl: '',
    videoId: ''
  });
});

test('没有明确成功提示时禁止生成提交证据', () => {
  assert.throws(() => createPlatformSubmissionEvidence({
    localDate: '2026-09-05',
    localTime: '13:00'
  }, {
    state: 'responded',
    detail: '页面已跳转'
  }), /没有返回明确的发布成功提示/);
});
