#!/usr/bin/env node

// 離線測試：使用真實狀態入口及讀取函式，不呼叫網路、正式資料或通知。
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function createRuntime() {
  const headers = ['設備代號', '設備名稱', '機械編號', '型式規格', '設備類別',
    '所在位置', '場地表分頁', '日檢表單ID', '月檢表單ID', '啟用'];
  const rows = [headers, ...Array.from({ length: 14 }, (_, i) => [
    'TEST-' + i, '測試設備' + i, i ? 'SERIAL-' + i : new Date('2026-01-01T00:00:00Z'),
    '測試規格', '堆高機', '測試場地', '測試分頁', 'F-D', 'F-M', true,
  ])];
  const state = {
    books: {
      db: {
        '設備清單': rows,
        '檢查表模板': [['設備類別', '週期', '啟用'], ['堆高機', '每日', true],
          ['堆高機', '每月', true]],
      },
    },
    reads: { '設備清單': 0, '檢查表模板': 0 },
    opens: 0, fail: {}, missing: {}, replies: 0, profileReads: 0, supervisor: false,
  };
  const clone = values => values.map(row => row.map(value =>
    value instanceof Date ? new Date(value.getTime()) : value));
  const context = vm.createContext({
    Date, CONFIG: { DB_SHEET_ID: 'db', TIMEZONE: 'Asia/Taipei' },
    Logger: { log() {} },
    SpreadsheetApp: { openById: id => {
      state.opens += 1;
      return { getSheetByName: name => {
        if (state.missing[name]) return null;
        const values = state.books[id][name];
        return {
          getLastRow: () => values.length,
          getDataRange: () => ({ getValues: () => {
            state.reads[name] += 1;
            if (state.fail[name]) {
              state.fail[name] -= 1;
              throw new Error('測試讀取失敗');
            }
            return clone(values);
          } }),
        };
      } };
    } },
  });
  for (const file of ['Utils', 'Templates', 'Reminder', 'LineWebhook']) {
    vm.runInContext(fs.readFileSync('apps-script/' + file + '.gs', 'utf8'), context);
  }
  Object.assign(context, {
    skipNonPrimaryDailyReminderRuntime_: () => null,
    beginDailyReminderRun_: () => ({}),
    finishDailyReminderRun_: () => {},
    todayStart_: () => new Date('2026-11-04T04:00:00Z'),
    getVenueUsage_: () => ({ used: true }),
    hasDailyRecordInCategory_: () => true,
    dailyPpeChecklistStatusResults_: () => {
      context.getEquipmentById_('TEST-0');
      context.getEquipmentById_('TEST-1');
      return [];
    },
    monthlyReminderJob_: () => {
      const equipment = context.getEquipmentList_()
        .map(item => context.getEquipmentById_(item.equipmentId));
      return [{ type: 'test-monthly', count: equipment.length,
        first: equipment[0] ? equipment[0].equipmentName : '' }];
    },
    getLineSubscriberProfileByUserId_: () => {
      state.profileReads += 1;
      return { isSupervisor: state.supervisor };
    },
    buildOperationsDashboardUrl_: () => 'https://example.test/dashboard',
    buildChecklistStatusFlex_: (results, options) => ({ results, options }),
    withQuickReply_: value => value,
    lineReply_: (token, messages) => { state.replies += 1; return messages; },
    sendUnfilledReminder_: () => { throw new Error('狀態查詢不得寄送'); },
  });
  return { context, state, run: () => context.cmdStatus_('test-reply', 'test-user',
    { isDirectChat: true }) };
}

const baseline = createRuntime();
baseline.context.withStatusMetadataReadSnapshot_ = undefined;
const before = baseline.run();
assert.deepEqual(baseline.state.reads, { '設備清單': 32, '檢查表模板': 3 });
assert.equal(baseline.state.opens, 35);

const candidate = createRuntime();
assert.equal(typeof candidate.context.withStatusMetadataReadSnapshot_, 'function',
  '正式 Templates 尚未提供狀態metadata作用域');
const after = candidate.run();
assert.equal(JSON.stringify(after), JSON.stringify(before), '前後狀態與顯示權限須相同');
assert.deepEqual(candidate.state.reads, { '設備清單': 1, '檢查表模板': 1 });
assert.equal(candidate.state.opens, 2, '快取命中時不能仍開啟試算表');
assert.equal(candidate.state.replies, 1);

// 下一指令必須反映停用、名稱、模板週期及主管身分的更新。
candidate.state.books.db['設備清單'][1][9] = false;
candidate.state.books.db['設備清單'][2][1] = '下一輪更新名稱';
candidate.state.books.db['檢查表模板'][1][2] = false;
candidate.state.supervisor = true;
const next = candidate.run();
assert.deepEqual(candidate.state.reads, { '設備清單': 2, '檢查表模板': 2 });
assert.equal(next[0].results.filter(row => row.equipmentId).length, 0,
  '日檢週期停用後不沿用前次週期');
assert.equal(next[0].results.at(-1).count, 13);
assert.equal(next[0].results.at(-1).first, '下一輪更新名稱');
assert.equal(next[0].options.viewerIsSupervisor, true);
assert.equal(candidate.state.profileReads, 2, '人員profile不可加入metadata快取');

// 送出、排程及其他未包住的讀取維持原本fresh行為。
{
  const { context, state } = createRuntime();
  assert.equal(context.getEquipmentById_('TEST-0').equipmentName, '測試設備0');
  state.books.db['設備清單'][1][1] = '鎖內最新設備';
  assert.equal(context.getEquipmentById_('TEST-0').equipmentName, '鎖內最新設備');
  assert.equal(state.reads['設備清單'], 2);
}

{
  const { context, state } = createRuntime();
  context.dailyReminderJob_({ dryRun: false });
  assert.deepEqual(state.reads, { '設備清單': 32, '檢查表模板': 3 },
    '正式排程不能自動啟用LINE狀態查詢scope');
}

// 巢狀呼叫共享當次讀取；日期、回傳物件及陣列修改不污染後續讀取。
{
  const { context, state } = createRuntime();
  context.withStatusMetadataReadSnapshot_(() => {
    const first = context.getEquipmentById_('TEST-0');
    first.equipmentName = '呼叫端修改';
    first.machineSerial.setUTCFullYear(2000);
    context.withStatusMetadataReadSnapshot_(() => {
      const second = context.getEquipmentById_('TEST-0');
      assert.equal(second.equipmentName, '測試設備0');
      assert.equal(second.machineSerial.getUTCFullYear(), 2026);
    });
    const list = context.getEquipmentList_();
    list.pop();
    assert.equal(context.getEquipmentList_().length, 14);
    const cycles = context.getTemplateCyclesByCategory_();
    cycles['堆高機'].pop();
    assert.equal(context.getTemplateCyclesByCategory_()['堆高機'].length, 2);
  });
  assert.deepEqual(state.reads, { '設備清單': 1, '檢查表模板': 1 });
  state.books.db['設備清單'][1][1] = '作用域外更新';
  assert.equal(context.getEquipmentById_('TEST-0').equipmentName, '作用域外更新');
}

{
  const { context, state } = createRuntime();
  context.withStatusMetadataReadSnapshot_(() => {
    context.getEquipmentById_('TEST-0');
    assert.throws(() => context.withStatusMetadataReadSnapshot_(() => {
      throw new Error('巢狀查詢失敗');
    }), /巢狀查詢失敗/);
    context.getEquipmentById_('TEST-0');
    assert.equal(state.reads['設備清單'], 1);
    let profileReads = 0;
    const readProfile = () => [[++profileReads]];
    assert.equal(context.readStatusMetadataTable_('訂閱者清單', readProfile)[0][0], 1);
    assert.equal(context.readStatusMetadataTable_('訂閱者清單', readProfile)[0][0], 2,
      'metadata作用域不得擴及人員／權限資料');
  });
}

// 讀取失敗不可保存為空表；拋錯後必須清除整個當次scope。
for (const table of ['設備清單', '檢查表模板']) {
  const { context, state, run } = createRuntime();
  state.fail[table] = 1;
  assert.throws(run, /測試讀取失敗/);
  state.books.db['設備清單'][1][1] = '失敗後新名稱';
  assert.equal(run()[0].results.at(-1).first, '失敗後新名稱');
  assert.equal(state.reads[table], 2);
  assert.equal(state.replies, 1, '失敗不可回覆一張看似完整的狀態卡');
  context.withStatusMetadataReadSnapshot_(() => {
    state.fail[table] = 1;
    assert.throws(() => table === '設備清單' ? context.getEquipmentById_('TEST-0')
      : context.getTemplateCyclesByCategory_(), /測試讀取失敗/);
    if (table === '設備清單') assert(context.getEquipmentById_('TEST-0'));
    else assert.equal(context.getTemplateCyclesByCategory_()['堆高機'].length, 2);
  });
}

// 缺少或只有標題的模板維持舊行為，也不把不可得資料保存為空快取。
{
  const { context, state } = createRuntime();
  context.withStatusMetadataReadSnapshot_(() => {
    state.missing['檢查表模板'] = true;
    assert.equal(Object.keys(context.getTemplateCyclesByCategory_()).length, 0);
    state.missing['檢查表模板'] = false;
    const rows = state.books.db['檢查表模板'];
    state.books.db['檢查表模板'] = [rows[0]];
    assert.equal(Object.keys(context.getTemplateCyclesByCategory_()).length, 0);
    assert.equal(state.reads['檢查表模板'], 0);
    state.books.db['檢查表模板'] = rows;
    assert.equal(context.getTemplateCyclesByCategory_()['堆高機'].length, 2);
    assert.equal(state.reads['檢查表模板'], 1);
  });
}

// 重複ID仍先取第一筆，active同義值及跨DB查詢不改原語意。
{
  const { context, state } = createRuntime();
  state.books.db['設備清單'].push(['TEST-0', '重複ID後筆', '', '', '堆高機', '', '', '', '', true]);
  state.books.db['設備清單'][1][9] = false;
  for (const [i, value] of ['TRUE', '是', '啟用'].entries()) {
    state.books.db['設備清單'][i + 2][9] = value;
  }
  context.withStatusMetadataReadSnapshot_(() => {
    assert.equal(context.getEquipmentById_('TEST-0').equipmentName, '測試設備0');
    assert.equal(context.getEquipmentById_('TEST-0').active, false);
    for (const id of ['TEST-1', 'TEST-2', 'TEST-3']) {
      assert.equal(context.getEquipmentById_(id).active, true);
    }
    state.books.db2 = { ...state.books.db,
      '設備清單': state.books.db['設備清單'].map(row => row.slice()) };
    state.books.db2['設備清單'][1][1] = '另一DB設備';
    context.CONFIG.DB_SHEET_ID = 'db2';
    assert.equal(context.getEquipmentById_('TEST-0').equipmentName, '另一DB設備');
    context.CONFIG.DB_SHEET_ID = 'db';
    assert.equal(context.getEquipmentById_('TEST-0').equipmentName, '測試設備0');
  });
}

console.log('LINE狀態metadata整合通過：設備32→1、模板3→1、卡片一致、跨指令更新、scope清理、讀取失敗及送出fresh邊界。');
