#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

const password = 'dashboard-test-password';
const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
const loginFailureProperty = 'ADMIN_DASHBOARD_LOGIN_FAILURES_V1';
const properties = new Map();
let uuidCounter = 0;
let lockAllowed = true;

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
  CONFIG: { ADMIN_DASHBOARD_PASSWORD_SHA256: passwordHash },
  LockService: {
    getScriptLock: () => ({ tryLock: () => lockAllowed, releaseLock: () => {} }),
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => properties.get(key) || '',
      setProperty: (key, value) => properties.set(key, String(value)),
      deleteProperty: key => properties.delete(key),
    }),
  },
  Utilities: {
    Charset: { UTF_8: 'UTF-8' },
    base64EncodeWebSafe: value => base64WebSafe(value),
    base64DecodeWebSafe: value => Array.from(
      Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    ),
    newBlob: bytes => ({ getDataAsString: () => toBuffer(bytes).toString('utf8') }),
    computeHmacSha256Signature: (value, key) => Array.from(
      crypto.createHmac('sha256', String(key)).update(String(value)).digest(),
    ),
  },
  sha256Hex_: value => crypto.createHash('sha256').update(String(value)).digest('hex'),
  uuid_: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
  checkAdminToken_: value => value === 'server-admin-token',
};

vm.createContext(context);
const source = fs.readFileSync('apps-script/AdminDashboard.gs', 'utf8');
const end = source.indexOf('\nfunction getAdminDashboardStatus_');
assert(end > 0, 'dashboard auth helper boundary not found');
vm.runInContext(source.slice(0, end), context, { filename: 'AdminDashboard.auth.gs' });

assert.equal(context.checkAdminDashboardPassword_(password), true);
assert.equal(context.checkAdminDashboardPassword_('wrong'), false);

const login = context.handleAdminDashboardLogin_(password);
assert.equal(login.ok, true);
assert.match(login.adminSessionToken, /^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
assert.doesNotThrow(() => context.assertAdminDashboardSessionToken_(login.adminSessionToken));
assert.equal(
  context.assertAdminDashboardCredential_({ adminSessionToken: login.adminSessionToken }),
  'session',
);

const decodedPayload = JSON.parse(
  Buffer.from(login.adminSessionToken.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
);
assert.equal(decodedPayload.t, 'dashboard-session');
assert.equal(Object.prototype.hasOwnProperty.call(decodedPayload, 'password'), false);

context.CONFIG.ADMIN_DASHBOARD_PASSWORD_SHA256 = crypto.createHash('sha256').update('rotated-password').digest('hex');
assert.throws(
  () => context.assertAdminDashboardSessionToken_(login.adminSessionToken),
  /未授權/,
  '密碼變更後既有 session 必須立即失效',
);
context.CONFIG.ADMIN_DASHBOARD_PASSWORD_SHA256 = passwordHash;

const tampered = login.adminSessionToken.slice(0, -1) + (login.adminSessionToken.endsWith('0') ? '1' : '0');
assert.throws(() => context.assertAdminDashboardSessionToken_(tampered), /未授權/);

const expiredPayload = Object.assign({}, decodedPayload, { e: Math.floor(Date.now() / 1000) - 1 });
const expiredEncoded = base64WebSafe(JSON.stringify(expiredPayload)).replace(/=+$/g, '');
const expiredToken = expiredEncoded + '.' + context.adminDashboardSessionSignature_(expiredEncoded);
assert.throws(() => context.assertAdminDashboardSessionToken_(expiredToken), /已過期/);

assert.equal(
  context.assertAdminDashboardCredential_({ adminToken: 'server-admin-token' }),
  'adminToken',
  '伺服器長密鑰必須繼續可用',
);
assert.throws(() => context.assertAdminDashboardCredential_({}), /未授權/);

context.clearAdminDashboardLoginFailures_();
for (let index = 0; index < 10; index++) {
  assert.throws(() => context.handleAdminDashboardLogin_('wrong'), /未授權/);
}
assert.throws(
  () => context.handleAdminDashboardLogin_(password),
  /未授權/,
  '連續錯誤後應短暫停止所有登入嘗試',
);
const persistedFailures = JSON.parse(
  properties.get(loginFailureProperty),
);
assert.equal(persistedFailures.count, 10, '錯誤次數必須持久保存');

properties.set(
  loginFailureProperty,
  JSON.stringify({ count: 10, expiresAt: Math.floor(Date.now() / 1000) - 1 }),
);
assert.doesNotThrow(
  () => context.handleAdminDashboardLogin_(password),
  '限制視窗逾期後應允許正確密碼登入',
);

context.clearAdminDashboardLoginFailures_();
assert.doesNotThrow(() => context.handleAdminDashboardLogin_(password));

context.CONFIG.ADMIN_DASHBOARD_PASSWORD_SHA256 = '';
assert.equal(context.checkAdminDashboardPassword_(''), false);
assert.throws(() => context.handleAdminDashboardLogin_(password), /未授權/);
context.CONFIG.ADMIN_DASHBOARD_PASSWORD_SHA256 = passwordHash;
context.clearAdminDashboardLoginFailures_();

lockAllowed = false;
assert.throws(
  () => context.handleAdminDashboardLogin_(password),
  /稍後再試/,
  '無法取得登入鎖時必須 fail-closed',
);
lockAllowed = true;

const frontendSource = fs.readFileSync('js/dashboard.js', 'utf8');
assert.equal(/localStorage|sessionStorage|indexedDB/.test(frontendSource), false, '中控台不得持久儲存密碼或 session');
assert.equal(frontendSource.includes('state.adminToken'), false, '前端不得再保留長 admin token');

console.log('Admin dashboard session auth tests passed.');
