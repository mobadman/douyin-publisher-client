const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

(async () => {
  const root = path.join(__dirname, '..');
  const executablePath = process.argv[2] || process.env.SMOKE_EXECUTABLE || undefined;
  const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-publisher-ui-smoke-'));
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${smokeUserData}`, '--disable-gpu'],
    cwd: root,
    executablePath
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  if (!await page.locator('#accounts-main .card').count()) {
    const diagnostic = {
      status: await page.locator('#global-status').innerText().catch(() => ''),
      main: await page.locator('#accounts-main').innerText().catch(() => ''),
      test: await page.locator('#accounts-test').innerText().catch(() => ''),
      errors
    };
    throw new Error(`账号模块没有渲染：${JSON.stringify(diagnostic)}`);
  }
  assert.equal(await page.locator('[data-page]').count(), 3);
  await page.locator('[data-page="main"]').click();
  assert.equal(await page.locator('[data-page-panel="main"].active').count(), 1);
  assert.equal(await page.locator('[data-page-panel="main"] #accounts-test').count(), 0);
  assert.match(await page.locator('#accounts-main').innerText(), /发布账号/);
  assert.equal(await page.locator('#workspace-select option').count(), 3);
  assert.equal(await page.locator('#accounts-main .card').count(), 1);
  assert.equal(await page.locator('#create-plan').count(), 0);
  assert.equal(await page.locator('#create-plan-current-filter').count(), 1);
  assert.equal(await page.locator('#copy-id-table').count(), 1);
  const firstEdit = page.locator('[data-plan-edit]').first();
  if (await firstEdit.count() && await firstEdit.isEnabled()) {
    await firstEdit.click();
    assert.equal(await page.locator('#edit-plan-category').isVisible(), true);
    assert.equal(await page.locator('#edit-plan-model').isVisible(), true);
    await page.locator('#edit-plan-modal [data-close-modal]').first().click();
  }
  if (process.env.SMOKE_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'main.png'), fullPage: true });
  }
  await page.locator('[data-page="test"]').click();
  assert.equal(await page.getByRole('heading', { name: '测试工具' }).isVisible(), true);
  assert.match(await page.locator('#accounts-test').innerText(), /测试小号/);
  assert.equal(await page.locator('#test-platform option').count(), 2);
  assert.equal(await page.locator('#test-resolve-id').isVisible(), true);
  await page.locator('#test-platform').selectOption('wechat-channels');
  assert.match(await page.locator('#accounts-test').innerText(), /视频号测试账号/);
  assert.equal(await page.locator('#test-resolve-id').isHidden(), true);
  await page.locator('#test-platform').selectOption('douyin');
  if (process.env.SMOKE_SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'test-tools.png'), fullPage: true });
  }
  await page.locator('[data-page="settings"]').click();
  assert.equal(await page.locator('#guard-seconds').isVisible(), true);
  assert.equal(await page.locator('#settings-accounts .account-settings-card').count(), 4);
  assert.equal(await page.locator('#open-donation').isVisible(), true);
  const deletableCard = page.locator('#settings-accounts .account-settings-card').filter({ has: page.locator('[data-settings-account-action="delete"]:not([disabled])') }).first();
  if (await deletableCard.count()) {
    const accountName = await deletableCard.locator('[data-account-label]').inputValue();
    await deletableCard.locator('[data-settings-account-action="delete"]').click();
    assert.equal(await page.locator('#confirm-delete-account').isDisabled(), true);
    await page.locator('#delete-check').check();
    await page.locator('#delete-account-name').fill(accountName);
    await page.locator('#delete-confirm-phrase').fill('删除账号');
    assert.equal(await page.locator('#confirm-delete-account').isEnabled(), true);
    await page.locator('#delete-account-modal [data-close-modal]').first().click();
  }
  if (process.env.SMOKE_SCREENSHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'settings.png'), fullPage: true });
    await page.locator('#open-donation').click();
    await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'donation.png'), fullPage: true });
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  await application.close();
  process.stdout.write('正式版界面冒烟检查通过\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
