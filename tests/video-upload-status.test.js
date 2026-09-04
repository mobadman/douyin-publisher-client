const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('封面流程主动上传竖封面和横封面', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-manager.js'), 'utf8');
  assert.match(source, /uploadCoverVariant\(page, modal, '设置竖封面', coverPath\)/);
  assert.match(source, /uploadCoverVariant\(page, modal, '设置横封面', coverPath\)/);
  assert.match(source, /getByRole\('button', \{ name: '完成', exact: true \}\)/);
});

test('只处理已登记的横封面推荐弹窗', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-manager.js'), 'utf8');
  assert.match(source, /getByText\('设置横封面获取多流量', \{ exact: true \}\)/);
  assert.match(source, /getByRole\('button', \{ name: '暂不设置', exact: true \}\)/);
  assert.doesNotMatch(source, /getByRole\('button', \{ name: \/关闭/);
});

test('只有AI标识视频才执行内容由AI生成自主声明', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser-manager.js'), 'utf8');
  assert.match(source, /payload\.aiGenerated = item\.aiGenerated === true/);
  assert.match(source, /if \(payload\.aiGenerated\) \{/);
  assert.match(source, /await this\.fillAiDeclaration\(page\)/);
  assert.match(source, /getByText\('自主声明', \{ exact: true \}\)/);
  assert.match(source, /getByText\('内容由AI生成', \{ exact: true \}\)/);
  assert.match(source, /getByRole\('button', \{ name: '确定', exact: true \}\)/);
});
