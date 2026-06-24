import { parseDispatchRowsFromTableMatrix } from './parser.js';
import { logger } from './logger.js';

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.fill(value, { timeout: 3000 });
        return true;
      } catch (_) {
        // Try next selector.
      }
    }
  }
  return false;
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        await locator.click({ timeout: 3000 });
        return true;
      } catch (_) {
        // Try next selector.
      }
    }
  }
  return false;
}

async function tableMatrix(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('table')).map(table => {
      return Array.from(table.querySelectorAll('tr')).map(row => {
        return Array.from(row.querySelectorAll('th,td')).map(cell => (cell.innerText || '').trim());
      });
    });
  });
}

async function openWaitForPublish(page) {
  const clicked = await clickFirstVisible(page, [
    'a:has-text("待發文")',
    'text=待發文',
  ]);
  if (clicked) {
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    return;
  }
  logger.warn('wait-for-publish link not found; parsing current page');
}

export async function scrapeVitalOdDispatches(config) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    locale: 'zh-TW',
    timezoneId: config.timezone || 'Asia/Taipei',
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  try {
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const filledUser = await fillFirstVisible(page, [
      'input[name="username"]',
      'input[name="UserName"]',
      'input[name="account"]',
      'input[type="email"]',
      'input[type="text"]',
    ], config.username);
    const filledPassword = await fillFirstVisible(page, [
      'input[name="password"]',
      'input[name="Password"]',
      'input[type="password"]',
    ], config.password);
    if (filledUser && filledPassword) {
      await clickFirstVisible(page, [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("登入")',
        'text=登入',
      ]);
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    } else {
      logger.warn('login form not detected; continuing with current session/page');
    }

    await openWaitForPublish(page);
    const matrices = await tableMatrix(page);
    let sawEmptyDispatchTable = false;
    for (const matrix of matrices) {
      try {
        const records = parseDispatchRowsFromTableMatrix(matrix, { maxRecords: config.maxRecords });
        if (records.length > 0) return records;
        sawEmptyDispatchTable = true;
      } catch (err) {
        if (!String(err.message || '').startsWith('PARSE_HEADERS_MISSING')) throw err;
      }
    }
    if (sawEmptyDispatchTable) return [];
    throw new Error('PARSE_HEADERS_MISSING: wait-for-publish table not found after login');
  } finally {
    await context.close();
    await browser.close();
  }
}
