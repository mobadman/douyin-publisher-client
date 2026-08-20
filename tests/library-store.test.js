const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LibraryStore, safeName } = require('../src/library-store');

test('本地素材库只按产品型号直接匹配三个素材', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-library-'));
  const store = new LibraryStore(root);
  store.initialize();
  const paths = store.productPaths('冰箱', '熊墩墩600Pro');
  fs.mkdirSync(paths.coverDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(paths.copyFile), { recursive: true });
  fs.mkdirSync(path.dirname(paths.tagsFile), { recursive: true });
  fs.writeFileSync(path.join(paths.coverDirectory, '封面.jpg'), 'test');
  fs.writeFileSync(paths.copyFile, '冰箱收纳更省心\n第二条文案\n');
  fs.writeFileSync(paths.tagsFile, '熊墩墩600Pro,冰箱,美的冰箱,大容量,美的官方旗舰店\n');
  const result = store.match({ category: '冰箱', model: '熊墩墩600Pro' });
  assert.equal(result.body, '冰箱收纳更省心');
  assert.equal(result.tags.length, 5);
  assert.equal(path.basename(result.coverPath), '封面.jpg');
  assert.deepEqual(result.missing, []);
  assert.equal(paths.coverDirectory, path.join(store.coversRoot, '熊墩墩600Pro'));
  assert.equal(paths.copyFile, path.join(store.copyRoot, '熊墩墩600Pro.txt'));
  assert.equal(paths.tagsFile, path.join(store.tagsRoot, '熊墩墩600Pro.txt'));
});

test('相同产品型号在不同品类下使用同一套本地素材', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-library-'));
  const store = new LibraryStore(root);
  store.initialize();
  assert.deepEqual(store.productPaths('冰箱', '型号A'), store.productPaths('其他品类', '型号A'));
});

test('Windows 非法文件名字符会被替换', () => {
  assert.equal(safeName('X6S/Max:测试', 'fallback'), 'X6S_Max_测试');
});

test('清理缓存保留发布日志', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-library-'));
  const store = new LibraryStore(root);
  store.initialize();
  fs.writeFileSync(path.join(store.cacheRoot, 'video.mp4'), 'video');
  fs.writeFileSync(path.join(store.logsRoot, 'log.json'), '{}');
  const result = store.clearCache();
  assert.equal(result.removed, 1);
  assert.equal(fs.existsSync(path.join(store.logsRoot, 'log.json')), true);
});
