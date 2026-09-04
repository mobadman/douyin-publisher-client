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

test('1至44条排期集中在下午晚上且不超出边界', () => {
  assert.deepEqual(buildTimes('2026-08-21', 1), ['2026-08-21 19:00']);
  assert.deepEqual(buildTimes('2026-08-21', 8), [
    '2026-08-21 15:30', '2026-08-21 16:30', '2026-08-21 17:30', '2026-08-21 18:30',
    '2026-08-21 19:30', '2026-08-21 20:30', '2026-08-21 21:30', '2026-08-21 22:30'
  ]);
  assert.equal(buildTimes('2026-08-21', 12)[0], '2026-08-21 13:00');
  assert.equal(buildTimes('2026-08-21', 27).at(-1), '2026-08-21 23:00');
  assert.equal(buildTimes('2026-08-21', 44)[0], '2026-08-21 10:00');
  assert.equal(buildTimes('2026-08-21', 44).at(-1), '2026-08-21 23:00');
  for (let count = 1; count <= 44; count += 1) {
    const values = buildTimes('2026-08-21', count);
    const commerceValues = buildTimes('2026-08-21', count, { lane: 5 });
    assert.equal(values.length, count);
    assert.equal(new Set(values).size, count);
    assert.ok(values.every((value) => value.slice(-5) >= '10:00' && value.slice(-5) <= '23:00'));
    assert.ok(commerceValues.every((value) => Number(value.slice(-2)) % 10 === 5));
    assert.equal(values.some((value) => commerceValues.includes(value)), false);
  }
});
