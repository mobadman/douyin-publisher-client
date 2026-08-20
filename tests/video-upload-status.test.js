const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VIDEO_UPLOAD_PROGRESS_PATTERN,
  VIDEO_UPLOAD_ERROR_PATTERN
} = require('../src/browser-manager');

test('正常的重新上传按钮不属于视频上传失败', () => {
  assert.equal(VIDEO_UPLOAD_ERROR_PATTERN.test('重新上传'), false);
  assert.equal(VIDEO_UPLOAD_ERROR_PATTERN.test('视频上传失败，请重新上传'), true);
});

test('封面检测状态会阻止程序提前点击发布', () => {
  assert.equal(VIDEO_UPLOAD_PROGRESS_PATTERN.test('封面检测中+70%'), true);
  assert.equal(VIDEO_UPLOAD_PROGRESS_PATTERN.test('作品未见异常'), false);
});
