const fs = require('node:fs');
const path = require('node:path');

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatRange(lowSeconds, highSeconds) {
  const low = Math.max(1, Math.round(lowSeconds / 60));
  const high = Math.max(low, Math.round(highSeconds / 60));
  return low === high ? `预计约${low}分钟` : `预计约${low}–${high}分钟`;
}

class DurationStore {
  constructor(dataRoot) {
    this.filePath = path.join(dataRoot, 'duration-history.json');
  }

  read() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  record(kind, itemCount, durationMs, totalBytes = 0) {
    if (!['pull', 'publish'].includes(kind) || itemCount < 1 || durationMs < 1) return;
    const records = this.read();
    records.push({ kind, itemCount, durationMs, totalBytes, completedAt: new Date().toISOString() });
    const kept = records.slice(-60);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(kept, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.filePath);
  }

  perItemSeconds(kind, fallback) {
    const values = this.read()
      .filter((item) => item.kind === kind && item.itemCount > 0 && item.durationMs > 0)
      .slice(-12)
      .map((item) => item.durationMs / 1000 / item.itemCount);
    return median(values) || fallback;
  }

  estimates(plan = null) {
    const pullPerItem = this.perItemSeconds('pull', 36);
    const pull = formatRange(60 + pullPerItem * 8, 60 + pullPerItem * 20);
    const count = plan?.items?.length || 0;
    const publishPerItem = this.perItemSeconds('publish', 150);
    const totalBytes = count ? plan.items.reduce((sum, item) => {
      try { return sum + fs.statSync(item.videoPath).size; } catch { return sum; }
    }, 0) : 0;
    const byteSamples = this.read().filter((item) => item.kind === 'publish' && item.totalBytes > 0 && item.itemCount > 0).slice(-12);
    const typicalBytesPerItem = median(byteSamples.map((item) => item.totalBytes / item.itemCount)) || 100 * 1024 * 1024;
    const currentBytesPerItem = count && totalBytes ? totalBytes / count : typicalBytesPerItem;
    const sizeMultiplier = Math.min(1.25, Math.max(0.85, 0.8 + 0.2 * (currentBytesPerItem / typicalBytesPerItem)));
    const publishSeconds = count ? 45 + publishPerItem * count * sizeMultiplier : 45 + publishPerItem * 8;
    const publish = count
      ? formatRange(publishSeconds * 0.85, publishSeconds * 1.2)
      : formatRange(publishSeconds * 0.85, (45 + publishPerItem * 20) * 1.2);
    const samples = this.read();
    return {
      pull: `${pull}（按8–20条${samples.some((item) => item.kind === 'pull') ? '，已按本机记录校准' : '，首次估算'}）`,
      publish: `${publish}${count ? `（${count}条）` : '（按8–20条）'}${samples.some((item) => item.kind === 'publish') ? '，已校准' : ''}`
    };
  }
}

module.exports = { DurationStore, median, formatRange };
