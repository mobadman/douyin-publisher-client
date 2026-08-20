const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHelperOutput } = require('../src/native-file-dialog');

test('解析原生辅助程序的中文 JSON 结果', () => {
  assert.deepEqual(
    parseHelperOutput('{"ok":true,"message":"系统文件选择窗口已完成","filePath":"C:\\\\封面.jpg"}\r\n'),
    { ok: true, message: '系统文件选择窗口已完成', filePath: 'C:\\封面.jpg' }
  );
});

test('拒绝空的原生辅助程序结果', () => {
  assert.throws(() => parseHelperOutput(''), /没有返回结果/);
});
