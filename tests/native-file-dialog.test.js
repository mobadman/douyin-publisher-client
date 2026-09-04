const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('现有文件窗口使用原生控件定位且不遍历完整可访问性树', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'native', 'FileDialogHelper.cs'), 'utf8');
  const branchStart = source.indexOf('string existingFilePath');
  const branchEnd = source.indexOf('if (args.Length >= 8', branchStart);
  const branch = source.slice(branchStart, branchEnd);
  assert.match(branch, /SetFileNameAndOpenNative/);
  assert.doesNotMatch(branch, /FindFileNameElement/);
  assert.doesNotMatch(branch, /WaitForChromeFileDialog/);
});

test('打开按钮缺少UI Automation调用接口时回退原生BM_CLICK', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'native', 'FileDialogHelper.cs'), 'utf8');
  assert.match(source, /SendMessage\(openButton, ButtonClick, IntPtr\.Zero, IntPtr\.Zero\)/);
  assert.doesNotMatch(source, /已定位原生“打开”按钮，但该控件不支持调用/);
});
