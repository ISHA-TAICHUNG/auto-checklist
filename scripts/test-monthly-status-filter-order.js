#!/usr/bin/env node
'use strict';

// 全部離線：candidate 原樣載入實際產品；只有 baseline 在記憶體還原舊篩選順序。
// 執行：node scripts/test-monthly-status-filter-order.js [專案根目錄]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const projectRoot = path.resolve(process.argv[2] || process.cwd());
const source = Object.fromEntries(['Utils', 'MonthlySafetyPpe', 'LineNotify'].map(name =>
  [name, fs.readFileSync(path.join(projectRoot, 'apps-script', name + '.gs'), 'utf8')]));
const oldOrder = `      monthlyInspectionMonthFromRow_(headers, data[i]) === targetMonth &&
      String(data[i][typeCol] || '').trim() === '每月' &&
      String(data[i][categoryCol] || '').trim() === category`;
const newOrder = `      String(data[i][typeCol] || '').trim() === '每月' &&
      String(data[i][categoryCol] || '').trim() === category &&
      monthlyInspectionMonthFromRow_(headers, data[i]) === targetMonth`;
const occurrences = text => source.MonthlySafetyPpe.split(text).length - 1;
assert.equal(occurrences(oldOrder) + occurrences(newOrder), 1,
  '應只找到一處既有或新篩選順序；來源改動時須重新審查此比較基準');
// 不可為 candidate 補 patch。產品仍是舊順序時，最後的 300 次斷言必須 RED。
const candidateSource = source.MonthlySafetyPpe;
const baselineSource = candidateSource.replace(newOrder, oldOrder);
const headers = ['紀錄ID', '檢查日期', '表單類型', '設備類別', '簽核狀態', '主管姓名',
  '主管簽核時間', '設備代號', '設備名稱', 'PDF連結', '草稿Doc連結', '檢點所屬月份'];
const date = (day, month = '2026-11') =>
  new Date(`${month}-${String(day).padStart(2, '0')}T00:00:00+08:00`);
function record({ id = 'fixture', checkDate = '2026-11-02', type = '每月',
  category = '堆高機', status = '待主管簽核', supervisor = '', approvedAt = '', month = '' } = {}) {
  return [id, checkDate, type, category, status, supervisor, approvedAt,
    'FIXTURE-EQP', '測試設備', '', '', month];
}
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
});
function runtime(monthlySource, records = [headers]) {
  const counts = { month: 0, formatDate: 0, recordReads: 0 };
  const rejectSideEffect = () => { throw new Error('此測試禁止傳送通知、網路或雲端寫入'); };
  const context = vm.createContext({
    Date, Set, Map,
    CONFIG: { DB_SHEET_ID: 'fixture-db', TIMEZONE: 'Asia/Taipei' },
    Logger: { log() {} },
    Utilities: { formatDate(value) {
      counts.formatDate++;
      const parts = Object.fromEntries(formatter.formatToParts(value).map(p => [p.type, p.value]));
      return `${parts.year}-${parts.month}-${parts.day}`;
    } },
    SpreadsheetApp: { openById(id) {
      assert.equal(id, 'fixture-db');
      return { getSheetByName(name) {
        assert.equal(name, '填報紀錄');
        return { getDataRange: () => ({ getValues() {
          counts.recordReads++;
          return records.map(row => row.map(value => value instanceof Date ? new Date(value) : value));
        } }) };
      } };
    } },
    UrlFetchApp: { fetch: rejectSideEffect, fetchAll: rejectSideEffect },
    MailApp: { sendEmail: rejectSideEffect },
    GmailApp: { sendEmail: rejectSideEffect },
    getSetting_: (key, fallback) => ({
      monthlyInspectionTrackingStartMonth: '2026-09', monthlyReminderStartDay: '6',
      monthlyCheckWindowStart: '1', monthlyCheckWindowEnd: '5',
    }[key] ?? fallback),
    todayStart_: () => date(6),
  });
  for (const name of ['Utils', 'MonthlySafetyPpe', 'LineNotify']) {
    vm.runInContext(name === 'MonthlySafetyPpe' ? monthlySource : source[name], context,
      { filename: path.join('apps-script', name + '.gs') });
  }
  const categories = Array.from(context.getMonthlyReminderCategories_());
  const equipment = categories.map((category, i) => ({ equipmentId: 'E-' + i,
    category, equipmentName: '測試設備' + i, active: true }));
  equipment.push({ ...equipment[0], equipmentId: 'duplicate' });
  context.getEquipmentList_ = () => equipment;
  context.getEquipmentById_ = id => equipment.find(e => e.equipmentId === id);
  context.sendMonthlyUnfilledReminder_ = rejectSideEffect;
  const originalMonthReader = context.monthlyInspectionMonthFromRow_;
  context.monthlyInspectionMonthFromRow_ = (...args) => {
    counts.month++;
    return originalMonthReader(...args);
  };
  return { c: context, counts, categories };
}
function completion(records, category, month) {
  const r = runtime(candidateSource, records);
  return r.c.getMonthlyCompletionInCategory_(category, date(6, month));
}

// 欄位驗證仍必須先於逐列篩選，不能把不完整的表當成沒有欠項。
for (const missing of ['檢查日期', '表單類型', '設備類別', '簽核狀態', '主管姓名', '主管簽核時間']) {
  const r = runtime(candidateSource, [headers.filter(name => name !== missing)]);
  assert.throws(() => r.c.monthlyReminderJob_({ today: date(6), dryRun: true }), /缺欄位/);
}

// 相關月檢仍沿用產品 helper 的獨立月份、舊日期推定及無效日期行為。
const approved = { status: '已簽核歸檔', supervisor: '測試主管',
  approvedAt: '2026-11-03 10:00:00' };
for (const monthCell of ['2026-09', date(1, '2026-09')]) {
  const records = [headers, record({ ...approved, month: monthCell })];
  assert.equal(completion(records, '堆高機', '2026-09').completed, true);
  assert.equal(completion(records, '堆高機', '2026-11').submitted, false);
}
for (const checkDate of ['2026-10-02', date(2, '2026-10')]) {
  const legacyHeaders = headers.slice(0, -1);
  const records = [legacyHeaders, record({ ...approved, checkDate }).slice(0, -1)];
  assert.equal(completion(records, '堆高機', '2026-10').completed, true);
}
for (const fields of [{ checkDate: '2026-02-30' }, { month: '2026-13' }]) {
  assert.equal(completion([headers, record(fields)], '堆高機', '2026-11').submitted, false);
}
console.log('PASS 必要欄位缺失仍失敗；相關月檢 Date／字串月份與舊資料日期處理不變');

const categories = runtime(candidateSource).categories;
assert.equal(categories.length, 5, '此效能 fixture 以現有五個月檢類別為界');
const months = ['2026-09', '2026-10', '2026-11'];
const records = [headers];
for (let i = 0; i < 900; i++) {
  const month = months[i % months.length];
  const checkDate = `${month}-${String(1 + (i % 28)).padStart(2, '0')}`;
  records.push(record({ id: `DAILY-${i}`, type: i % 7 ? '每日' : ' 每日 ',
    category: categories[i % 5], status: '',
    checkDate: i % 2 ? new Date(checkDate + 'T00:00:00+08:00') : checkDate }));
}
for (let i = 0; i < 100; i++) {
  const month = months[i % months.length];
  const monthCell = i % 4 === 0 ? month : i % 4 === 1 ? date(1, month) : '';
  records.push(record({ id: `MONTHLY-${i}`, type: i % 2 ? ' 每月 ' : '每月',
    category: i % 2 ? ` ${categories[i % 5]} ` : categories[i % 5],
    checkDate: i % 4 === 3 ? date(2, month) : month + '-02', month: monthCell,
    status: ['待主管簽核', '待異常處理', '簽核略過'][i % 3] }));
}
function statusRun(monthlySource) {
  const r = runtime(monthlySource, records);
  const results = r.c.monthlyReminderJob_({ today: date(6), dryRun: true });
  const summaries = r.c.checklistStatusCategorySummary_(results);
  return { json: JSON.stringify({ results, categories: summaries }),
    resultCount: results.length, summaryCount: summaries.length, ...r.counts };
}
const baseline = statusRun(baselineSource);
const candidate = statusRun(candidateSource);
assert.equal(candidate.json, baseline.json, '真實提醒與 LINE 狀態摘要 JSON 必須逐字一致');
assert.equal(candidate.resultCount, 18, '重複設備維持既有類別去重結果');
assert.equal(candidate.summaryCount, 15, '五類別三月份的狀態摘要保持完整');
assert.equal(baseline.recordReads, 1);
assert.equal(candidate.recordReads, 1);
console.log('COUNTS', JSON.stringify({
  fixture: { dailyRows: 900, monthlyRows: 100, categories: 5, trackedMonths: 3 },
  baseline: { month: baseline.month, formatDate: baseline.formatDate },
  candidate: { month: candidate.month, formatDate: candidate.formatDate },
  statusJsonIdentical: true,
  statusSha256: crypto.createHash('sha256').update(candidate.json).digest('hex'),
}));
assert.equal(baseline.month, 15000, '舊順序基準應逐月逐類解析所有紀錄');
assert.equal(baseline.formatDate, 21791, '舊順序日期格式化基準不得被測試補 patch');
assert.equal(candidate.month, 300, '實際產品應先排除日檢及其他類別，再解析月份');
assert.equal(candidate.formatDate, 341, '實際產品應省去無關列的日期格式化');
console.log('PASS 月檢原始產品篩選：月份解析 15000→300，日期格式化 21791→341，狀態 JSON 一致');
