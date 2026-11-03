#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = ['Config.gs', 'Main.gs']
  .map(name => fs.readFileSync(path.join(root, 'apps-script', name), 'utf8'))
  .join('\n');

function createRuntime() {
  const state = {
    rows: [['organizationName', '測試機構'], ['empty', ''], ['zero', 0],
      ['disabled', false], ['duplicate', '第一筆'], ['duplicate', '第二筆']],
    reads: 0,
    failReads: 0,
    missingSheet: false,
    authorized: true,
    authCalls: 0,
    handlerCalls: 0,
  };
  const sheet = {
    getLastRow: () => state.rows.length + 1,
    getRange: () => ({
      getValues: () => {
        state.reads += 1;
        if (state.failReads > 0) {
          state.failReads -= 1;
          throw new Error('測試讀取失敗');
        }
        return state.rows.map(row => row.slice());
      },
    }),
  };
  const context = vm.createContext({
    Logger: { log() {} },
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: () => state.missingSheet ? null : sheet }),
    },
  });
  vm.runInContext(source, context);
  context.jsonResponse_ = value => value;
  context.requirePublicSession_ = () => {
    state.authCalls += 1;
    if (!state.authorized) throw new Error('操作票證無效');
  };
  context.getLineWebhookQueryToken_ = () => 'test-webhook-credential'.padEnd(32, 'x');
  const readTwice = () => {
    state.handlerCalls += 1;
    return { ok: true, first: context.getSetting_('organizationName', ''),
      second: context.getSetting_('organizationName', '') };
  };
  context.getEquipmentList_ = () => readTwice();
  context.handleSubmission_ = readTwice;
  context.handleLineWebhook_ = readTwice;
  return { context, state };
}

function verifyExistingBehavior() {
  const { context, state } = createRuntime();
  assert.equal(context.getSetting_('organizationName', ''), '測試機構');
  for (const key of ['missing', 'empty', 'zero', 'disabled']) {
    assert.equal(context.getSetting_(key, '預設 A'), '預設 A');
    assert.equal(context.getSetting_(key, '預設 B'), '預設 B');
  }
  assert.equal(context.getSetting_('duplicate', ''), '第一筆');
  state.rows[0][1] = '更新後機構';
  assert.equal(context.getSetting_('organizationName', ''), '更新後機構');
  state.missingSheet = true;
  assert.equal(context.getSetting_('organizationName', '預設'), '預設');
  state.missingSheet = false;
  state.failReads = 1;
  assert.equal(context.getSetting_('organizationName', '讀取失敗預設'), '讀取失敗預設');
  assert.equal(context.getSetting_('organizationName', ''), '更新後機構');
}

verifyExistingBehavior();

{
  const { context, state } = createRuntime();
  const result = context.doGet({ parameter: { api: 'health' } });
  assert.equal(result.ok, true);
  assert.equal(result.version, '1.0', '健康檢查保留既有版本欄位');
  if (!process.argv.includes('--baseline')) {
    assert.equal(result.build, '2026-11-04-settings-read-snapshot');
  }
  assert.equal(state.reads, 0, '健康檢查不可讀取試算表');
}

if (process.argv.includes('--baseline')) {
  const { context, state } = createRuntime();
  for (let i = 0; i < 20; i += 1) context.getSetting_('organizationName', '');
  console.log(`調整前：20 次設定查詢讀取試算表 ${state.reads} 次；既有預設值與錯誤行為通過。`);
  process.exit(0);
}

{
  const { context, state } = createRuntime();
  context.withSettingsReadSnapshot_(() => {
    for (let i = 0; i < 20; i += 1) {
      assert.equal(context.getSetting_('organizationName', ''), '測試機構');
    }
    for (const key of ['missing', 'empty', 'zero', 'disabled']) {
      assert.equal(context.getSetting_(key, '預設 A'), '預設 A');
      assert.equal(context.getSetting_(key, '預設 B'), '預設 B');
    }
    assert.equal(context.getSetting_('duplicate', ''), '第一筆');
    context.withSettingsReadSnapshot_(() => context.getSetting_('organizationName', ''));
  });
  assert.equal(state.reads, 1, '同一操作及巢狀查詢應只讀取一次完整設定');
  state.rows[0][1] = '下一次操作的新設定';
  context.withSettingsReadSnapshot_(() => {
    assert.equal(context.getSetting_('organizationName', ''), '下一次操作的新設定');
  });
  assert.equal(state.reads, 2, '下一次操作必須重新讀取設定');
}

{
  const { context, state } = createRuntime();
  vm.runInContext('globalThis.testDate = new Date("2026-11-04T00:00:00Z")', context);
  state.rows.push(['date', context.testDate]);
  context.withSettingsReadSnapshot_(() => {
    const first = context.getSetting_('date', '');
    first.setUTCFullYear(2000);
    assert.equal(context.getSetting_('date', '').getUTCFullYear(), 2026,
      '呼叫端修改日期物件不得污染其他設定查詢');
    assert.equal(context.getSetting_('empty', context.testDate), context.testDate,
      '預設值物件必須原樣回傳，不得誤當成儲存格日期複製');
  });
}

{
  const { context, state } = createRuntime();
  context.withSettingsReadSnapshot_(() => {
    context.getSetting_('organizationName', '');
    assert.throws(() => context.withSettingsReadSnapshot_(() => {
      throw new Error('巢狀查詢失敗');
    }), /巢狀查詢失敗/);
    context.getSetting_('organizationName', '');
    assert.equal(state.reads, 1, '巢狀失敗被處理後，外層作用域仍須有效');
    vm.runInContext('CONFIG.DB_SHEET_ID = "another-test-database"', context);
    state.rows[0][1] = '另一資料庫設定';
    assert.equal(context.getSetting_('organizationName', ''), '另一資料庫設定',
      '資料庫身分改變時不可沿用原本資料庫的設定');
  });
  assert.equal(state.reads, 2);
}

{
  const { context, state } = createRuntime();
  state.failReads = 1;
  context.withSettingsReadSnapshot_(() => {
    assert.equal(context.getSetting_('organizationName', '失敗預設'), '失敗預設');
    assert.equal(context.getSetting_('organizationName', ''), '測試機構');
    assert.equal(context.getSetting_('organizationName', ''), '測試機構');
  });
  assert.equal(state.reads, 2, '讀取失敗不可當成空設定快取');
  assert.throws(() => context.withSettingsReadSnapshot_(() => {
    context.getSetting_('organizationName', '');
    throw new Error('中途失敗');
  }), /中途失敗/);
  state.rows[0][1] = '失敗後新設定';
  assert.equal(context.getSetting_('organizationName', ''), '失敗後新設定',
    '拋錯後必須清除作用域，避免污染後續呼叫');
}

{
  const { context, state } = createRuntime();
  state.rows = [];
  context.withSettingsReadSnapshot_(() => {
    assert.equal(context.getSetting_('missing', 'A'), 'A');
    assert.equal(context.getSetting_('missing', 'B'), 'B');
  });
  state.rows.push(['organizationName', '新增設定']);
  assert.equal(context.getSetting_('organizationName', ''), '新增設定');
  state.missingSheet = true;
  context.withSettingsReadSnapshot_(() => {
    assert.equal(context.getSetting_('organizationName', '預設'), '預設');
    state.missingSheet = false;
    assert.equal(context.getSetting_('organizationName', ''), '新增設定');
  });
}

for (const kind of ['get', 'submission', 'line']) {
  const { context, state } = createRuntime();
  const invoke = () => {
    if (kind === 'get') return context.doGet({ parameter: { api: 'equipments' } });
    if (kind === 'line') return context.doPost({
      parameter: { lineWebhookToken: context.getLineWebhookQueryToken_() },
      postData: { contents: JSON.stringify({ destination: 'test', events: [] }) },
    });
    return context.doPost({
      postData: { contents: JSON.stringify({ action: 'submitChecklist' }) },
    });
  };
  invoke();
  assert.equal(state.reads, 1, `${kind} 應共用當次操作的設定讀取`);
  state.rows[0][1] = '另一操作的新設定';
  const result = invoke();
  assert.equal(state.reads, 2, `${kind} 下一次操作應取得新設定`);
  const response = kind === 'get' ? result.equipments : result;
  assert.equal(response.first, '另一操作的新設定');
  assert.equal(response.second, response.first);
  if (kind === 'submission') assert.equal(state.authCalls, 2, '每次送出均須重新驗證票證');
}

{
  const { context, state } = createRuntime();
  context.withSettingsReadSnapshot_ = undefined;
  const getResult = context.doGet({ parameter: { api: 'equipments' } });
  assert.equal(getResult.equipments.ok, true, '舊版 Config 仍應能載入資料');
  const postResult = context.doPost({
    postData: { contents: JSON.stringify({ action: 'submitChecklist' }) },
  });
  assert.equal(postResult.ok, true, '舊版 Config 仍應能送出');
  assert.equal(state.reads, 4, '無快照能力時應保留原本的即時讀取');
}

{
  const { context, state } = createRuntime();
  state.authorized = false;
  const result = context.doPost({
    postData: { contents: JSON.stringify({ action: 'submitChecklist' }) },
  });
  assert.equal(result.ok, false);
  assert.equal(state.handlerCalls, 0, '票證驗證失敗不得進入送出流程');
  assert.equal(state.reads, 0);
  const webhookResult = context.doPost({
    parameter: { lineWebhookToken: 'invalid' },
    postData: { contents: JSON.stringify({ destination: 'test', events: [] }) },
  });
  assert.equal(webhookResult.ok, false);
  assert.equal(state.handlerCalls, 0, 'Webhook 憑證驗證失敗不得進入指令流程');
}

{
  const { context, state } = createRuntime();
  context.handleGetRequest_ = () => {
    const first = context.getSetting_('organizationName', '');
    state.rows[0][1] = '管理操作更新設定';
    return { first, second: context.getSetting_('organizationName', '') };
  };
  const result = context.doGet({ parameter: { api: 'admin' } });
  assert.equal(result.first, '測試機構');
  assert.equal(result.second, '管理操作更新設定', '管理路徑讀取後寫入再讀取必須保持即時');
  assert.equal(state.reads, 2);
  context.assertAdminDashboardCredential_ = () => {};
  context.handleAdminDashboardAction_ = context.handleGetRequest_;
  state.rows[0][1] = '管理操作前';
  const postResult = context.doPost({
    postData: { contents: JSON.stringify({ action: 'adminDashboardAction' }) },
  });
  assert.equal(postResult.first, '管理操作前');
  assert.equal(postResult.second, '管理操作更新設定');
}

console.log('設定讀取效能與相容性測試通過：20 次查詢只讀取 1 次，跨操作更新、失敗復原、管理即時讀取及授權檢查均通過。');
