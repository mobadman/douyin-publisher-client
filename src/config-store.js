const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG = {
  sheetUrl: 'https://c5z4rfm2f3.feishu.cn/sheets/APM9sG44HhmTZTt3AR1cWnbunMd?sheet=mlxXMF',
  guideCompleted: false,
  watermarkEnabled: true,
  guardSeconds: 2,
  columns: {
    material: '素材链接',
    category: '产品类目',
    model: '产品型号',
    publishDate: '发布时间',
    allowPublish: '允许发布'
  }
};

class ConfigStore {
  constructor(dataRoot) {
    this.filePath = path.join(dataRoot, 'settings.json');
  }

  initialize() {
    if (!fs.existsSync(this.filePath)) {
      this.write(DEFAULT_CONFIG);
    } else {
      const stored = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (Object.hasOwn(stored, 'appId') || Object.hasOwn(stored, 'encryptedAppSecret')) {
        this.write(this.read());
      }
    }
    return this.publicConfig();
  }

  read() {
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    return {
      ...DEFAULT_CONFIG,
      sheetUrl: parsed.sheetUrl || DEFAULT_CONFIG.sheetUrl,
      guideCompleted: parsed.guideCompleted === true,
      watermarkEnabled: parsed.watermarkEnabled !== false,
      guardSeconds: Number.isFinite(Number(parsed.guardSeconds))
        ? Math.min(10, Math.max(1, Number(parsed.guardSeconds)))
        : DEFAULT_CONFIG.guardSeconds,
      columns: { ...DEFAULT_CONFIG.columns, ...(parsed.columns || {}) }
    };
  }

  write(config) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }

  publicConfig() {
    return this.read();
  }

  save(input) {
    const current = this.read();
    const sheetUrl = String(input.sheetUrl || '').trim();
    let url;
    try {
      url = new URL(sheetUrl);
    } catch {
      throw new Error('飞书表格链接格式不正确');
    }
    if (url.protocol !== 'https:' || !/\.feishu\.cn$/i.test(url.hostname) || !/\/sheets\//.test(url.pathname)) {
      throw new Error('请填写以 https:// 开头的飞书电子表格链接');
    }
    const guardSeconds = Number(input.guardSeconds ?? current.guardSeconds);
    if (!Number.isFinite(guardSeconds) || guardSeconds < 1 || guardSeconds > 10) {
      throw new Error('防误操时长必须是1到10秒');
    }
    const config = {
      ...current,
      sheetUrl,
      guideCompleted: input.guideCompleted === undefined ? current.guideCompleted : input.guideCompleted === true,
      watermarkEnabled: input.watermarkEnabled === undefined ? current.watermarkEnabled : input.watermarkEnabled === true,
      guardSeconds
    };
    this.write(config);
    return config;
  }

  settings() {
    return this.read();
  }
}

module.exports = { ConfigStore, DEFAULT_CONFIG };
