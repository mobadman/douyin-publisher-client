const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const validatedHash = '1249F7DDA6BD834FE376F4CF359572EED697F8A054BA89C6CA47EAB0A1FED6A2';
const helperPath = path.join(__dirname, '..', 'native', 'FileDialogHelper.exe');

if (!fs.existsSync(helperPath)) throw new Error('缺少已验证的封面文件选择辅助程序');
const actualHash = crypto.createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex').toUpperCase();
if (actualHash !== validatedHash) {
  throw new Error(`封面文件选择辅助程序不是1.0.8本地窗口验证通过版本，已停止打包。期望 ${validatedHash}，实际 ${actualHash}`);
}
process.stdout.write(`封面辅助程序校验通过：${actualHash}\n`);
