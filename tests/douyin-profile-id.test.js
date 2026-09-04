const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractProfileApiRecords,
  mergeProfileRecords,
  selectProfileRecord
} = require('../src/douyin-profile-id');

test('从个人主页接口读取定时视频ID、文案和定时时间', () => {
  const payload = {
    aweme_list: [{
      aweme_id: '7677529618735271210',
      desc: '测试测试测试是 #测试  #视频  #发布',
      create_time: 1787665080,
      status: {
        review_result: {
          extra: JSON.stringify({
            bottom_status_desc: '定时发布中',
            bottom_status_detail: '作品将于**2026-08-25 21:38**发布',
            bottom_tool_text: '作品将于2026-08-25 21:38发布'
          })
        }
      }
    }]
  };
  const records = extractProfileApiRecords(payload);
  assert.equal(records[0].videoId, '7677529618735271210');
  assert.equal(records[0].scheduledLocal, '2026-08-25 21:38');
  assert.match(records[0].scheduleDetail, /定时发布中/);
  assert.equal(selectProfileRecord(records, '测试测试测试是', '2026-08-25 21:38').state, 'matched');
});

test('相同文案但定时时间不同不会误取ID', () => {
  const records = [
    { videoId: '1111111111111111111', body: '相同文案 #测试', scheduledLocal: '2026-08-25 20:38' },
    { videoId: '2222222222222222222', body: '相同文案 #测试', scheduledLocal: '2026-08-25 21:38' }
  ];
  const selected = selectProfileRecord(records, '相同文案', '2026-08-25 21:38');
  assert.equal(selected.state, 'matched');
  assert.equal(selected.record.videoId, '2222222222222222222');
});

test('接口记录覆盖只有标题没有时间的DOM链接记录', () => {
  const records = mergeProfileRecords(
    [{ videoId: '7677529618735271210', body: '完整文案', scheduledLocal: '2026-08-25 21:38', source: 'profile-api' }],
    [{ videoId: '7677529618735271210', body: '卡片文案', scheduledLocal: '', source: 'profile-link' }]
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].body, '完整文案');
  assert.equal(records[0].scheduledLocal, '2026-08-25 21:38');
});
