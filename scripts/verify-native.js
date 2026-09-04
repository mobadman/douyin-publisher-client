const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const validatedHash = '2A8CE30A7391B666DFA71D3ED87D5E15BEDBEDD380ADDBEAAB936F27DA2DFF23';
const helperPath = path.join(__dirname, '..', 'native', 'FileDialogHelper.exe');

if (!fs.existsSync(helperPath)) throw new Error('缺少已验证的封面文件选择辅助程序');
const actualHash = crypto.createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex').toUpperCase();
if (actualHash !== validatedHash) {
  throw new Error(`封面文件选择辅助程序不是3.0.6沿用的兼容补丁版本，已停止打包。期望 ${validatedHash}，实际 ${actualHash}`);
}
process.stdout.write(`封面辅助程序校验通过：${actualHash}\n`);
