const fs = require('node:fs');
const path = require('node:path');
const { normalizeDate, isAllowed } = require('./plan-engine');
const { safeName } = require('./library-store');

function parseSheetUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('飞书表格链接格式不正确');
  }
  const match = url.pathname.match(/\/(sheets|wiki)\/([^/?#]+)/);
  const sheetId = url.searchParams.get('sheet');
  if (!match) throw new Error('飞书链接中缺少电子表格或知识库 token');
  if (match[1] === 'sheets' && !sheetId) throw new Error('飞书电子表格链接缺少 sheet 参数');
  return { spreadsheetToken: match[2], sheetId: sheetId || null, sourceType: match[1] };
}

function cellText(value) {
  return String(value ?? '').trim();
}

function isAiMarked(value) {
  return /^(是|AI|AI生成|内容由AI生成|true|1|yes|√|☑|已勾选|checked)$/i.test(cellText(value));
}

function parseTsv(value) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const text = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === '\t' && !quoted) {
      row.push(cellText(cell));
      cell = '';
    } else if (character === '\n' && !quoted) {
      row.push(cellText(cell));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cellText(cell));
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function extractHttps(value) {
  const match = cellText(value).match(/https:\/\/[^\s"'<>]+/i);
  return match ? match[0].replace(/[),，。；;]+$/, '') : '';
}

function columnName(index) {
  let value = Number(index) + 1;
  if (!Number.isInteger(value) || value < 1) throw new Error('飞书素材列位置无效');
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

class FeishuService {
  constructor(browserManager) {
    this.browserManager = browserManager;
  }

  async rowsForDate(settings, targetDate, options = {}) {
    parseSheetUrl(settings.sheetUrl);
    const required = settings.columns;
    const requiredHeaders = [required.material, required.category, required.model, required.publishDate];
    const filterMode = options.filterMode === 'current' ? 'current' : 'auto';
    const copied = await this.browserManager.copySheet(settings.sheetUrl, requiredHeaders, {
      filterMode,
      targetDate,
      publishDateHeader: required.publishDate
    });
    const values = parseTsv(copied);
    if (!values.length) throw new Error('从飞书表格复制到的数据为空');

    const headerRowIndex = values.findIndex((row) => requiredHeaders.every((header) => row.includes(header)));
    if (headerRowIndex < 0) throw new Error('无法在复制结果中定位必需表头，请确认当前工作表和表头名称');
    const headers = values[headerRowIndex];
    const indexes = Object.fromEntries(Object.entries(required).map(([key, header]) => [key, headers.indexOf(header)]));
    for (const key of ['material', 'category', 'model', 'publishDate']) {
      if (indexes[key] < 0) throw new Error(`飞书表格缺少必需列【${required[key]}】`);
    }

    const allowColumnExists = indexes.allowPublish >= 0;
    const aiColumnExists = indexes.aiGenerated >= 0;
    const rows = [];
    for (let index = headerRowIndex + 1; index < values.length; index += 1) {
      const row = values[index] || [];
      if (normalizeDate(cellText(row[indexes.publishDate])) !== targetDate) continue;
      if (allowColumnExists && !isAllowed(cellText(row[indexes.allowPublish]))) continue;
      const rawMaterial = cellText(row[indexes.material]);
      const item = {
        sourceRow: index - headerRowIndex + 1,
        materialLink: extractHttps(rawMaterial),
        materialText: rawMaterial,
        materialCell: `${columnName(indexes.material)}${index - headerRowIndex + 1}`,
        sourceSheetUrl: settings.sheetUrl,
        category: cellText(row[indexes.category]),
        model: cellText(row[indexes.model]),
        aiGenerated: aiColumnExists && isAiMarked(row[indexes.aiGenerated]),
        publishDate: targetDate
      };
      const missing = [];
      if (!item.materialLink && !item.materialText) missing.push('素材链接');
      if (!item.category) missing.push('产品类目');
      if (!item.model) missing.push('产品型号');
      item.sourceMissing = missing;
      rows.push(item);
    }
    return { rows, allowColumnExists, aiColumnExists, filterMode };
  }

  async downloadMaterial(item, cacheRoot) {
    if (!item.materialLink && !item.materialText) throw new Error(`飞书第${item.sourceRow}行缺少素材附件`);
    const sourceName = item.materialLink ? new URL(item.materialLink).pathname : item.materialText;
    const sourceExtension = path.extname(sourceName).toLowerCase();
    const extension = ['.mp4', '.mov', '.m4v', '.webm'].includes(sourceExtension) ? sourceExtension : '.mp4';
    const fileName = `${String(item.sourceRow).padStart(4, '0')}-${safeName(item.model, '未命名产品')}${extension}`;
    const outputPath = path.join(cacheRoot, fileName);
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      if (!item.actualMaterialCell && !item.materialLink && this.browserManager.resolveAttachmentCell) {
        item.actualMaterialCell = await this.browserManager.resolveAttachmentCell(
          item.sourceSheetUrl, item.materialCell, item.materialText
        );
        item.actualSourceRow = Number(String(item.actualMaterialCell).replace(/^[A-Z]+/, '')) || null;
      }
      return outputPath;
    }
    const temporary = `${outputPath}.part`;
    if (item.materialLink) {
      await this.browserManager.download(item.materialLink, temporary);
    } else {
      const attachment = await this.browserManager.downloadAttachment(
        item.sourceSheetUrl,
        item.materialCell,
        temporary,
        item.materialText
      );
      item.actualMaterialCell = attachment?.actualCell || '';
      item.actualSourceRow = Number(String(item.actualMaterialCell).replace(/^[A-Z]+/, '')) || null;
    }
    if (!fs.existsSync(temporary) || fs.statSync(temporary).size === 0) throw new Error(`第${item.sourceRow}行素材下载后为空文件`);
    fs.renameSync(temporary, outputPath);
    return outputPath;
  }
}

module.exports = { FeishuService, parseSheetUrl, cellText, parseTsv, extractHttps, columnName, isAiMarked };
