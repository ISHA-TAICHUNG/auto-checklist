#!/usr/bin/env node

// 離線測試：載入正式 .js 來源，確認「狀態計時」、轉圈秒數與 Webhook 健康欄位；不呼叫網路或正式資料。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAS_ENDPOINT = 'https://script.google.com/macros/s/abc/exec?lineWebhookToken=' + 'x'.repeat(32);
const USER_ID = 'U-private-user';
const REPLY_TOKEN = 'reply-token-private';
const SEGMENTS = [
  '轉圈', '訂閱者檢查', '設備與週期設定', '設備日檢-場地', '設備日檢-填報紀錄', '設備日檢-其他',
  '場地防護具', '月檢', '待簽核',
  '提醒收尾', '訂閱者資料', '狀態卡片', '防護具', '每日作業',
];

// 兩台同類別設備：同名分段要累加成一行，不能各列一次。
const EQUIPMENT = ['F-1', 'F-2'].map(equipmentId => ({ equipmentId, category: '堆高機', active: true }));

function loadSource(context, name) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'apps-script', name), 'utf8');
  vm.runInContext(source, context, { filename: name });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function readHealth(lineEndpoint) {
  const context = vm.createContext({
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
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

// 走真實的 dispatchLineEvent_、cmdStatus_、dailyReminderJob_ 與 lineReply_，只替換資料來源。
function dispatch({ text, source = { type: 'user', userId: USER_ID }, timestamp, subscriber = true, optional = false, fakeClock = false }) {
  const state = { loading: [], replies: [], reminderRuns: 0, pendingApprovalRuns: 0 };
  const context = vm.createContext({
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    UrlFetchApp: {
      fetch: (url, options) => {
        if (url.endsWith('/chat/loading/start')) state.loading.push(JSON.parse(options.payload));
        if (url.endsWith('/message/reply')) state.replies.push(JSON.parse(options.payload));
        return { getResponseCode: () => 200, getContentText: () => '{}' };
      },
    },
    CONFIG: {},
    friendlyError_: err => String(err),
  });
  loadSource(context, 'LineNotify.js');
  loadSource(context, 'LineWebhook.js');
  loadSource(context, 'Reminder.js');
  // 每次取時間固定前進 100 毫秒，分段數字才能精確斷言。
  if (fakeClock) vm.runInContext('{ let now = 1000; Date.now = () => (now += 100); }', context);
  Object.assign(context, {
    getLineConfig_: () => ({ token: 'token' }),
    // 正式環境走這條分支；少了它，分段斷言只會驗到 fallback。
    withStatusMetadataReadSnapshot_: callback => callback(),
    isLineSubscriberUser_: () => subscriber,
    getLineSubscriberProfileByUserId_: () => ({ isSupervisor: false }),
    buildSubscriberRegistrationFlex_: () => ({ type: 'flex', altText: '請先登錄' }),
    buildChecklistStatusFlex_: () => ({ type: 'flex', altText: '狀態' }),
    defaultQuickReply_: () => ({ items: [] }),
    skipNonPrimaryDailyReminderRuntime_: () => null,
    beginDailyReminderRun_: () => { state.reminderRuns += 1; return {}; },
    finishDailyReminderRun_: () => {},
    todayStart_: () => new Date('2026-11-05T00:00:00Z'),
    getEquipmentList_: () => EQUIPMENT,
    getEquipmentById_: id => EQUIPMENT.find(row => row.equipmentId === id),
    getTemplateCyclesByCategory_: () => ({ 堆高機: ['每日'] }),
    getVenueUsage_: () => ({ used: true, content: '課程' }),
    hasDailyRecordInCategory_: () => false,
    dailyPpeChecklistStatusResults_: () => [],
    monthlyReminderJob_: () => [],
    pendingApprovalReminderJob_: () => { state.pendingApprovalRuns += 1; return { type: 'pendingApprovalReminder', action: 'skip' }; },
    dailyPpeListRecentUnconfirmedForLine_: () => ({ count: optional ? 1 : 0 }),
    buildDailyPpeAssignmentStatusFlex_: () => ({ type: 'flex', altText: '防護具' }),
    isDailyWorkCheckEnabled_: () => optional,
    getDailyWorkCheckStatus_: () => ({}),
    buildDailyWorkStatusFlex_: () => ({ type: 'flex', altText: '每日作業' }),
    submissionTimingText_: () => '送件計時（毫秒）\n合計 1',
  });
  context.event = {
    type: 'message',
    message: { type: 'text', text },
    replyToken: REPLY_TOKEN,
    source,
    timestamp,
  };
  vm.runInContext('dispatchLineEvent_(event)', context);
  state.context = context;
  return state;
}

function timingText(state) {
  const messages = state.replies[0].messages;
  const last = messages[messages.length - 1];
  return last.type === 'text' && last.text.startsWith('狀態計時') ? last.text : null;
}

// 健康檢查：前置層欄位已移除，既有端點比對維持原本行為
{
  const health = readHealth(GAS_ENDPOINT);
  assert.strictEqual('endpointIsExpectedRelay' in health, false);
  assert.strictEqual(health.endpointMatchesExpected, true);
  assert.strictEqual(health.endpointTokenMatchesExpected, true);
}

// 狀態計時：依序列出各段毫秒數，事件時間差為正值
{
  const state = dispatch({ text: '狀態計時', timestamp: Date.now() - 5000 });
  const lines = timingText(state).split('\n');

  assert.strictEqual(lines[0], '狀態計時（毫秒）');
  const delay = Number(lines[1].match(/^事件到程式 (\d+)$/)[1]);
  assert.ok(delay >= 5000 && delay < 60000, '事件時間差應約 5 秒');
  assert.deepStrictEqual(lines.slice(2, -1).map(line => line.split(' ')[0]), SEGMENTS);
  lines.slice(2).forEach(line => assert.match(line, /^\S+ \d+$/));
  assert.match(lines[lines.length - 1], /^合計 \d+$/);
  const sum = lines.slice(2, -1).reduce((total, line) => total + Number(line.split(' ')[1]), 0);
  assert.ok(sum <= Number(lines[lines.length - 1].split(' ')[1]), '各段加總不可超過合計');
}

// 兩台設備的同名分段要累加；各段加上組訊息前的最後一段等於合計
{
  const lines = timingText(dispatch({ text: '狀態計時', fakeClock: true })).split('\n');
  assert.ok(lines.includes('設備日檢-場地 200'));
  assert.ok(lines.includes('設備日檢-填報紀錄 200'));
  const sum = lines.slice(2, -1).reduce((total, line) => total + Number(line.split(' ')[1]), 0);
  assert.strictEqual(sum + 100, Number(lines[lines.length - 1].split(' ')[1]));
}

// 狀態計時：不帶 userId 與 reply token，訊息內容也不寫入個資
{
  const text = timingText(dispatch({ text: '/狀態計時', timestamp: Date.now() }));
  assert.ok(text);
  assert.ok(!text.includes(USER_ID));
  assert.ok(!text.includes(REPLY_TOKEN));
}

// 事件沒有時間戳時標示未知，不輸出錯誤數字
assert.match(timingText(dispatch({ text: '狀態計時' })), /\n事件到程式 未知\n/);

// 全部訊息都出現時仍在 LINE 單次回覆 5 則的上限內，計時放最後
{
  const messages = dispatch({ text: '狀態計時', optional: true }).replies[0].messages;
  assert.strictEqual(messages.length, 4);
  assert.strictEqual(messages[3].type, 'text');
}

// 一般「狀態」不多回計時訊息
{
  const state = dispatch({ text: '狀態', timestamp: Date.now() });
  assert.strictEqual(state.reminderRuns, 1);
  assert.strictEqual(timingText(state), null);
  assert.strictEqual(state.replies[0].messages.length, 1);
}

// 狀態卡片會濾掉待簽核結果，狀態查詢跳過；正式提醒與管理頁試算照舊計算
{
  const state = dispatch({ text: '狀態' });
  assert.strictEqual(state.pendingApprovalRuns, 0);
  assert.strictEqual(dispatch({ text: '狀態計時' }).pendingApprovalRuns, 0);
  vm.runInContext('dailyReminderJob_({ dryRun: true })', state.context);
  assert.strictEqual(state.pendingApprovalRuns, 1);
}

// 送件計時：回上一筆送件的分段文字，不跑狀態查詢；非訂閱者與群組拿不到
{
  const state = dispatch({ text: '送件計時' });
  const messages = state.replies[0].messages;
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].text, '送件計時（毫秒）\n合計 1');
  assert.strictEqual(state.reminderRuns, 0);
  const outsider = dispatch({ text: '送件計時', subscriber: false });
  assert.strictEqual(outsider.replies[0].messages[0].altText, '請先登錄');
  const group = dispatch({ text: '/送件計時', source: { type: 'group', groupId: 'C1', userId: USER_ID } });
  assert.match(group.replies[0].messages[0].text, /請私訊/);
}

// 非訂閱者與群組沿用狀態指令的限制，不會跑查詢也拿不到計時
{
  const outsider = dispatch({ text: '狀態計時', subscriber: false });
  assert.strictEqual(outsider.reminderRuns, 0);
  assert.strictEqual(timingText(outsider), null);

  const group = dispatch({ text: '/狀態計時', source: { type: 'group', groupId: 'C1', userId: USER_ID } });
  assert.strictEqual(group.reminderRuns, 0);
  assert.strictEqual(timingText(group), null);
}

// 轉圈要涵蓋實測超過 20 秒的狀態查詢；群組不支援轉圈
assert.deepStrictEqual(plain(dispatch({ text: '幫助' }).loading), [{ chatId: USER_ID, loadingSeconds: 30 }]);
assert.strictEqual(
  dispatch({ text: '/幫助', source: { type: 'group', groupId: 'C1', userId: USER_ID } }).loading.length,
  0,
);

console.log('line status timing tests passed');
