function normalizeDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function isAllowed(value) {
  return /^(是|允许|可发布|发布|true|1|yes|√)$/i.test(String(value ?? '').trim());
}

function arrangeProducts(items) {
  const remaining = items.map((item, index) => ({ ...item, sourceOrder: index }));
  const output = [];
  while (remaining.length) {
    const last = output[output.length - 1];
    let index = remaining.findIndex((item) => !last || item.category !== last.category);
    if (index < 0) index = remaining.findIndex((item) => !last || item.model !== last.model);
    if (index < 0) index = 0;
    output.push(remaining.splice(index, 1)[0]);
  }
  return output;
}

function buildTimes(date, count) {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('单日视频数量必须在1到20条之间');
  const intervals = [];
  if (count > 1) {
    const halfHourIntervals = Math.max(0, 2 * (count - 14));
    const hourIntervals = (count - 1) - halfHourIntervals;
    intervals.push(...Array(hourIntervals).fill(60), ...Array(halfHourIntervals).fill(30));
  }
  let minutes = 10 * 60;
  const values = [`${date} 10:00`];
  for (const interval of intervals) {
    minutes += interval;
    values.push(`${date} ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  if (minutes > 23 * 60) throw new Error('排期超过23:00，已停止生成计划');
  return values;
}

function buildPlan(items, date) {
  const arranged = arrangeProducts(items);
  const times = buildTimes(date, arranged.length);
  return arranged.map((item, index) => ({ ...item, sequence: index + 1, scheduledLocal: times[index] }));
}

module.exports = { normalizeDate, isAllowed, arrangeProducts, buildTimes, buildPlan };
