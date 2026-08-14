#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

const cache = new Map();
let uuidCounter = 0;
const SERVER_SECRET = 'server-secret-at-least-32-characters';
function toBuffer(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(Array.from(value || [], byte => byte < 0 ? byte + 256 : byte));
}
function base64WebSafe(value) {
  return toBuffer(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}
const context = {
  Date,
  JSON,
  String,
  Number,
  Error,
  CONFIG: { API_TOKEN: SERVER_SECRET, MAX_PAYLOAD_BYTES: 5 * 1024 * 1024 },
  Utilities: {
    Charset: { UTF_8: 'UTF-8' },
    getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
    formatDate: () => '2026-08-14 12:00:00',
    base64EncodeWebSafe: value => base64WebSafe(value),
    base64DecodeWebSafe: value => Array.from(
      Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    ),
    computeHmacSha256Signature: (value, key) => Array.from(
      crypto.createHmac('sha256', String(key)).update(String(value)).digest(),
    ),
    newBlob: bytes => ({ getDataAsString: () => toBuffer(bytes).toString('utf8') }),
  },
  CacheService: {
    getScriptCache: () => ({
      put: (key, value) => cache.set(key, value),
      get: key => cache.get(key) || null,
      remove: key => cache.delete(key),
    }),
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
  },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: text => ({
      text,
      setMimeType() { return this; },
    }),
  },
  Logger: { log: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({ setProperty: () => {} }),
  },
  sha256Hex_: value => `hash:${value}`,
  tz_: () => 'Asia/Taipei',
  checkAdminToken_: value => value === 'admin-secret',
  getAdminDashboardStatus_: () => ({ ok: true, route: 'admin' }),
  handleAdminDashboardAction_: () => ({ ok: true, route: 'admin-action' }),
  enqueueOfficialDocumentDispatches_: () => ({ ok: true, route: 'server' }),
  processOfficialDocumentQueue_: () => ({ ok: true, route: 'server-process' }),
  handleSubmission_: payload => {
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'publicSessionToken'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'apiToken'), false);
    return { ok: true, route: 'public' };
  },
  handleApprovalSubmission_: () => ({ ok: true, route: 'approve' }),
  handleDailyIncidentSubmission_: () => ({ ok: true }),
  updateDailyIncident_: () => ({ ok: true }),
  submitDailyIncidentForApproval_: () => ({ ok: true }),
  approveDailyIncident_: () => ({ ok: true }),
  submitDailyIncidentSupervisorComment_: () => ({ ok: true }),
  submitDailyWorkCheck_: () => ({ ok: true }),
  getDailyIncidentPeopleOptions_: () => ({ ok: true, people: ['A'] }),
  getLineMessageQuotaStatus_: () => ({ quota: 200 }),
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('apps-script/PublicSession.gs', 'utf8'), context, { filename: 'PublicSession.gs' });
vm.runInContext(fs.readFileSync('apps-script/Main.gs', 'utf8'), context, { filename: 'Main.gs' });

function post(payload) {
  const output = context.doPost({
    postData: { contents: JSON.stringify(payload) },
    parameter: {},
  });
  return JSON.parse(output.text);
}

function get(parameters) {
  const output = context.doGet({ parameter: parameters || {} });
  return JSON.parse(output.text);
}

const publicTicket = context.issuePublicSession_('submitChecklist');
assert.deepEqual(post({ publicSessionToken: publicTicket.publicSessionToken }), { ok: true, route: 'public' });
assert.equal(post({ publicSessionToken: publicTicket.publicSessionToken }).ok, false, '公開票證不可重放');

const legacy = post({ apiToken: SERVER_SECRET });
assert.equal(legacy.ok, false, '舊共享 token 不得再授權公開寫入');
assert.match(legacy.error, /操作票證/);

assert.deepEqual(post({ action: 'adminDashboardStatus', adminToken: 'admin-secret' }), { ok: true, route: 'admin' });
assert.equal(post({ action: 'adminDashboardStatus', adminToken: 'wrong' }).ok, false);

const peopleTicket = get({ api: 'publicSession', scope: 'dailyIncidentPeople' });
assert.equal(peopleTicket.ok, true, 'doGet 應能核發允許的公開 scope');
assert.deepEqual(get({
  api: 'dailyIncidentPeople',
  publicSessionToken: peopleTicket.publicSessionToken,
}), { ok: true, people: ['A'] });
assert.equal(get({
  api: 'dailyIncidentPeople',
  publicSessionToken: peopleTicket.publicSessionToken,
}).ok, false, 'dailyIncidentPeople 票證不可重放');

assert.equal(get({
  api: 'admin',
  action: 'lineQuotaStatus',
  token: SERVER_SECRET,
}).ok, false, '舊 API token 不得授權 admin GET');
assert.deepEqual(get({
  api: 'admin',
  action: 'lineQuotaStatus',
  adminToken: 'admin-secret',
}), { ok: true, action: 'lineQuotaStatus', quota: 200 });

assert.deepEqual(post({
  action: 'enqueueOfficialDocuments',
  apiToken: SERVER_SECRET,
  adminToken: 'admin-secret',
}), { ok: true, route: 'server' });
assert.equal(post({
  action: 'enqueueOfficialDocuments',
  apiToken: 'known-old-token',
  adminToken: 'admin-secret',
}).ok, false, 'Cloud Run 路徑需正確伺服器 token');

const adminTicket = context.issuePublicSession_('submitChecklist');
assert.equal(post({
  action: 'adminDashboardStatus',
  publicSessionToken: adminTicket.publicSessionToken,
}).ok, false, '公開票證不得授權管理路徑');

console.log('Main auth routing tests passed.');
