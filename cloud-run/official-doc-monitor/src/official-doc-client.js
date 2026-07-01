import { buildDocumentKey, parseDispatchRowsFromTableMatrix, parseHandler } from './parser.js';
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
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let i = 0; i < Math.min(count, 12); i += 1) {
      const candidate = locator.nth(i);
      try {
        await candidate.click({ timeout: 3000 });
        return true;
      } catch (_) {
        // Try next matching element/selector.
      }
    }
  }
  return false;
}

async function hasFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      try {
        if (await locator.isVisible({ timeout: 1000 })) return true;
      } catch (_) {
        // Try next selector.
      }
    }
  }
  return false;
}

async function waitAfterLoginStep(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
}

function safeUrlForLog(value) {
  try {
    const url = new URL(String(value || ''));
    return `${url.origin}${url.pathname}`;
  } catch (_) {
    return '';
  }
}

async function submitContinueFormIfPresent(page) {
  const locator = page.locator('button:has-text("Continue"), button:has-text("繼續")').first();
  if (!(await locator.count())) return false;
  try {
    await locator.click({ timeout: 5000, force: true, noWaitAfter: true });
  } catch (_) {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find(item => /Continue|繼續/.test(item.innerText || ''));
      const form = button ? button.closest('form') : null;
      if (form) form.submit();
    }).catch(() => {});
  }
  await page.waitForURL(url => !String(url).includes('member.gsscloud.com/cas/login'), {
    timeout: 30000,
  }).catch(() => {});
  await waitAfterLoginStep(page);
  return true;
}

async function logPageStep(page, step) {
  logger.info('login step', {
    step,
    url: safeUrlForLog(page.url()),
    title: await page.title().catch(() => ''),
  });
}

function hiddenInputValue(html, name) {
  const pattern = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`);
  const match = String(html || '').match(pattern);
  return match ? match[1] : '';
}

function pageTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

async function requestText(response) {
  try {
    return await response.text();
  } catch (_) {
    return '';
  }
}

async function loginViaCasRequest(context, config) {
  const request = context.request;
  let response = await request.get(config.targetUrl, {
    failOnStatusCode: false,
    maxRedirects: 20,
  });
  let html = await requestText(response);
  let loginUrl = response.url();
  if (!String(loginUrl).includes('member.gsscloud.com/cas/login')) {
    logger.info('cas request login skipped', { url: safeUrlForLog(loginUrl), title: pageTitle(html) });
    return true;
  }

  response = await request.post(loginUrl, {
    failOnStatusCode: false,
    maxRedirects: 20,
    form: {
      username: config.username,
      execution: hiddenInputValue(html, 'execution'),
      _eventId: hiddenInputValue(html, '_eventId'),
    },
  });
  html = await requestText(response);
  logger.info('cas request login step', { step: 'username', url: safeUrlForLog(response.url()), title: pageTitle(html) });

  response = await request.post(response.url(), {
    failOnStatusCode: false,
    maxRedirects: 20,
    form: {
      username: config.username,
      password: config.password,
      execution: hiddenInputValue(html, 'execution'),
      _eventId: hiddenInputValue(html, '_eventId'),
      geolocation: '',
    },
  });
  html = await requestText(response);
  logger.info('cas request login step', { step: 'password', url: safeUrlForLog(response.url()), title: pageTitle(html) });

  if (/Authentication Succeeded|登入成功/.test(pageTitle(html))) {
    response = await request.post(new URL('/cas/login', response.url()).href, {
      failOnStatusCode: false,
      maxRedirects: 20,
      form: {
        execution: hiddenInputValue(html, 'execution'),
        _eventId: hiddenInputValue(html, '_eventId'),
      },
    });
    html = await requestText(response);
    logger.info('cas request login step', { step: 'continue', url: safeUrlForLog(response.url()), title: pageTitle(html) });
  }
  return !String(response.url()).includes('member.gsscloud.com/cas/login');
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

function firstValue(row, names) {
  for (const name of names) {
    const value = row && row[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function cleanGridValue(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapKendoRows(rows, maxRecords) {
  const parsed = [];
  for (const row of rows || []) {
    const handlerRaw = cleanGridValue(firstValue(row, [
      'CaseHandlingUserName',
      'HandlingUserName',
      'HandlingUser',
      'HandlerName',
      'Handler',
      'CaseOfficer',
      'UserName',
      'CreateUserName',
    ]));
    const realDepartment = cleanGridValue(firstValue(row, [
      'CaseHandlingRealDepartmentName',
      'RealDepartmentName',
    ]));
    const parsedHandler = parseHandler(realDepartment ? `${handlerRaw}(${realDepartment})` : handlerRaw);
    const record = {
      outboundNo: cleanGridValue(firstValue(row, [
        'OutboundWordNumber',
        'SendDocNumber',
        'SendNumber',
        'OutgoingDocNumber',
        'OutboundNo',
        'OutboundNumber',
      ])),
      documentNo: cleanGridValue(firstValue(row, [
        'DocNumber',
        'DocumentNo',
        'DocumentNumber',
        'CaseNumber',
      ])),
      handler: realDepartment ? `${handlerRaw}(${realDepartment})` : handlerRaw,
      handlerName: parsedHandler.name,
      unit: cleanGridValue(firstValue(row, [
        'CaseHandlingDepartmentName',
        'HandlingUnitName',
        'HandlingUnit',
        'UnitName',
        'DepartmentName',
        'CompName',
      ])) || parsedHandler.unit,
      dueDate: cleanGridValue(firstValue(row, [
        'Deadline',
        'LimitDate',
        'DueDate',
        'ProcessEndDate',
        'EndDate',
      ])),
    };
    if (!record.handlerName || (!record.documentNo && !record.outboundNo)) continue;
    record.documentKey = buildDocumentKey(record);
    parsed.push(record);
    if (parsed.length >= maxRecords) break;
  }
  return parsed;
}

async function parseKendoGridRows(page, opts = {}) {
  const maxRecords = Number(opts.maxRecords || 50);
  const result = await page.evaluate(async (limit) => {
    const gridEl = document.querySelector('[data-role="grid"]');
    if (!gridEl) return { sawGrid: false, rows: [], total: 0 };
    const $ = window.jQuery;
    const grid = $ && $(gridEl).data('kendoGrid');
    const toPlain = item => (item && typeof item.toJSON === 'function' ? item.toJSON() : item);
    const localRows = grid && grid.dataSource
      ? Array.from((grid.dataSource.view && grid.dataSource.view().length ? grid.dataSource.view() : grid.dataSource.data()) || [])
      : [];
    if (localRows.length > 0) {
      const total = grid && grid.dataSource && typeof grid.dataSource.total === 'function'
        ? Number(grid.dataSource.total() || localRows.length)
        : localRows.length;
      return { sawGrid: true, rows: localRows.slice(0, limit).map(toPlain), total };
    }

    const url = gridEl.getAttribute('data-speed-url');
    if (!url) return { sawGrid: true, rows: [], total: 0 };
    const form = gridEl.closest('form') || document;
    const token = form.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
    const params = new URLSearchParams({
      __RequestVerificationToken: token,
      page: '1',
      pageSize: String(limit),
      skip: '0',
      take: String(limit),
    });
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: params.toString(),
    });
    if (!response.ok) {
      throw new Error(`KENDO_GRID_HTTP_${response.status}`);
    }
    const json = await response.json().catch(() => null);
    return {
      sawGrid: true,
      rows: Array.isArray(json && json.Data) ? json.Data.slice(0, limit) : [],
      total: Number((json && json.Total) || 0),
    };
  }, maxRecords).catch(err => ({
    sawGrid: false,
    rows: [],
    total: 0,
    error: String(err && err.message ? err.message : err),
  }));

  return {
    sawGrid: Boolean(result.sawGrid),
    records: mapKendoRows(result.rows || [], maxRecords),
    total: Number(result.total || 0),
    error: result.error || '',
  };
}

async function pageDiagnostics(page, observedResponses = []) {
  const dom = await page.evaluate(() => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const safeLocation = (() => {
      try {
        return `${location.origin}${location.pathname}`;
      } catch (_) {
        return '';
      }
    })();
    return {
      url: safeLocation,
      title: document.title,
      inputs: Array.from(document.querySelectorAll('input')).slice(0, 20).map(input => ({
        name: clean(input.getAttribute('name')),
        type: clean(input.getAttribute('type')),
        placeholder: clean(input.getAttribute('placeholder')),
      })),
      linkCount: document.querySelectorAll('a').length,
      tableHeaders: Array.from(document.querySelectorAll('table')).slice(0, 5).map(table => (
        Array.from(table.querySelectorAll('th')).slice(0, 20).map(th => clean(th.innerText))
      )),
      kendoSamples: (() => {
        const $ = window.jQuery;
        if (!$) return [];
        return Array.from(document.querySelectorAll('[data-role="grid"]')).slice(0, 3).map(gridEl => {
          const grid = $(gridEl).data('kendoGrid');
          const raw = grid && grid.dataSource ? grid.dataSource.data() : [];
          const keys = Array.from(raw || []).slice(0, 3).map(item => {
            const row = item && typeof item.toJSON === 'function' ? item.toJSON() : item;
            return Object.keys(row || {}).slice(0, 80);
          });
          return {
            rowCount: raw ? raw.length : 0,
            total: grid && grid.dataSource && typeof grid.dataSource.total === 'function'
              ? Number(grid.dataSource.total() || 0)
              : 0,
            keys,
          };
        });
      })(),
    };
  });
  return { ...dom, observedResponses: observedResponses.slice(-60) };
}

async function completeLoginIfNeeded(page, config) {
  const usernameSelectors = [
    'input[name="username"]:not([type="hidden"])',
    'input[name="UserName"]',
    'input[name="account"]',
    'input[type="email"]',
    'input[type="text"]',
  ];
  const passwordSelectors = [
    'input[name="password"]',
    'input[name="Password"]',
    'input[type="password"]',
  ];
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Next")',
    'button:has-text("Log in")',
    'button:has-text("登入")',
    'text=登入',
  ];

  let filledUser = false;
  if (await hasFirstVisible(page, usernameSelectors)) {
    filledUser = await fillFirstVisible(page, usernameSelectors, config.username);
    if (filledUser && !(await hasFirstVisible(page, passwordSelectors))) {
      await clickFirstVisible(page, submitSelectors);
      await waitAfterLoginStep(page);
      await logPageStep(page, 'after username submit');
    }
  }

  const filledPassword = await fillFirstVisible(page, passwordSelectors, config.password);
  if (filledPassword) {
    await clickFirstVisible(page, submitSelectors);
    await waitAfterLoginStep(page);
    await logPageStep(page, 'after password submit');
    const continued = await submitContinueFormIfPresent(page);
    if (continued) await logPageStep(page, 'after continue submit');
    return true;
  }

  if (filledUser) {
    logger.warn('username submitted but password form not detected');
    return false;
  }

  logger.warn('login form not detected; continuing with current session/page');
  return false;
}

async function openWaitForPublish(page, config) {
  if (page.url() === 'about:blank' || !page.url().includes('od.vitalyun.com')) {
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }

  const waitForGrid = async (timeout = 20000) => {
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => {
      const $ = window.jQuery;
      const grid = $ && $('[data-role="grid"]').first().data('kendoGrid');
      return Boolean(grid && grid.dataSource);
    }, { timeout }).catch(() => {});
  };

  const waitForPublishLinks = await page.evaluate(() => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const seen = new Set();
    return Array.from(document.querySelectorAll('a'))
      .map(anchor => ({
        text: clean(anchor.innerText || anchor.textContent),
        href: anchor.href || '',
      }))
      .filter(link => link.href && (
        link.text.includes('待發文')
        || link.href.includes('/Outbound/WaitForPublish/OutboundOfWaitForPublish/')
      ))
      .filter(link => {
        if (seen.has(link.href)) return false;
        seen.add(link.href);
        return true;
      })
      .sort((a, b) => {
        const score = link => {
          if (/^待發文\d*$/.test(link.text)) return 0;
          if (link.text.includes('待發文')) return 1;
          return 2;
        };
        return score(a) - score(b);
      })
      .slice(0, 6);
  }).catch(() => []);

  for (const link of waitForPublishLinks) {
    try {
      logger.info('opening dynamic wait-for-publish link', {
        text: link.text,
        url: safeUrlForLog(link.href),
      });
      await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await waitForGrid();
      return;
    } catch (err) {
      logger.warn('dynamic wait-for-publish link failed; trying next candidate', {
        text: link.text,
        url: safeUrlForLog(link.href),
        error: String(err && err.message ? err.message : err).slice(0, 300),
      });
      await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }
  }

  if (config.waitForPublishUrl) {
    logger.warn('falling back to configured wait-for-publish URL; dynamic link not found', {
      url: safeUrlForLog(config.waitForPublishUrl),
    });
    const clicked = await clickFirstVisible(page, [
      'a:has-text("待發文")',
      'text=待發文',
    ]);
    if (clicked) {
      await waitForGrid();
      return;
    }
    await page.goto(config.waitForPublishUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForGrid();
    return;
  }

  const clicked = await clickFirstVisible(page, [
    'a:has-text("待發文")',
    'text=待發文',
  ]);
  if (clicked) {
    await waitForGrid();
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
  const observedResponses = [];
  page.on('response', response => {
    try {
      const url = new URL(response.url());
      if (url.hostname !== 'od.vitalyun.com') return;
      if (!/\/(Outbound|api|Home|Inbound|CaseHandling)\//.test(url.pathname)) return;
      observedResponses.push(`${response.status()} ${url.pathname}`);
    } catch (_) {
      // Ignore malformed URLs.
    }
  });
  try {
    const requestLoginOk = await loginViaCasRequest(context, config).catch(err => {
      logger.warn('cas request login failed; falling back to browser login', {
        error: String(err && err.message ? err.message : err).slice(0, 300),
      });
      return false;
    });

    await openWaitForPublish(page, config);
    if (!requestLoginOk || String(page.url()).includes('member.gsscloud.com/cas/login')) {
      await completeLoginIfNeeded(page, config);
      await openWaitForPublish(page, config);
    }
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
    const kendoResult = await parseKendoGridRows(page, { maxRecords: config.maxRecords });
    if (kendoResult.sawGrid && !kendoResult.error) {
      logger.info('kendo grid parsed', {
        total: kendoResult.total,
        recordCount: kendoResult.records.length,
      });
    }
    if (kendoResult.records.length > 0) return kendoResult.records;
    if (kendoResult.sawGrid && !kendoResult.error) {
      if (kendoResult.total > 0) {
        logger.warn('wait-for-publish diagnostics', await pageDiagnostics(page, observedResponses));
        throw new Error(`KENDO_GRID_ROWS_UNMAPPED: total=${kendoResult.total}`);
      }
      return [];
    }
    logger.warn('wait-for-publish diagnostics', await pageDiagnostics(page, observedResponses));
    throw new Error('PARSE_HEADERS_MISSING: wait-for-publish table not found after login');
  } finally {
    await context.close();
    await browser.close();
  }
}
