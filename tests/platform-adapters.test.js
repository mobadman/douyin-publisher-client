const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPublishingAdapter, DouyinStandardAdapter, DouyinCommerceAdapter, WechatChannelsAdapter } = require('../src/publishing-adapters');
const { candidateFromRowText } = require('../src/doudian-browser-manager');

const manager = { status: () => ({ open: false }), close() {} };

test('工作区只会选择对应的平台发布适配器', () => {
  assert.ok(createPublishingAdapter({ platform: 'douyin', mode: 'standard' }, { douyin: manager }) instanceof DouyinStandardAdapter);
  assert.ok(createPublishingAdapter({ platform: 'douyin', mode: 'commerce' }, { douyin: manager }) instanceof DouyinCommerceAdapter);
  assert.ok(createPublishingAdapter({ platform: 'wechat-channels', mode: 'standard' }, { wechat: manager }) instanceof WechatChannelsAdapter);
});

test('抖店商品行文本提取价格库存销量和商品ID', () => {
  const item = candidateFromRowText('美的 G23 商品ID：3821815760901242988 ￥2099.00 总库存 59 总销量 6', 'https://haohuo.jinritemai.com/ecommerce/trade/detail?id=1');
  assert.equal(item.externalProductId, '3821815760901242988');
  assert.equal(item.priceCents, 209900);
  assert.equal(item.stock, 59);
  assert.equal(item.sales, 6);
});

test('视频号实现明确保持合集、视频标注和原创声明默认值', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'wechat-channels-browser-manager.js'), 'utf8');
  assert.match(source, /合集、视频标注、原创声明保持平台默认值/);
  assert.doesNotMatch(source, /含AI生成内容/);
  assert.match(source, /waiting-human/);
});
