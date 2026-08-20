const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDate, isAllowed, arrangeProducts, buildTimes } = require('../src/plan-engine');

test('飞书格式化日期统一为年月日', () => {
  assert.equal(normalizeDate('2026/8/21 00:00'), '2026-08-21');
  assert.equal(normalizeDate('2026-08-21'), '2026-08-21');
});

test('允许发布只接受明确的肯定值', () => {
  assert.equal(isAllowed('是'), true);
  assert.equal(isAllowed('允许'), true);
  assert.equal(isAllowed(''), false);
  assert.equal(isAllowed('否'), false);
});

test('排序优先避免相邻相同品类', () => {
  const result = arrangeProducts([
    { category: '冰箱', model: 'A' },
    { category: '冰箱', model: 'B' },
    { category: '洗衣机', model: 'C' },
    { category: '洗衣机', model: 'D' }
  ]);
  assert.deepEqual(result.map((item) => item.category), ['冰箱', '洗衣机', '冰箱', '洗衣机']);
});

test('8至14条按一小时间隔，15至20条后段改为半小时', () => {
  assert.deepEqual(buildTimes('2026-08-21', 8), [
    '2026-08-21 10:00', '2026-08-21 11:00', '2026-08-21 12:00', '2026-08-21 13:00',
    '2026-08-21 14:00', '2026-08-21 15:00', '2026-08-21 16:00', '2026-08-21 17:00'
  ]);
  assert.equal(buildTimes('2026-08-21', 14).at(-1), '2026-08-21 23:00');
  assert.equal(buildTimes('2026-08-21', 15).at(-1), '2026-08-21 23:00');
  assert.equal(buildTimes('2026-08-21', 20).at(-1), '2026-08-21 23:00');
});
