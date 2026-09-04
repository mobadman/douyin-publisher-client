const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProductMappingStore } = require('../src/product-mapping-store');

test('按飞书产品型号读取真正的抖店搜索型号', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-mapping-'));
  const filePath = path.join(root, '产品型号映射.csv');
  fs.writeFileSync(filePath, '\uFEFF飞书产品型号,抖店搜索型号\r\n美的酷省电Ultra柜机,KFR-72LW\r\n', 'utf8');
  const store = new ProductMappingStore(filePath);
  assert.equal(store.resolve('美的酷省电Ultra柜机').searchModel, 'KFR-72LW');
});

test('重复映射会阻止商城计划继续', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-mapping-'));
  const filePath = path.join(root, '产品型号映射.csv');
  fs.writeFileSync(filePath, '飞书产品型号,抖店搜索型号\r\nG23,G23-A\r\nG23,G23-B\r\n', 'utf8');
  assert.equal(new ProductMappingStore(filePath).resolve('G23').state, 'invalid');
});
