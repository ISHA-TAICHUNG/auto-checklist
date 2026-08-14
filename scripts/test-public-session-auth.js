#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

const cache = new Map();
let now = Date.parse('2026-08-14T00:00:00.000Z');
let uuidCounter = 0;
let cacheWrites = 0;
let lockAvailable = true;

function toBuffer(value) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return Buffer.from(Array.from(value || [], byte => byte < 0 ? byte + 256 : byte));
}

function base64WebSafe(value) {
  return toBuffer(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64WebSafe(value) {
  return Array.from(Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

const context = {
  Date: class extends Date {
    constructor(value) { super(value === undefined ? now : value); }
    static now() { return now; }
  },
  JSON,
  String,
  Number,
  Error,
  CONFIG: { API_TOKEN: 'server-signing-secret-at-least-32-characters' },
  Utilities: {
    Charset: { UTF_8: 'UTF-8' },
    getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
    base64EncodeWebSafe: value => base64WebSafe(value),
    base64DecodeWebSafe: value => decodeBase64WebSafe(value),
    computeHmacSha256Signature: (value, key) => Array.from(
      crypto.createHmac('sha256', String(key)).update(String(value)).digest(),
    ),
    newBlob: bytes => ({ getDataAsString: () => toBuffer(bytes).toString('utf8') }),
  },
  CacheService: {
    getScriptCache: () => ({
      put: (key, value) => { cacheWrites += 1; cache.set(key, value); },
      get: key => cache.get(key) || null,
      remove: key => cache.delete(key),
    }),
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => lockAvailable, releaseLock: () => {} }),
  },
  sha256Hex_: value => `hash:${value}`,
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync('apps-script/PublicSession.gs', 'utf8'),
  context,
  { filename: 'PublicSession.gs' },
);

const issued = context.issuePublicSession_('submitDailyIncident');
assert.equal(issued.ok, true);
assert.equal(issued.scope, 'submitDailyIncident');
assert.equal(cacheWrites, 0, '核發簽章票證不得寫入共用 cache');
assert.equal(context.consumePublicSession_(issued.publicSessionToken, 'submitDailyIncident'), true);
assert.equal(cacheWrites, 1, '成功使用後才記錄 nonce');
assert.equal(context.consumePublicSession_(issued.publicSessionToken, 'submitDailyIncident'), false, '票證不可重放');

const wrongScope = context.issuePublicSession_('approveRecord');
assert.equal(context.consumePublicSession_(wrongScope.publicSessionToken, 'submitChecklist'), false, '票證必須綁定 action');
assert.equal(context.consumePublicSession_(wrongScope.publicSessionToken, 'approveRecord'), true, '錯誤 scope 不得消耗有效票證');

const expired = context.issuePublicSession_('submitChecklist');
now += 11 * 60 * 1000;
assert.equal(context.consumePublicSession_(expired.publicSessionToken, 'submitChecklist'), false, '逾時票證必須拒絕');

const forged = context.issuePublicSession_('submitChecklist').publicSessionToken.replace(/.$/, 'A');
assert.equal(context.consumePublicSession_(forged, 'submitChecklist'), false, '竄改簽章必須拒絕');

const lockTicket = context.issuePublicSession_('submitChecklist');
lockAvailable = false;
assert.throws(
  () => context.consumePublicSession_(lockTicket.publicSessionToken, 'submitChecklist'),
  /系統忙碌，請稍後再試/,
);
lockAvailable = true;

assert.throws(() => context.issuePublicSession_('adminDashboardAction'), /不支援的公開操作/);
assert.equal(context.publicSubmissionScope_({}), 'submitChecklist');
assert.equal(context.publicSubmissionScope_({ action: 'approveRecord' }), 'approveRecord');

console.log('Public session auth tests passed.');
