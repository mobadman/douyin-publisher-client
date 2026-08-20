const test = require('node:test');
const assert = require('node:assert/strict');
const { chineseErrorMessage } = require('../src/chinese-error');

test('Playwright 英文点击错误附带中文说明', () => {
  assert.match(chineseErrorMessage(new Error('locator.click: Timeout 30000ms exceeded'), '点击发布'), /^点击发布等待超时。技术信息：/);
});

test('已有中文业务错误保持原文', () => {
  assert.equal(chineseErrorMessage(new Error('没有找到发布按钮'), '发布'), '没有找到发布按钮');
});
