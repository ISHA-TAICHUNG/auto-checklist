#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('Checklist browser test skipped: install Playwright or set PLAYWRIGHT_MODULE.');
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const meta = {
  equipment: {
    equipmentId: 'FORK-LJ-A',
    equipmentName: '堆高機 A 號',
    category: '堆高機',
    machineSerial: '',
    machineType: '',
    location: '龍井教室',
  },
  template: {
    templateId: 'TEST',
    templateName: '測試檢點表',
    resultOptions: ['V', '/', 'X'],
    monthlySchema: 'simple',
    rule: '請逐項確認',
  },
  items: [{ order: 1, name: '煞車與控制', method: '操作測試' }],
};

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  });
  try {
    for (const pageName of ['daily', 'monthly']) {
      const page = await browser.newPage();
      const errors = [];
      let bootstrapCalls = 0;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://script.google.com/**', route => {
        const api = new URL(route.request().url()).searchParams.get('api');
        let response = { ok: true };
        if (api === 'branding') response = { ok: true, organizationName: '測試機構' };
        if (api === 'publicSession') {
          response = { ok: true, publicSessionToken: 'test-ticket', expiresAt: new Date(Date.now() + 60000).toISOString() };
        }
        if (api === 'checklistBootstrap') {
          bootstrapCalls += 1;
          response = bootstrapCalls === 1
            ? { ok: false, error: '異常紀錄讀取失敗' }
            : { ok: true, meta, locked: [{ order: 1, status: '處理中', reportDate: '2026-09-28' }] };
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(response),
        });
      });

      const url = pathToFileURL(path.join(root, `${pageName}.html`)).href + '?eqp=FORK-LJ-A';
      await page.goto(url);
      await page.getByRole('button', { name: '重新載入檢點表' }).waitFor();
      assert.match(await page.locator('#content').innerText(), /異常紀錄讀取失敗/);
      assert.equal(await page.locator('input[type="radio"]').count(), 0, '鎖定資料失敗不得顯示可填選項');

      await page.getByRole('button', { name: '重新載入檢點表' }).click();
      await page.getByText('檢查項目（1 項）').waitFor();
      assert.equal(bootstrapCalls, 2, '重試應重新取得完整啟動資料');
      assert.equal(await page.locator('.item-locked').count(), 1, '未結案異常應維持鎖定');
      assert.equal(errors.length, 0, `頁面不得有 JavaScript 錯誤：${errors.join('; ')}`);
      await page.close();
    }
    console.log('Checklist loading browser tests passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
