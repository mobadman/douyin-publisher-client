const fs = require('node:fs');
const path = require('node:path');
const { BrowserManager } = require('../src/browser-manager');

const body = process.argv[2];
const scheduledAt = process.argv[3];
if (!body || !scheduledAt) {
  throw new Error('用法：node scripts/smoke-test-profile-id.js <正文> <ISO定时时间>');
}

const dataRoot = path.join(process.env.APPDATA, 'short-video-publisher-client-runtime');
const accounts = JSON.parse(fs.readFileSync(path.join(dataRoot, 'accounts.json'), 'utf8'));
const stored = accounts.find((account) => account.id === 'test-account');
if (!stored) throw new Error('没有找到测试小号配置');
const account = {
  ...stored,
  profilePath: path.join(dataRoot, 'chrome-profiles', 'test-account')
};
const manager = new BrowserManager(path.join(dataRoot, '本地素材库', '发布日志'));

(async () => {
  try {
    await manager.open(account);
    const result = await manager.scanTestPublishedId(account, { body, scheduledAt });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await manager.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
