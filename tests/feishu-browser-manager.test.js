const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FeishuBrowserManager,
  normalizeClipboardText,
  choosePreviewDownloadCandidate,
  choosePreviewCloseCandidate
} = require('../src/feishu-browser-manager');

test('统一飞书剪贴板换行并去除首尾空白', () => {
  assert.equal(normalizeClipboardText('\uFEFFA\tB\r\n1\t2\r\n'), 'A\tB\n1\t2');
});

test('预览窗按右上角布局选择从右数第二个下载按钮', () => {
  const fullscreen = { x: 700, y: 110, width: 30, height: 30 };
  const download = { x: 740, y: 110, width: 30, height: 30 };
  const close = { x: 780, y: 110, width: 30, height: 30 };
  const play = { x: 470, y: 350, width: 60, height: 60 };
  assert.equal(
    choosePreviewDownloadCandidate(
      { x: 190, y: 90, width: 640, height: 500 },
      [fullscreen, download, close, play]
    ),
    download
  );
  assert.equal(
    choosePreviewCloseCandidate(
      { x: 190, y: 90, width: 640, height: 500 },
      [fullscreen, download, close, play]
    ),
    close
  );
});

test('表格逐格定位只发送方向键事件，不操作任何输入框', async () => {
  const events = [];
  const manager = new FeishuBrowserManager('unused');
  const page = {
    context: () => ({
      newCDPSession: async () => ({
        send: async (_method, payload) => events.push(payload),
        detach: async () => {}
      })
    })
  };
  await manager.pressMany(page, 'ArrowDown', 3);
  assert.deepEqual(events.map((event) => event.type), ['keyDown', 'keyUp', 'keyDown', 'keyUp', 'keyDown', 'keyUp']);
  assert.ok(events.every((event) => event.key === 'ArrowDown'));
});

test('附件打开前后都核对同名素材', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'feishu-browser-manager.js'),
    'utf8'
  );
  assert.match(source, /selectedText\.includes\(attachmentName\)/);
  assert.match(source, /findAttachmentPreview\(page, overlaySelector, attachmentName\)/);
  assert.match(source, /为避免误点筛选，流程已停止/);
  assert.match(source, /readSelectedCellAddress/);
  assert.match(source, /actualCell/);
});

test('自动筛选直接定位发布时间表头右侧的筛选控件', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'feishu-browser-manager.js'), 'utf8'
  );
  assert.match(source, /getByText\(publishDateHeader, \{ exact: true \}\)/);
  assert.match(source, /filterControl\.click/);
  assert.doesNotMatch(source, /Alt\+ArrowDown/);
});
