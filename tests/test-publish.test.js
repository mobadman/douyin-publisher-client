const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { countChineseCharacters, normalizeTags, normalizeTestPayload } = require('../src/test-publish');

test('正文只统计汉字数量', () => {
  assert.equal(countChineseCharacters('X6S Max洗碗机，真省心！123'), 6);
});

test('Tag移除井号和空格、去重并限制五个', () => {
  assert.deepEqual(
    normalizeTags('#美的, 洗碗机,美的, 强力 洗, 官方, 第六个'),
    ['美的', '洗碗机', '强力洗', '官方', '第六个']
  );
});

test('测试任务校验本地文件和未来时间', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-test-publish-'));
  const videoPath = path.join(root, 'video.mp4');
  const coverPath = path.join(root, 'cover.png');
  fs.writeFileSync(videoPath, 'video');
  fs.writeFileSync(coverPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const now = new Date('2026-08-19T10:00:00+08:00');
  const result = normalizeTestPayload({
    videoPath,
    coverPath,
    body: '测试文案',
    tags: '产品, 品类',
    scheduledAt: '2026-08-20T12:30:00+08:00'
  }, now);
  assert.equal(result.localDate, '2026-08-20');
  assert.equal(result.localTime, '12:30');
  assert.deepEqual(result.tags, ['产品', '品类']);
});

test('正文超过20个汉字会在打开网页前中止', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-test-publish-'));
  const videoPath = path.join(root, 'video.mp4');
  fs.writeFileSync(videoPath, 'video');
  assert.throws(() => normalizeTestPayload({
    videoPath,
    body: '这是一个明显超过二十个汉字限制的测试发布正文内容',
    tags: '',
    scheduledAt: '2026-08-20T12:30:00+08:00'
  }, new Date('2026-08-19T10:00:00+08:00')), /最多包含20个汉字/);
});

test('封面扩展名与真实格式不一致时中止', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-test-publish-'));
  const videoPath = path.join(root, 'video.mp4');
  const fakeCover = path.join(root, 'fake.jpg');
  fs.writeFileSync(videoPath, 'video');
  fs.writeFileSync(fakeCover, 'not a jpeg');
  assert.throws(() => normalizeTestPayload({
    videoPath,
    coverPath: fakeCover,
    scheduledAt: new Date(Date.now() + 60_000).toISOString()
  }), /扩展名与真实文件格式不一致/);
});
