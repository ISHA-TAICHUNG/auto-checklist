#!/usr/bin/env node

// 真實 LINE 狀態入口與日檢判定的離線整合；不使用認證、網路或正式資料。
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const reminderSource = fs.readFileSync('apps-script/Reminder.gs', 'utf8');
const lineSource = fs.readFileSync('apps-script/LineWebhook.gs', 'utf8');
const today = new Date('2026-11-04T04:00:00Z');
const iso = value => value.toISOString().slice(0, 10);
function runtime(baseline = false, useMetadataScope = true) {
  const equipment = Array.from({ length: 6 }, (_, i) => ({
    equipmentId: 'F-' + i, category: '堆高機', active: true,
  })).concat([
    { equipmentId: 'C', category: '固定式起重機', active: true },
    { equipmentId: 'NO-USE', category: '高空工作車', active: true },
    { equipmentId: 'MONTH', category: '教室', active: true },
    { equipmentId: 'OFF', category: '堆高機', active: false },
  ]);
  const state = {
    books: { db: [['檢查日期', '表單類型', '設備類別'],
      [new Date('2026-11-03T04:00:00Z'), '每日', '堆高機'],
      ['2026-11-04', '每月', '堆高機'],
      [new Date(today), '每日', '固定式起重機']] },
    reads: 0, opens: 0, failReads: 0, missing: false, sent: 0,
  };
  const c = vm.createContext({ Date, CONFIG: { DB_SHEET_ID: 'db' },
    Logger: { log() {} },
    SpreadsheetApp: { openById: id => {
      state.opens += 1;
      return { getSheetByName: name => {
        assert.equal(name, '填報紀錄');
        if (state.missing) return null;
        return {
          getLastRow: () => state.books[id].length,
          getDataRange: () => ({ getValues: () => {
            state.reads += 1;
            if (state.failReads > 0) { state.failReads -= 1; throw new Error('紀錄來源讀取失敗'); }
            return state.books[id].map(row => row.map(value =>
              value instanceof Date ? new Date(value) : value));
          } }),
        };
      } };
    } },
  });
  if (useMetadataScope) {
    vm.runInContext(fs.readFileSync('apps-script/Templates.gs', 'utf8'), c);
  }
  vm.runInContext(reminderSource, c);
  vm.runInContext(baseline
    ? lineSource.replace(/dryRun: true, reuseDailyRecords: true/g, 'dryRun: true')
    : lineSource, c);
  Object.assign(c, {
    skipNonPrimaryDailyReminderRuntime_: () => null,
    beginDailyReminderRun_: () => ({}), finishDailyReminderRun_: () => {},
    todayStart_: () => today, formatISODate_: iso,
    getEquipmentList_: () => equipment,
    getEquipmentById_: id => equipment.find(row => row.equipmentId === id),
    getTemplateCyclesByCategory_: () => ({
      堆高機: ['每日'], 固定式起重機: ['每日'], 高空工作車: ['每日'], 教室: ['每月'],
    }),
    getVenueUsage_: row => ({ used: row.equipmentId !== 'NO-USE' }),
    sendUnfilledReminder_: () => { state.sent += 1; },
    buildChecklistStatusFlex_: rows => rows,
    withQuickReply_: rows => rows, lineReply_: (token, messages) => messages,
  });
  return { c, state, run: () => c.cmdStatus_('fixture-reply', 'fixture-user', {})[0] };
}

const baseline = runtime(true);
const before = baseline.run();
assert.equal(baseline.state.reads, 7);
const candidate = runtime();
assert.equal(JSON.stringify(candidate.run()), JSON.stringify(before), '完整結果、跳過原因及順序必須相同');
assert.equal(candidate.state.reads, 1, '同次狀態不可逐設備重讀填報紀錄');
assert.equal(candidate.state.opens, 1, '共用資料不能仍逐設備開啟試算表');
assert.equal(candidate.state.sent, 0, '狀態查詢不可發提醒');

// 日期轉換只做在表單類型與類別相符的列；同類別多台設備共用第一次掃描，結果不變。
{
  const { c, state, run } = runtime();
  for (let i = 0; i < 50; i += 1) {
    state.books.db.push([new Date(today), '每日', '其他類別'], [new Date(today), '每月', '堆高機']);
  }
  let conversions = 0;
  c.formatISODate_ = value => { conversions += 1; return iso(value); };
  assert.equal(JSON.stringify(run()), JSON.stringify(before));
  // 7 次查詢各算一次目標日期，加上堆高機與固定式起重機各一列相符的日檢。
  assert.equal(conversions, 9);
}

// 不同日期不可共用掃描結果；有共用資料時仍看得到當次資料中的今日日檢。
{
  const { c, state } = runtime();
  const context = {};
  state.books.db.push([new Date(today), '每日', '堆高機']);
  assert.equal(c.hasDailyRecordInCategory_('堆高機', today, context), true);
  assert.equal(c.hasDailyRecordInCategory_('堆高機', new Date('2026-11-02T04:00:00Z'), context), false);
  assert.equal(c.hasDailyRecordInCategory_('固定式起重機', today, context), true);
  assert.equal(state.reads, 1);
}

// 正式入口使用真實metadata wrapper；缺少helper的相容fallback也必須opt-in。
{
  const fallback = runtime(false, false);
  assert.equal(typeof candidate.c.withStatusMetadataReadSnapshot_, 'function');
  assert.equal(typeof fallback.c.withStatusMetadataReadSnapshot_, 'undefined');
  assert.equal(JSON.stringify(fallback.run()), JSON.stringify(before));
  assert.equal(fallback.state.reads, 1);
  fallback.state.books.db.push(['2026-11-04', '每日', '堆高機']);
  assert.equal(fallback.run().filter(row => row.category === '堆高機' &&
    row.reason === '該類別當日已填').length, 6);
  assert.equal(fallback.state.reads, 2);
}

// 下一指令必須反映新填報；不把昨日或月檢誤認為今日日檢。
candidate.state.books.db.push(['2026-11-04', '每日', '堆高機']);
const updated = candidate.run();
assert.equal(updated.filter(row => row.category === '堆高機' && row.reason === '該類別當日已填').length, 6);
assert.equal(candidate.state.reads, 2);
candidate.state.books.db.pop();
assert(candidate.run().some(row => row.category === '堆高機' && row.action === 'wouldMail'));
assert.equal(candidate.state.reads, 3);

// 其他呼叫維持 fresh；正式提醒即使誤帶選項也不得啟用。
{
  const { c, state } = runtime();
  assert.equal(c.hasDailyRecordInCategory_('堆高機', today), false);
  state.books.db.push(['2026-11-04', '每日', '堆高機']);
  assert.equal(c.hasDailyRecordInCategory_('堆高機', today), true);
  assert.equal(state.reads, 2);
}
for (const options of [{ dryRun: true }, { dryRun: false, reuseDailyRecords: true }]) {
  const { c, state } = runtime();
  const result = c.dailyReminderJob_(options);
  assert.equal(state.reads, 7, '未明確指定的 dry-run 與正式提醒保留原逐次查核');
  assert.equal(state.sent, options.dryRun ? 0 : 1, '正式提醒仍按類別去重');
  assert.equal(result.filter(row => row.action === 'mailed').length, options.dryRun ? 0 : 1);
}

// 來源失敗不能保存成空資料或「已填」；同次重試和下一操作可復原。
{
  const { state, run } = runtime();
  state.failReads = 1;
  const result = run();
  assert.equal(result[0].action, 'failed');
  assert(result[0].reason.includes('紀錄來源讀取失敗'));
  assert.equal(state.reads, 2, '第一次失敗後重新讀成功，再於當次共用');
  assert.equal(result.filter(row => row.action === 'wouldMail').length, 1);
  assert.equal(state.sent, 0);
}
{
  const { state, run } = runtime();
  state.failReads = 7;
  assert.equal(run().filter(row => row.action === 'failed').length, 7);
  assert.equal(state.reads, 7);
  assert(run().some(row => row.action === 'wouldMail'));
  assert.equal(state.reads, 8);
}
{
  const { state, run } = runtime();
  state.missing = true;
  assert.equal(run().filter(row => row.action === 'failed').length, 7);
  assert.equal(state.opens, 7);
  state.missing = false;
  assert(run().some(row => row.action === 'wouldMail'));
}
{
  const { state, run } = runtime();
  state.books.db[0] = ['檢查日期', '表單類型', '錯誤欄位'];
  assert.equal(run().filter(row => row.action === 'failed').length, 7);
  assert.equal(state.reads, 7, '欄位錯誤不保存為成功快照');
  state.books.db[0][2] = '設備類別';
  assert(run().some(row => row.action === 'wouldMail'));
  assert.equal(state.reads, 8);
}

// 空表沿用原判定且不保存，之後同context讀取能看到補入的列。
{
  const { c, state } = runtime();
  state.books.db = [state.books.db[0]];
  const context = {};
  assert.equal(c.hasDailyRecordInCategory_('堆高機', today, context), false);
  state.books.db.push([new Date(today), '每日', '堆高機']);
  assert.equal(c.hasDailyRecordInCategory_('堆高機', today, context), true);
  assert.equal(state.opens, 2);
  assert.equal(state.reads, 1);
}

// 只共用原始紀錄，不按第一個類別／日期保存布林值；DB切換也要重新讀。
{
  const { c, state } = runtime();
  const context = {};
  assert.equal(c.hasDailyRecordInCategory_('固定式起重機', today, context), true);
  assert.equal(c.hasDailyRecordInCategory_('堆高機', today, context), false);
  assert.equal(c.hasDailyRecordInCategory_('堆高機', new Date('2026-11-03T04:00:00Z'), context), true);
  assert.equal(state.reads, 1);
  state.books.db2 = [state.books.db[0], [new Date(today), '每日', '堆高機']];
  c.CONFIG.DB_SHEET_ID = 'db2';
  assert.equal(c.hasDailyRecordInCategory_('堆高機', today, context), true);
  assert.equal(state.reads, 2);
}

console.log('LINE日檢紀錄整合通過：7→1讀取、狀態一致、跨指令fresh、正式提醒不共用、錯誤復原及日期／類別／DB隔離。');
