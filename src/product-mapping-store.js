const fs = require('node:fs');

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value.trim()); value = '';
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

function normalizeKey(value) {
  return String(value || '').replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
}

class ProductMappingStore {
  constructor(filePath) { this.filePath = filePath; }

  initialize() {
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '\uFEFF飞书产品型号,抖店搜索型号\r\n// 示例：美的酷省电Ultra柜机,KFR-72LW\r\n', 'utf8');
    }
    return this.filePath;
  }

  list() {
    const lines = fs.readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
      .map((line) => line.trim()).filter((line) => line && !line.startsWith('//'));
    if (!lines.length) return [];
    const header = parseCsvLine(lines[0]);
    const sourceIndex = header.findIndex((value) => /飞书.*产品型号|产品名/.test(value));
    const queryIndex = header.findIndex((value) => /抖店.*型号|搜索型号|产品代码/.test(value));
    if (sourceIndex < 0 || queryIndex < 0) throw new Error('产品型号映射表缺少“飞书产品型号”或“抖店搜索型号”表头');
    return lines.slice(1).map(parseCsvLine).map((values, index) => ({
      row: index + 2,
      sourceModel: String(values[sourceIndex] || '').trim(),
      searchModel: String(values[queryIndex] || '').trim()
    })).filter((item) => item.sourceModel || item.searchModel);
  }

  resolve(model) {
    const key = normalizeKey(model);
    const matches = this.list().filter((item) => normalizeKey(item.sourceModel) === key);
    if (!matches.length) return { state: 'missing', reason: `产品型号映射表中没有“${model}”` };
    if (matches.length > 1) return { state: 'invalid', reason: `产品型号映射表中“${model}”出现${matches.length}次` };
    if (!matches[0].searchModel) return { state: 'invalid', reason: `产品型号映射表第${matches[0].row}行没有填写抖店搜索型号` };
    return { state: 'ready', ...matches[0] };
  }
}

module.exports = { ProductMappingStore, parseCsvLine, normalizeKey };
