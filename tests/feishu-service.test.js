const test = require('node:test');
const assert = require('node:assert/strict');
const { FeishuService, parseSheetUrl, parseTsv, extractHttps, columnName } = require('../src/feishu-service');

const columns = {
  material: '素材链接', category: '产品类目', model: '产品型号', publishDate: '发布时间', allowPublish: '允许发布'
};

test('从飞书链接解析表格和工作表标识', () => {
  assert.deepEqual(
    parseSheetUrl('https://example.feishu.cn/sheets/abcDEF123?sheet=mlxXMF'),
    { spreadsheetToken: 'abcDEF123', sheetId: 'mlxXMF' }
  );
});

test('解析飞书复制出的制表符数据和带换行的引号字段', () => {
  assert.deepEqual(parseTsv('A\tB\n1\t"两行\n文字"'), [['A', 'B'], ['1', '两行\n文字']]);
  assert.equal(extractHttps('素材：https://example.com/video.mp4'), 'https://example.com/video.mp4');
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(28), 'AC');
});

test('按日期读取并在允许发布列存在时过滤', async () => {
  const copied = [
    '素材链接\t产品类目\t产品型号\t发布时间\t允许发布',
    'https://example.com/a.mp4\t冰箱\tA\t2026/8/21\t是',
    'https://example.com/b.mp4\t洗衣机\tB\t2026/8/21\t否',
    'https://example.com/c.mp4\t空调\tC\t2026/8/22\t是'
  ].join('\n');
  const browser = { copySheet: async () => copied };
  const service = new FeishuService(browser);
  const result = await service.rowsForDate({
    sheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', columns
  }, '2026-08-21');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].model, 'A');
  assert.equal(result.allowColumnExists, true);
});

test('素材单元格复制为文件名时记录附件单元格而不要求网址', async () => {
  const browser = { copySheet: async () => '素材链接\t产品类目\t产品型号\t发布时间\n视频文件\t冰箱\tA\t2026-08-21' };
  const service = new FeishuService(browser);
  const result = await service.rowsForDate({
    sheetUrl: 'https://example.feishu.cn/sheets/token?sheet=sheet1', columns
  }, '2026-08-21');
  assert.equal(result.rows[0].materialLink, '');
  assert.equal(result.rows[0].materialText, '视频文件');
  assert.equal(result.rows[0].materialCell, 'A2');
  assert.deepEqual(result.rows[0].sourceMissing, []);
});
