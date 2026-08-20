const path = require('node:path');
const { chromium } = require('playwright');
const { selectFileAtPosition } = require('../src/native-file-dialog');

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) throw new Error('请传入一张用于本地自检的 JPEG 或 PNG 路径');
  const helperPath = path.join(__dirname, '..', 'native', 'FileDialogHelper.exe');
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>原生文件窗口自检</title><input class="semi-upload" id="cover" type="file" accept="image/jpeg,image/png">');
    await page.bringToFront();
    const bounds = await page.locator('.semi-upload').boundingBox();
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    await selectFileAtPosition(helperPath, path.resolve(imagePath), {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height
    }, 15_000, '原生文件窗口自检');
    const selectedName = await page.locator('#cover').evaluate((input) => input.files?.[0]?.name || '');
    if (!selectedName) throw new Error('系统窗口已经关闭，但网页文件控件没有收到图片');
    console.log(`本地原生文件窗口自检通过：${selectedName}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
