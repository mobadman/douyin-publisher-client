const { execFileSync } = require('node:child_process');
const path = require('node:path');

if (process.platform !== 'win32') throw new Error('原生文件窗口辅助程序只能在 Windows 上编译');

const projectRoot = path.join(__dirname, '..');
const frameworkRoot = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const compiler = path.join(frameworkRoot, 'csc.exe');
const wpfRoot = path.join(frameworkRoot, 'WPF');

execFileSync(compiler, [
  '/nologo',
  '/optimize+',
  '/target:exe',
  `/out:${path.join(projectRoot, 'native', 'FileDialogHelper.exe')}`,
  `/reference:${path.join(wpfRoot, 'UIAutomationClient.dll')}`,
  `/reference:${path.join(wpfRoot, 'UIAutomationTypes.dll')}`,
  `/reference:${path.join(wpfRoot, 'WindowsBase.dll')}`,
  path.join(projectRoot, 'native', 'FileDialogHelper.cs')
], { stdio: 'inherit' });

console.log('原生文件窗口辅助程序编译完成');
