const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCandidateSet } = require('../src/product-catalog');

function candidate(id, priceCents, stock, sales) {
  return { id, url: `https://haohuo.jinritemai.com/ecommerce/trade/detail?id=${id}`, priceCents, stock, sales };
}

test('本批现场查询的同价商品按库存后销量选择', () => {
  const resolved = resolveCandidateSet([candidate('a', 209900, 20, 50), candidate('b', 209900, 60, 2)]);
  assert.equal(resolved.state, 'ready');
  assert.equal(resolved.candidate.id, 'b');
});

test('本批现场查询出现多个正常价格时要求人工选择', () => {
  const resolved = resolveCandidateSet([candidate('a', 209900, 20, 50), candidate('b', 219900, 60, 2)]);
  assert.equal(resolved.state, 'needs-confirmation');
  assert.equal(resolved.candidates.length, 2);
});

test('异常占位价格不会进入本批有效候选', () => {
  const resolved = resolveCandidateSet([candidate('placeholder', 9_999_999, 999, 999), candidate('normal', 209900, 1, 1)]);
  assert.equal(resolved.candidate.id, 'normal');
});
