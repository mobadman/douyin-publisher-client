const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ACCOUNTS = [
  { id: 'test-account', label: '抖音测试小号', role: 'test', platform: 'douyin', surface: 'creator' },
  { id: 'production-account', label: '抖音主页发布号', role: 'production', platform: 'douyin', surface: 'creator' },
  { id: 'wechat-test', label: '视频号测试账号', role: 'test', platform: 'wechat-channels', surface: 'creator' },
  { id: 'wechat-publisher', label: '微信视频号', role: 'production', platform: 'wechat-channels', surface: 'creator' }
];

class AccountStore {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.profilesRoot = path.join(dataRoot, 'chrome-profiles');
    this.filePath = path.join(dataRoot, 'accounts.json');
  }

  initialize() {
    fs.mkdirSync(this.profilesRoot, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      const now = new Date().toISOString();
      this.write(DEFAULT_ACCOUNTS.map((account) => ({
        ...account,
        createdAt: now,
        lastDetected: null
      })));
    } else {
      const accounts = this.read();
      let changed = false;
      for (const account of accounts) {
        if (account.id === 'production-account' && account.label === '最终发布大号') {
          account.label = '发布账号';
          changed = true;
        }
        if ((account.id === 'commerce-publisher' || account.id === 'commerce-shop') && !account.hidden) {
          account.hidden = true;
          changed = true;
        }
      }
      const now = new Date().toISOString();
      for (const defaults of DEFAULT_ACCOUNTS) {
        const existing = accounts.find((account) => account.id === defaults.id);
        if (!existing) {
          accounts.push({ ...defaults, createdAt: now, lastDetected: null });
          changed = true;
          continue;
        }
        for (const key of ['platform', 'surface', 'role']) {
          if (!existing[key]) {
            existing[key] = defaults[key];
            changed = true;
          }
        }
      }
      if (changed) this.write(accounts);
    }
    return this.list();
  }

  read() {
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('账号配置文件格式不正确');
    return parsed;
  }

  write(accounts) {
    fs.mkdirSync(this.dataRoot, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(accounts, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }

  list() {
    return this.read().filter((account) => !account.hidden).map((account) => this.withPath(account));
  }

  get(id) {
    const account = this.read().find((item) => item.id === id);
    if (!account) throw new Error('没有找到这个账号配置');
    return this.withPath(account);
  }

  saveDetection(id, detection) {
    const accounts = this.read();
    const index = accounts.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('没有找到这个账号配置');
    accounts[index].lastDetected = {
      ...detection,
      checkedAt: new Date().toISOString()
    };
    this.write(accounts);
    return this.withPath(accounts[index]);
  }

  rename(id, label) {
    const normalized = String(label || '').replace(/\s+/g, ' ').trim();
    if (!normalized) throw new Error('账号昵称不能为空');
    if (normalized.length > 24) throw new Error('账号昵称不能超过24个字符');
    const accounts = this.read();
    const index = accounts.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('没有找到这个账号配置');
    accounts[index].label = normalized;
    this.write(accounts);
    return this.withPath(accounts[index]);
  }

  reset(id) {
    const defaults = DEFAULT_ACCOUNTS.find((item) => item.id === id);
    if (!defaults) throw new Error('不允许重置这个账号配置');
    const accounts = this.read();
    const index = accounts.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('没有找到这个账号配置');
    accounts[index] = {
      ...accounts[index],
      label: defaults.label,
      role: defaults.role,
      lastDetected: null,
      resetAt: new Date().toISOString()
    };
    this.write(accounts);
    return this.withPath(accounts[index]);
  }

  withPath(account) {
    return {
      ...account,
      profilePath: path.join(this.profilesRoot, account.platform || 'douyin', account.id)
    };
  }
}

module.exports = { AccountStore, DEFAULT_ACCOUNTS };
