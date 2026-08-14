#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('apps-script/Config.gs', 'utf8');
const functionSource = source.slice(
  source.indexOf('function checkAdminToken_'),
  source.indexOf('/**\n * 破壞性動作', source.indexOf('function checkAdminToken_'))
);

function evaluate(options) {
  const context = {
    CONFIG: {
      API_TOKEN: options.apiToken || 'server-token',
      ADMIN_TOKEN_SHA256: options.expectedHash || ''
    },
    getAdminToken_: () => options.propertyToken || '',
    sha256Hex_: value => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
  };
  vm.createContext(context);
  vm.runInContext(functionSource, context);
  return context.checkAdminToken_;
}

const activeToken = 'test-active-admin-token';
const oldPropertyToken = 'test-old-property-token-that-is-longer-than-32-chars';
const activeHash = crypto.createHash('sha256').update(activeToken, 'utf8').digest('hex');

const hashFirst = evaluate({ expectedHash: activeHash, propertyToken: oldPropertyToken });
assert.strictEqual(hashFirst(activeToken), true, 'active verifier token should pass');
assert.strictEqual(hashFirst(oldPropertyToken), false, 'old Script Property token must be revoked');
assert.strictEqual(hashFirst('wrong-token'), false, 'wrong token must fail');

const propertyFallback = evaluate({ propertyToken: oldPropertyToken });
assert.strictEqual(propertyFallback(oldPropertyToken), true, 'Script Property fallback should remain available');
assert.strictEqual(propertyFallback('server-token'), false, 'API token must never act as admin token');

console.log('admin token auth tests passed');
