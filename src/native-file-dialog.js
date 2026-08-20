const fs = require('node:fs');
const { execFile } = require('node:child_process');

function parseHelperOutput(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error('原生文件窗口辅助程序没有返回结果');
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    throw new Error(`无法解析原生文件窗口辅助程序的结果：${lines[lines.length - 1]}`);
  }
}

function selectFileInOpenDialog(helperPath, filePath, timeout = 15_000) {
  if (!helperPath || !fs.existsSync(helperPath)) {
    return Promise.reject(new Error(`缺少原生文件窗口辅助程序：${helperPath || '路径为空'}`));
  }
  return new Promise((resolve, reject) => {
    execFile(
      helperPath,
      ['select-open-dialog', filePath, String(timeout)],
      { windowsHide: true, timeout: timeout * 2, encoding: 'utf8' },
      (error, stdout, stderr) => {
        let result;
        try {
          result = parseHelperOutput(stdout);
        } catch (parseError) {
          reject(new Error(`${parseError.message}${stderr ? `；${String(stderr).trim()}` : ''}`));
          return;
        }
        if (error || !result.ok) {
          reject(new Error(result.message || error?.message || '系统文件选择窗口操作失败'));
          return;
        }
        resolve(result);
      }
    );
  });
}

function selectFileAtPosition(helperPath, filePath, clickTarget, timeout = 15_000, windowTitle = '抖音创作者中心') {
  if (!helperPath || !fs.existsSync(helperPath)) {
    return Promise.reject(new Error(`缺少原生文件窗口辅助程序：${helperPath || '路径为空'}`));
  }
  return new Promise((resolve, reject) => {
    execFile(helperPath, [
      'select-at', filePath, windowTitle,
      String(clickTarget.x), String(clickTarget.y),
      String(clickTarget.viewportWidth), String(clickTarget.viewportHeight), String(timeout)
    ], { windowsHide: true, timeout: timeout * 2, encoding: 'utf8' }, (error, stdout, stderr) => {
      let result;
      try {
        result = parseHelperOutput(stdout);
      } catch (parseError) {
        reject(new Error(`${parseError.message}${stderr ? `；${String(stderr).trim()}` : ''}`));
        return;
      }
      if (error || !result.ok) {
        reject(new Error(result.message || error?.message || '系统文件选择窗口操作失败'));
        return;
      }
      resolve(result);
    });
  });
}

module.exports = { parseHelperOutput, selectFileInOpenDialog, selectFileAtPosition };
