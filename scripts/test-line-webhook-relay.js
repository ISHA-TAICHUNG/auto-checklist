#!/usr/bin/env node

// 離線測試：載入正式 .js 來源，確認前置層健康欄位與轉圈秒數；不呼叫網路或正式資料。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RELAY_URL = 'https://isha-line-webhook-relay.example.workers.dev';
const GAS_ENDPOINT = 'https://script.google.com/macros/s/abc/exec?lineWebhookToken=' + 'x'.repeat(32);

function loadSource(context, name) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', name), 'utf8');
  vm.runInContext(source, context, { filename: name });
}

function readHealth({ relayProperty, lineEndpoint }) {
  const context = vm.createContext({
    Logger: { log() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => (key === 'LINE_WEBHOOK_RELAY_URL' ? relayProperty : null),
      }),
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/abc/exec' }) },
    UrlFetchApp: {
      fetch: () => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ endpoint: lineEndpoint, active: true }),
      }),
    },
    CONFIG: {},
    friendlyError_: err => String(err),
  });
  loadSource(context, 'LineNotify.js');
  vm.runInContext(`
    getLineConfig_ = () => ({ token: 'token' });
    getLineWebhookQueryToken_ = () => '${'x'.repeat(32)}';
  `, context);
  return vm.runInContext('getLineWebhookHealth_()', context);
}

// 走真實的 dispatchLineEvent_ 與 startLoadingAnimation_，驗實際送給 LINE 的秒數。
function loadingRequestsFor(source, text) {
  const requests = [];
  const context = vm.createContext({
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    UrlFetchApp: {
      fetch: (url, options) => {
        if (url.endsWith('/chat/loading/start')) requests.push(JSON.parse(options.payload));
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      },
    },
    CONFIG: {},
    friendlyError_: err => String(err),
  });
  loadSource(context, 'LineNotify.js');
  loadSource(context, 'LineWebhook.js');
  vm.runInContext(`getLineConfig_ = () => ({ token: 'token' });`, context);
  context.event = {
    type: 'message',
    message: { type: 'text', text },
    replyToken: 'reply-token',
    source,
  };
  vm.runInContext('dispatchLineEvent_(event)', context);
  return requests;
}

// LINE 指向前置層且與設定相符時才為 true
assert.strictEqual(
  readHealth({ relayProperty: RELAY_URL, lineEndpoint: RELAY_URL }).endpointIsExpectedRelay,
  true,
);

// LINE 仍指向 Apps Script（例如回滾後）
assert.strictEqual(
  readHealth({ relayProperty: RELAY_URL, lineEndpoint: GAS_ENDPOINT }).endpointIsExpectedRelay,
  false,
);

// 尚未設定屬性，或 LINE 端點讀不到，都不能判定為相符
assert.strictEqual(
  readHealth({ relayProperty: null, lineEndpoint: RELAY_URL }).endpointIsExpectedRelay,
  false,
);
assert.strictEqual(
  readHealth({ relayProperty: null, lineEndpoint: '' }).endpointIsExpectedRelay,
  false,
);

// 既有欄位維持原本的比對行為
const gasHealth = readHealth({ relayProperty: RELAY_URL, lineEndpoint: GAS_ENDPOINT });
assert.strictEqual(gasHealth.endpointMatchesExpected, true);
assert.strictEqual(gasHealth.endpointTokenMatchesExpected, true);

// 屬性值前後空白或結尾斜線，不應造成誤判而觸發回滾
assert.strictEqual(
  readHealth({ relayProperty: ` ${RELAY_URL}/ `, lineEndpoint: RELAY_URL }).endpointIsExpectedRelay,
  true,
);

// 轉圈要長於狀態查詢的 15～18 秒
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(loadingRequestsFor({ type: 'user', userId: 'U1' }, '幫助'))),
  [{ chatId: 'U1', loadingSeconds: 20 }],
);

// 群組不支援轉圈
assert.deepStrictEqual(
  loadingRequestsFor({ type: 'group', groupId: 'C1', userId: 'U1' }, '/幫助').length,
  0,
);

console.log('line webhook relay tests passed');
