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

function roundToLane(minutes, lane = 0) {
  return Math.round((minutes - lane) / 10) * 10 + lane;
}

function formatMinutes(date, minutes) {
  return `${date} ${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function buildTimes(date, count, options = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 44) throw new Error('单日视频数量必须在1到44条之间');
  const lane = options.lane === 5 ? 5 : 0;
  if (count === 1) return [formatMinutes(date, 19 * 60 + lane)];

  let start;
  let end;
  if (count <= 11) {
    const span = (count - 1) * 60;
    start = 19 * 60 - span / 2;
    end = start + span;
    if (end > 23 * 60) {
      start -= end - 23 * 60;
      end = 23 * 60;
    }
  } else if (count <= 27) {
    start = 13 * 60;
    end = 23 * 60;
  } else {
    start = 13 * 60 - 180 * (count - 27) / 17;
    end = 23 * 60;
  }

  const values = [];
  let previous = null;
  for (let index = 0; index < count; index += 1) {
    let minutes = roundToLane(start + (end - start) * index / (count - 1), lane);
    if (index === 0) minutes = roundToLane(start, lane);
    if (index === count - 1) minutes = roundToLane(end, lane);
    if (lane === 5 && minutes > 22 * 60 + 55) minutes = 22 * 60 + 55;
    if (previous !== null && minutes <= previous) minutes = previous + 10;
    if (minutes < 10 * 60 || minutes > 23 * 60) throw new Error('排期超出10:00到23:00，已停止生成计划');
    values.push(formatMinutes(date, minutes));
    previous = minutes;
  }
  return values;
}

function buildPlan(items, date, options = {}) {
  const arranged = arrangeProducts(items);
  const times = buildTimes(date, arranged.length, options);
  return arranged.map((item, index) => ({ ...item, sequence: index + 1, scheduledLocal: times[index] }));
}

module.exports = { normalizeDate, isAllowed, arrangeProducts, buildTimes, buildPlan };
