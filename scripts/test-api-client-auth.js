#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const requests = [];
let sessionCounter = 0;
let retrySubmissionRejected = false;
let peopleResponseFailed = false;
const context = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  URL,
  Date,
  Math,
  TextEncoder,
  crypto: require('crypto').webcrypto,
  fetch: async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url, options, api: parsed.searchParams.get('api') || '' });
    if (parsed.searchParams.get('api') === 'publicSession') {
      sessionCounter += 1;
      const issuedSession = sessionCounter;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          publicSessionToken: `session-${issuedSession}`,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        }),
      };
    }
    if (parsed.searchParams.get('api') === 'branding') {
      return { ok: true, json: async () => ({ ok: true, organizationName: 'ISHA' }) };
    }
    if (parsed.searchParams.get('api') === 'dailyIncidentPeople') {
      if (!peopleResponseFailed) {
        peopleResponseFailed = true;
        return { ok: true, json: async () => { throw new Error('transient html response'); } };
      }
      return { ok: true, json: async () => ({ ok: true, people: [] }) };
    }
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.equipmentId === 'RETRY-TICKET' && !retrySubmissionRejected) {
        retrySubmissionRejected = true;
        return { ok: true, json: async () => ({ ok: false, error: '操作票證無效或已逾時' }) };
      }
    }
    return { ok: true, json: async () => ({ ok: true }) };
  },
};
context.window = {
  crypto: context.crypto,
  SYSTEM_CONFIG: { API_BASE: 'https://example.test/exec' },
  location: { pathname: '/auto-checklist/daily.html' },
};
context.document = {
  readyState: 'complete',
  querySelectorAll: () => [],
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/api.js', 'utf8'), context, { filename: 'js/api.js' });

(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await context.window.API.submit({ formType: 'daily', equipmentId: 'TEST-1' });
  const firstPost = requests.find(request => request.options.method === 'POST');
  assert(firstPost, '公開填報應送出 POST');
  const firstBody = JSON.parse(firstPost.options.body);
  assert.equal(firstBody.publicSessionToken, 'session-1', '應使用預先取得的短效票證');
  assert.equal(Object.prototype.hasOwnProperty.call(firstBody, 'apiToken'), false, '不得傳送共享 API token');

  await context.window.API.submit({ formType: 'daily', equipmentId: 'TEST-2' });
  const posts = requests.filter(request => request.options.method === 'POST');
  assert.equal(JSON.parse(posts[1].options.body).publicSessionToken, 'session-2', '第二次送出必須取得新票證');

  const sessionsBeforeAdmin = sessionCounter;
  const loginResult = await context.window.API.adminDashboardLogin('dashboard-password');
  assert.equal(loginResult.ok, true);
  const loginPost = requests.filter(request => request.options.method === 'POST').pop();
  const loginBody = JSON.parse(loginPost.options.body);
  assert.equal(loginBody.password, 'dashboard-password');
  assert.equal(Object.prototype.hasOwnProperty.call(loginBody, 'publicSessionToken'), false);

  await context.window.API.adminDashboardStatus('dashboard-session', { snapshotOnly: true });
  assert.equal(sessionCounter, sessionsBeforeAdmin, '管理查詢不得取得公開票證');
  const adminPost = requests.filter(request => request.options.method === 'POST').pop();
  const adminBody = JSON.parse(adminPost.options.body);
  assert.equal(adminBody.adminSessionToken, 'dashboard-session');
  assert.equal(Object.prototype.hasOwnProperty.call(adminBody, 'adminToken'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(adminBody, 'password'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(adminBody, 'publicSessionToken'), false);

  const sessionsBeforeRetry = sessionCounter;
  const retryResult = await context.window.API.submit({ formType: 'daily', equipmentId: 'RETRY-TICKET' });
  assert.equal(retryResult.ok, true, '票證拒絕後應自動重取並安全重送一次');
  assert.equal(sessionCounter, sessionsBeforeRetry + 2, '票證重試的兩次 POST 必須使用不同票證');

  const sessionsBeforePeople = sessionCounter;
  const peopleResult = await context.window.API.dailyIncidentPeople();
  assert.equal(peopleResult.ok, true);
  assert.equal(sessionCounter, sessionsBeforePeople + 2, '唯讀 GET 重試時必須重新核發票證');
  const peopleRequests = requests.filter(request => request.api === 'dailyIncidentPeople');
  assert.notEqual(
    new URL(peopleRequests[0].url).searchParams.get('publicSessionToken'),
    new URL(peopleRequests[1].url).searchParams.get('publicSessionToken'),
  );

  const sessionsBeforeConcurrent = sessionCounter;
  await Promise.all([
    context.window.API.submit({ formType: 'daily', equipmentId: 'CONCURRENT-1' }),
    context.window.API.submit({ formType: 'daily', equipmentId: 'CONCURRENT-2' }),
  ]);
  assert.equal(sessionCounter, sessionsBeforeConcurrent + 2, '並行公開送出不得共用同一張票證');
  const concurrentPosts = requests.filter(request => {
    if (request.options.method !== 'POST') return false;
    const equipmentId = JSON.parse(request.options.body).equipmentId;
    return /^CONCURRENT-/.test(String(equipmentId || ''));
  });
  assert.notEqual(
    JSON.parse(concurrentPosts[0].options.body).publicSessionToken,
    JSON.parse(concurrentPosts[1].options.body).publicSessionToken,
  );

  console.log('API client auth tests passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
