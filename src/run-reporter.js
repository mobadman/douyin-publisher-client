const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class RunReporter {
  constructor(reportsRoot, mode = '测试小号-准备发布但不提交') {
    this.reportsRoot = reportsRoot;
    this.mode = mode;
    this.runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
    this.startedAt = new Date().toISOString();
    this.steps = [];
  }

  add(step, detail = '') {
    this.steps.push({ at: new Date().toISOString(), step, detail });
  }

  async save(status, error, page) {
    const runRoot = path.join(this.reportsRoot, this.runId);
    fs.mkdirSync(runRoot, { recursive: true });
    let screenshotPath = null;
    if (page && !page.isClosed()) {
      screenshotPath = path.join(runRoot, 'page.png');
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {
        screenshotPath = null;
      });
    }
    const report = {
      runId: this.runId,
      mode: this.mode,
      status,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      steps: this.steps,
      error: error ? { name: error.name, message: error.message } : null,
      screenshotPath
    };
    const reportPath = path.join(runRoot, 'report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return reportPath;
  }
}

module.exports = { RunReporter };
