const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildPlan, normalizeDate } = require('./plan-engine');

class PlanService {
  constructor(configStore, libraryStore, feishuService) {
    this.configStore = configStore;
    this.libraryStore = libraryStore;
    this.feishuService = feishuService;
    this.planPath = path.join(libraryStore.cacheRoot, 'current-plan.json');
  }

  async create(targetDate) {
    const date = normalizeDate(targetDate);
    if (!date || date !== targetDate) throw new Error('请选择有效的发布日期');
    const settings = this.configStore.settings();
    const { rows, allowColumnExists } = await this.feishuService.rowsForDate(settings, date);
    if (!rows.length) throw new Error(`【${date}】没有找到允许发布的视频`);
    if (rows.length > 20) throw new Error(`【${date}】共有${rows.length}条视频，超过单日20条上限`);
    const ordered = buildPlan(rows, date);
    const items = [];
    for (let index = 0; index < ordered.length; index += 1) {
      this.feishuService.browserManager?.assertNotCancelled?.();
      const item = ordered[index];
      let videoPath = null;
      try {
        videoPath = await this.feishuService.downloadMaterial(item, this.libraryStore.cacheRoot);
      } catch (error) {
        throw new Error(`飞书第${item.sourceRow}行素材获取失败：${error.message}`);
      }
      const library = this.libraryStore.match(item, index);
      const problems = [...item.sourceMissing, ...library.missing];
      items.push({
        ...item,
        videoPath,
        body: library.body,
        tags: library.tags,
        coverPath: library.coverPath,
        problems,
        ready: problems.length === 0
      });
    }
    const plan = {
      id: crypto.randomUUID(),
      date,
      createdAt: new Date().toISOString(),
      source: { sheetUrl: settings.sheetUrl, mode: 'browser-session', allowColumnExists },
      warnings: items.length < 8 ? [`当天只有${items.length}条视频，低于常规8条`] : [],
      status: 'draft',
      items
    };
    this.save(plan);
    return plan;
  }

  save(plan) {
    fs.mkdirSync(path.dirname(this.planPath), { recursive: true });
    const temporary = `${this.planPath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.planPath);
  }

  current() {
    if (!fs.existsSync(this.planPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.planPath, 'utf8'));
    } catch (error) {
      return {
        invalid: true,
        status: 'invalid',
        statusDetail: `当前计划缓存文件格式损坏，已安全忽略：${error.message}`,
        items: [],
        warnings: ['账号、登录资料和本地素材库不受影响。请重新生成计划；确认不再需要缓存视频时也可以清空下载缓存。']
      };
    }
  }

  updateStatus(status, detail = '') {
    const plan = this.current();
    if (!plan || plan.invalid) throw new Error('当前没有有效的发布计划，请重新生成');
    plan.status = status;
    plan.statusDetail = detail;
    plan.updatedAt = new Date().toISOString();
    this.save(plan);
    return plan;
  }
}

module.exports = { PlanService };
