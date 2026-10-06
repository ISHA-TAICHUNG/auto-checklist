#!/usr/bin/env node
'use strict';

// 全部為離線資料與假傳送器；不使用正式憑證、不發送通知、不寫雲端資料。
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
let cases = 0;
function test(name, run) { run(); cases++; console.log('PASS', name); }
const headers = ['紀錄ID', '檢查日期', '表單類型', '設備類別', '簽核狀態', '主管姓名',
  '主管簽核時間', '設備代號', '設備名稱', 'PDF連結', '草稿Doc連結', '檢點所屬月份'];
function row({ date = '2026-10-02', month = '', status = '待主管簽核',
  supervisor = '', approvedAt = '', category = '堆高機', type = '每月', id = 'test' } = {}) {
  return [id, date, type, category, status, supervisor, approvedAt, 'FORK-TEST',
    '測試設備', '', '', month];
}
function sheet(initial) {
  const rows = initial.map(r => r.slice());
  let maxColumns = 26, writes = 0;
  const width = () => Math.max(...rows.map(r => r.length));
  const api = {
    getLastRow: () => rows.length, getLastColumn: width, getMaxColumns: () => maxColumns, getMaxRows: () => 1000,
    insertColumnsAfter: (c, n) => { maxColumns += n; },
    getDataRange: () => ({ getValues: () => rows.map(r => Array.from({ length: width() }, (_, i) => r[i] ?? '')) }),
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r + i - 1]?.[c + j - 1] ?? '')),
        setValue(v) { return this.setValues([[v]]); },
        setNumberFormat() { return this; },
        setValues(values) { writes++; values.forEach((rr, i) => {
          rows[r + i - 1] ||= [];
          rr.forEach((v, j) => { rows[r + i - 1][c + j - 1] = v; });
        }); },
      };
    },
    appendRow(r) { writes++; rows.push(r.slice()); },
  };
  return { api, rows, writes: () => writes };
}
function runtime(records = [headers], settings = {}) {
  const rec = sheet(records);
  const settingsTable = sheet([['鍵', '值', '備註'],
    ['monthlyCheckWindowStart', '1', '舊備註'], ['monthlyCheckWindowEnd', '5', '舊備註'],
    ['monthlyReminderStartDay', '25', '舊備註'], ['unrelated', 'preserve', '保留'],
  ]);
  const values = { monthlyInspectionTrackingStartMonth: '2026-10', ...settings };
  const context = vm.createContext({
    Date, Set, Map, CONFIG: { DB_SHEET_ID: 'test', TIMEZONE: 'Asia/Taipei' },
    Logger: { log() {} },
    Utilities: { formatDate(date) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date).map(x => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}`;
    } },
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => name === '填報紀錄' ? rec.api : settingsTable.api }), flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    sha256Hex_: s => crypto.createHash('sha256').update(s).digest('hex'),
    getSetting_: (key, fallback) => values[key] ?? fallback,
    todayStart_: () => new Date('2026-10-06T00:00:00+08:00'),
  });
  for (const file of ['Utils', 'MonthlySafetyPpe', 'LineNotify', 'Submission', 'AdminDashboard', 'Setup']) {
    vm.runInContext(fs.readFileSync(`apps-script/${file}.gs`, 'utf8'), context);
  }
  const categories = Array.from(context.getMonthlyReminderCategories_());
  const equipment = categories.map((category, i) => ({ equipmentId: 'E-' + i, category,
    equipmentName: '測試設備' + i, active: true }));
  equipment.push({ ...equipment[0], equipmentId: 'duplicate' });
  context.getEquipmentList_ = () => equipment;
  context.getEquipmentById_ = id => equipment.find(e => e.equipmentId === id);
  const sent = [];
  context.sendMonthlyUnfilledReminder_ = (e, date, state) => sent.push({ category: e.category,
    month: context.monthlyInspectionMonthForDate_(date), state });
  return { c: context, rec, settingsTable, values, sent, categories };
}
function date(day, month = '2026-10') { return new Date(`${month}-${String(day).padStart(2, '0')}T00:00:00+08:00`); }

test('跨月補檢只完成指定月份，實際檢查日期及簽核日期不改寫', () => {
  const r = runtime([headers, row({ month: '2026-09', status: '已簽核歸檔', supervisor: '測試主管', approvedAt: '2026-10-03 10:00:00' })]);
  assert.equal(r.c.getMonthlyCompletionInCategory_('堆高機', date(6, '2026-09')).completed, true);
  assert.equal(r.c.getMonthlyCompletionInCategory_('堆高機', date(6)).completed, false);
  assert.equal(r.rec.rows[1][1], '2026-10-02');
});
test('舊資料維持原檢查月份，跨月主管簽核不移動歸屬', () => {
  const r = runtime([headers.slice(0, -1), row({ date: '2026-09-30', status: '已簽核歸檔', supervisor: '測試主管', approvedAt: '2026-10-02 10:00:00' }).slice(0, -1)]);
  assert.equal(r.c.getMonthlyCompletionInCategory_('堆高機', date(6, '2026-09')).completed, true);
  assert.equal(r.c.getMonthlyCompletionInCategory_('堆高機', date(6)).completed, false);
});
for (const status of ['待主管簽核', '待異常處理', '簽核略過', '已簽核歸檔']) {
  test(`${status} 沒有完整主管簽核證據時不能停止提醒`, () => {
    const r = runtime([headers, row({ status })]);
    assert.equal(r.c.getMonthlyCompletionInCategory_('堆高機', date(6)).completed, false);
  });
}
test('已歸檔但缺主管姓名或有效簽核時間仍視為欠項', () => {
  for (const fields of [{ supervisor: '測試主管' }, { approvedAt: '2026-10-03 10:00:00' },
    { supervisor: '測試主管', approvedAt: 'bad' }, { supervisor: '測試主管', approvedAt: '2026-02-30 10:00:00' }]) {
    const r = runtime([headers, row({ status: '已簽核歸檔', ...fields })]);
    assert.equal(r.c.getMonthlyCompletionInCategory_('堆高機', date(6)).completed, false);
  }
});
test('1–5 日只顯示欠項，6 日到月底持續催辦，類別不重複寄送', () => {
  for (const day of [1, 5, 6, 24, 25, 31]) {
    const r = runtime();
    const results = r.c.monthlyReminderJob_({ today: date(day), dryRun: false });
    assert.equal(r.sent.length, day <= 5 ? 0 : 5);
    assert.equal(results.filter(x => x.action !== 'skip').length, 5);
  }
});
test('待主管簽核仍催辦，完成簽核後 LINE 待確認清單才移除', () => {
  const r = runtime([headers, row()]);
  let results = r.c.monthlyReminderJob_({ today: date(6), dryRun: true });
  let summary = Array.from(r.c.checklistStatusCategorySummary_(results)).find(x => x.category.startsWith('堆高機'));
  assert.equal(summary.pending.length, 1); assert.match(summary.pending[0].reason, /待主管簽核/);
  r.rec.rows[1][4] = '已簽核歸檔'; r.rec.rows[1][5] = '測試主管'; r.rec.rows[1][6] = '2026-10-06 12:00:00';
  results = r.c.monthlyReminderJob_({ today: date(6), dryRun: true });
  summary = Array.from(r.c.checklistStatusCategorySummary_(results)).find(x => x.category.startsWith('堆高機'));
  assert.equal(summary.pending.length, 0); assert.equal(r.sent.length, 0);
});
test('欠項跨月持續顯示及催辦，補 9 月不完成 10 月', () => {
  const r = runtime([headers, row({ month: '2026-09', status: '已簽核歸檔', supervisor: '測試主管', approvedAt: '2026-10-03 10:00:00' })], { monthlyInspectionTrackingStartMonth: '2026-09' });
  const results = Array.from(r.c.monthlyReminderJob_({ today: date(1, '2026-11'), dryRun: false }));
  assert(!results.some(x => x.category === '堆高機' && x.inspectionMonth === '2026-09'));
  assert(results.some(x => x.category === '堆高機' && x.inspectionMonth === '2026-10' && !x.completed));
  assert(results.some(x => x.category === '堆高機' && x.inspectionMonth === '2026-11' && !x.completed));
  assert(r.sent.some(x => x.category === '堆高機' && x.month === '2026-10'));
  assert(!r.sent.some(x => x.month === '2026-11'));
});
test('中控台與提醒使用同一月份及簽核完成標準，日檢維持原判斷', () => {
  const r = runtime([headers,
    row({ month: '2026-09', status: '已簽核歸檔', supervisor: '測試主管', approvedAt: '2026-10-03 10:00:00' }),
    row({ id: 'daily', type: '每日', status: '' }),
  ]);
  const index = r.c.dashboardChecklistRecordIndex_();
  assert.equal(r.c.dashboardHasChecklistRecord_(index, '每月', '堆高機', date(2, '2026-09')), true);
  assert.equal(r.c.dashboardHasChecklistRecord_(index, '每月', '堆高機', date(2)), false);
  assert.equal(r.c.dashboardHasChecklistRecord_(index, '每日', '堆高機', date(2)), true);
});
test('同日同設備不同所屬月份不會被當成同一批簽核', () => {
  const r = runtime();
  const base = { checkDate: '2026-10-02', equipmentId: 'test', formType: 'monthly' };
  assert.notEqual(r.c.approvalBatchKey_({ ...base, checkMonth: '2026-09' }), r.c.approvalBatchKey_({ ...base, checkMonth: '2026-10' }));
});
test('填報保存所屬月份與實際日期；日檢及舊日期不受影響', () => {
  const r = runtime();
  const equipment = { equipmentId: 'test', category: '堆高機', equipmentName: '測試設備' };
  r.c.writeRecord_({ recordId: 'test', submittedAt: date(2), checkDate: date(2), formType: 'monthly',
    equipment, payload: { checkMonth: '2026-09', inspector: '測試檢查人', items: [] },
    approval: { status: '待主管簽核' } });
  assert.equal(r.rec.rows[1][headers.indexOf('檢查日期')], '2026-10-02');
  assert.equal(r.rec.rows[1][headers.indexOf('檢點所屬月份')], '2026-09');
  const rec = r.c.approvalRecordFromRow_(r.rec.api, headers, r.rec.rows[1], 2);
  assert.equal(rec.checkMonth, '2026-09'); assert.equal(rec.checkDate, '2026-10-02');
  assert.match(r.c.buildPdfFilename_('monthly', date(2), equipment, '2026-09'), /所屬2026-09\.pdf$/);
  assert(!r.c.buildPdfFilename_('daily', date(2), equipment, '2026-09').includes('所屬'));
});
test('月份驗證拒絕未來或非法月份，舊前端省略月份時預設實際檢查月份', () => {
  const r = runtime();
  assert.equal(r.c.normalizeMonthlyInspectionMonth_('', '2026-10-02'), '2026-10');
  assert.equal(r.c.normalizeMonthlyInspectionMonth_('2026-09', '2026-10-02'), '2026-09');
  for (const m of ['2026-11', '2026-13', '2026-00', '2026-9', '<script>']) assert.throws(() => r.c.normalizeMonthlyInspectionMonth_(m, '2026-10-02'));
});
test('Sheets 把所屬月份或追蹤設定自動轉成日期時仍正確歸屬', () => {
  const r = runtime([headers, row({ month: date(1, '2026-09'), status: '已簽核歸檔',
    supervisor: '測試主管', approvedAt: '2026-10-03 10:00:00' })],
  { monthlyInspectionTrackingStartMonth: date(1, '2026-09') });
  assert.deepEqual(Array.from(r.c.getMonthlyInspectionMonths_(date(6))), ['2026-09', '2026-10']);
  assert.equal(r.c.getMonthlyCompletionInCategory_('堆高機', date(6, '2026-09')).completed, true);
  r.settingsTable.rows.push(['monthlyInspectionTrackingStartMonth', date(1, '2026-09'), '日期格式設定']);
  const result = r.c.applyMonthlyInspectionPolicy_({ dryRun: false, trackingStartMonth: '2026-10' });
  assert.equal(result.settings.monthlyInspectionTrackingStartMonth, '2026-09');
});
test('欄位缺失不能誤判月檢已完成', () => {
  const r = runtime([headers.filter(h => h !== '主管姓名')]);
  assert.throws(() => r.c.getMonthlyCompletionInCategory_('堆高機', date(6)), /缺欄位/);
});
test('限定升級先預覽，再追加月份欄位及四個設定，重跑不覆寫歷史資料', () => {
  const r = runtime([headers.slice(0, -1), row().slice(0, -1)]);
  const original = JSON.stringify(r.rec.rows);
  const preview = r.c.applyMonthlyInspectionPolicy_({ dryRun: true, trackingStartMonth: '2026-09' });
  assert.equal(preview.settings.monthlyReminderStartDay, '6');
  assert.equal(r.rec.writes(), 0); assert.equal(r.settingsTable.writes(), 0);
  const result = r.c.applyMonthlyInspectionPolicy_({ dryRun: false, trackingStartMonth: '2026-09' });
  assert.equal(result.originalDataHash, result.afterOriginalDataHash); assert.equal(result.monthColumnAdded, true);
  assert.equal(JSON.stringify(r.rec.rows.map(rr => rr.slice(0, headers.length - 1))), original);
  assert.deepEqual(r.settingsTable.rows.find(rr => rr[0] === 'unrelated'), ['unrelated', 'preserve', '保留']);
  const again = r.c.applyMonthlyInspectionPolicy_({ dryRun: false, trackingStartMonth: '2026-10' });
  assert.equal(again.monthColumnAdded, false); assert.equal(again.settings.monthlyInspectionTrackingStartMonth, '2026-09');
});
console.log(`${cases} 月檢週期、跨月歸屬、主管簽核及限定升級測試通過`);
