const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DurationStore, median, formatRange } = require('../src/duration-store');

test('中位数避免单次异常耗时污染估算', () => {
  assert.equal(median([10, 12, 100]), 12);
  assert.equal(median([10, 20]), 15);
});

test('首次拉取按8到20条显示约6到13分钟', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-duration-'));
  const store = new DurationStore(root);
  assert.match(store.estimates().pull, /6–13分钟/);
});

test('成功记录会校准后续估算并限制记录数量', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-duration-'));
  const store = new DurationStore(root);
  for (let index = 0; index < 65; index += 1) store.record('pull', 10, 6_000_000);
  const records = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
  assert.equal(records.length, 60);
  assert.match(store.estimates().pull, /已按本机记录校准/);
  assert.equal(formatRange(60, 120), '预计约1–2分钟');
});
