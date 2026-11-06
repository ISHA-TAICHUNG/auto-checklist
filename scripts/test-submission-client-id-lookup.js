#!/usr/bin/env node
'use strict';

// 離線測試：重送檢查只讀 ID 欄，結果須與舊整表比對完全相同；不連 Google、不寫正式資料。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'apps-script', 'Submission.gs'), 'utf8');

// 舊版整表比對（v145 以前）當對照組，逐字保留。
function legacyFindRecordByClientId(clientId, sheet) {
  if (!clientId) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idIdx = headers.indexOf("clientSubmissionId");
  if (idIdx < 0) return null;
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][idIdx] === clientId) {
      const approvalStatus = headers.indexOf("簽核狀態") >= 0
        ? String(data[i][headers.indexOf("簽核狀態")] || "")
        : "";
      return {
        recordId: data[i][headers.indexOf("紀錄ID")],
        fileUrl: data[i][headers.indexOf("PDF連結")] || "",
        approvalPending: ["待異常處理", "待主管簽核"].indexOf(approvalStatus) >= 0,
        approvalDeferredForIncidents: approvalStatus === "待異常處理",
      };
    }
  }
  return null;
}

function sheetOf(rows) {
  const sheet = {
    rows,
    reads: [],
    beforeRead: null,
    getLastRow: () => rows.length,
    getLastColumn: () => (rows[0] || []).length,
    getRange(row, column, numRows, numColumns) {
      return {
        getValues: () => {
          if (sheet.beforeRead) sheet.beforeRead(sheet.reads.length);
          sheet.reads.push({ row, column, numRows, numColumns });
          return rows.slice(row - 1, row - 1 + numRows)
            .map(values => values.slice(column - 1, column - 1 + numColumns));
        },
      };
    },
    getDataRange() { throw new Error('不可整表讀取'); },
  };
  return sheet;
}

function runtime(rows) {
  const sheet = sheetOf(rows);
  const context = vm.createContext({
    CONFIG: { DB_SHEET_ID: 'db' },
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => (name === '填報紀錄' ? sheet : null) }) },
  });
  vm.runInContext(source, context);
  return { find: id => context.findRecordByClientId_(id), sheet };
}

const HEADERS = ['紀錄ID', '檢查日期', '完整資料', 'PDF連結', '簽核狀態', 'clientSubmissionId'];
const ROWS = [
  HEADERS,
  ['R-1', '2026-11-05', '{"big":"json"}', 'https://pdf/1', '', 'C-1'],
  ['R-2', '2026-11-05', '{}', '', '待主管簽核', 'C-2'],
  ['R-3', '2026-11-06', '{}', '', '待異常處理', 'C-3'],
  ['R-4', '2026-11-06', '{}', 'https://pdf/4', '已簽核', 'C-4'],
  ['R-5', '2026-11-06', '{}', '', '', 12345],
  ['R-6', '2026-11-06', '{}', 'https://pdf/6', '', 'C-1'],
  ['R-7', '2026-11-06', '{}', null, null, ' C-7 '],
];
const clone = rows => rows.map(row => row.slice());

let cases = 0;
function test(name, run) {
  run();
  cases += 1;
  console.log('PASS', name);
}

test('各種情境結果與舊整表比對完全相同', () => {
  const fixtures = [
    clone(ROWS),
    [HEADERS],
    [['紀錄ID', 'PDF連結', '簽核狀態']].concat(clone(ROWS).slice(1).map(row => [row[0], row[3], row[4]])),
    clone(ROWS).map(row => row.filter((_, i) => i !== 4)), // 沒有簽核狀態欄
    clone(ROWS).map(row => row.filter((_, i) => i !== 0 && i !== 3)), // 沒有紀錄ID、PDF連結欄
  ];
  const ids = [undefined, '', 'C-1', 'C-2', 'C-3', 'C-4', 'C-404', '12345', 12345, 'C-7', ' C-7 ', 'c-1'];
  let compared = 0;
  for (const rows of fixtures) {
    for (const id of ids) {
      const { find } = runtime(clone(rows));
      const expected = legacyFindRecordByClientId(id, sheetOf(clone(rows)));
      assert.equal(JSON.stringify(find(id)), JSON.stringify(expected), `ID ${JSON.stringify(id)}`);
      compared += 1;
    }
  }
  assert.equal(compared, 60);
});

test('同一 ID 有兩列時回第一列，與舊行為一致', () => {
  const { find } = runtime(clone(ROWS));
  assert.equal(find('C-1').recordId, 'R-1');
  assert.equal(find('C-1').fileUrl, 'https://pdf/1');
});

test('找不到時只讀表頭與 ID 欄，不讀完整資料', () => {
  const { find, sheet } = runtime(clone(ROWS));
  assert.equal(find('C-404'), null);
  assert.deepEqual(sheet.reads, [
    { row: 1, column: 1, numRows: 1, numColumns: 6 },
    { row: 2, column: 6, numRows: 7, numColumns: 1 },
  ]);
});

test('找到時只多讀命中的那一列', () => {
  const { find, sheet } = runtime(clone(ROWS));
  assert.equal(find('C-4').recordId, 'R-4');
  assert.deepEqual(sheet.reads, [
    { row: 1, column: 1, numRows: 1, numColumns: 6 },
    { row: 2, column: 6, numRows: 7, numColumns: 1 },
    { row: 5, column: 1, numRows: 1, numColumns: 6 },
  ]);
});

test('兩次讀取之間被刪列或插列時擋下，不回錯紀錄', () => {
  for (const change of [rows => rows.splice(2, 1), rows => rows.splice(1, 0, ['R-0', '', '', '', '', 'C-0'])]) {
    const { find, sheet } = runtime(clone(ROWS));
    sheet.beforeRead = index => { if (index === 2) change(sheet.rows); };
    assert.throws(() => find('C-3'), /填報紀錄正在變動，請稍後再送出一次/);
  }
});

test('沒有 ID 欄或只有表頭時不讀資料列', () => {
  const noColumn = runtime([['紀錄ID', 'PDF連結'], ['R-1', '']]);
  assert.equal(noColumn.find('C-1'), null);
  assert.equal(noColumn.sheet.reads.length, 1);
  const empty = runtime([HEADERS]);
  assert.equal(empty.find('C-1'), null);
  assert.equal(empty.sheet.reads.length, 0);
});

console.log(`重送檢查只讀 ID 欄：${cases} 組通過，結果與舊整表比對一致。`);
