#!/usr/bin/env node
'use strict';

// 離線測試：只用記憶體假資料，不連 Google、不寫正式資料、不發通知。
// 載入全部正式 .gs；只替換 PDF、Drive、寫紀錄與通知等外部副作用。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'apps-script');
const sources = fs.readdirSync(root).filter(name => name.endsWith('.gs')).sort()
  .map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]);

const INCIDENT_HEADERS = ['事件ID', '設備代號', '表單類型', '項次', '項目名稱', '通報日期', '異常說明', '狀態'];
const OPEN_INCIDENT = ['INC-1', 'EQP-1', '每日', 3, '第三項', '2026-11-01', '煞車失靈', '處理中'];
const INCIDENT_SHEET = '機具設備異常事件';

let cases = 0;
function test(name, run) {
  run();
  cases += 1;
  console.log('PASS', name);
}

function sheetOf(rows) {
  return {
    rows,
    reads: 0,
    readsWhileLocked: 0,
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (row, column, numRows, numColumns) => ({
      getValues: () => rows.slice(row - 1, row - 1 + numRows)
        .map(values => values.slice(column - 1, column - 1 + numColumns)),
      setValues: values => { values.forEach(value => rows.push(value.slice())); },
    }),
    getDataRange() {
      this.reads += 1;
      if (this.world && this.world.locked) this.readsWhileLocked += 1;
      return { getValues: () => rows.map(row => row.slice()) };
    },
  };
}

function setup(options) {
  options = options || {};
  const cacheStore = new Map();
  const world = { locked: false, onLock: null, pdfs: 0, writes: 0, released: 0 };
  const sheets = {
    設備清單: sheetOf([
      ['設備代號', '設備名稱', '機械編號', '型式規格', '設備類別', '所在位置', '場地表分頁', '啟用'],
      ['EQP-1', '測試機', 'M-1', 'T-1', '測試類別', '測試區', '', true],
    ]),
    檢查表模板: sheetOf([
      ['表單ID', '表單名稱', '設備類別', '週期', '法規依據', '填寫規則', '結果選項', '啟用'],
      ['F-TEST-D', '測試日檢', '測試類別', '每日', '', '', 'V,/,X', true],
    ]),
    檢查項目: sheetOf([
      ['表單ID', '項目順序', '項目名稱', '檢查方法', '啟用'],
      ['F-TEST-D', 1, '第一項', '', true],
      ['F-TEST-D', 2, '第二項', '', true],
      ['F-TEST-D', 3, '第三項', '', true],
    ]),
    [INCIDENT_SHEET]: sheetOf(options.incidentRows || [INCIDENT_HEADERS]),
  };
  if (options.withoutIncidentSheet) delete sheets[INCIDENT_SHEET];
  Object.keys(sheets).forEach(name => { sheets[name].world = world; });
  const database = { getSheetByName: name => sheets[name] || null };

  const context = vm.createContext({
    Date, Set, Map, console,
    Logger: { log() {} },
    SpreadsheetApp: { openById: () => database },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '', setProperty() {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    Utilities: {
      formatDate: (value, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(value),
      getUuid: () => 'test-uuid',
    },
    CacheService: {
      getScriptCache: () => ({
        get: key => (cacheStore.has(key) ? cacheStore.get(key) : null),
        put: (key, value) => cacheStore.set(key, value),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({ setMimeType() { return this; }, text }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock() {
          world.locked = true;
          if (world.onLock) world.onLock();
          return true;
        },
        releaseLock() {
          world.locked = false;
          world.released += 1;
        },
      }),
    },
  });
  sources.forEach(([name, source]) => vm.runInContext(source, context, { filename: name }));
  const realWriteIncidents = context.writeIncidents_;

  Object.assign(context, {
    validateSignature_() {},
    findRecordByClientId_: () => null,
    buildPdf_() {
      world.pdfs += 1;
      return { setName() {} };
    },
    buildPdfFilename_: () => 'test.pdf',
    getOrCreateArchiveFolderForSubmission_: () => ({ createFile: () => ({ getUrl: () => 'test-file' }) }),
    sharePdfFileForLinkView_() {},
    writeRecord_() { world.writes += 1; },
    writeIncidents_() {},
    notifyLineIncidents_() {},
  });
  if (options.realWriteIncidents) context.writeIncidents_ = realWriteIncidents;
  return { context, sheets, world };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function lockedOrders(context) {
  return plain(context.getLockedItemsForEquipment_('EQP-1', 'daily')).map(item => item.order);
}

function get(context, parameter) {
  return JSON.parse(context.doGet({ parameter }).text);
}

function submission(results) {
  return {
    formType: 'daily',
    equipmentId: 'EQP-1',
    checkDate: '2026-11-04',
    inspector: '測試人員',
    signature: 'test',
    clientSubmissionId: 'client-1',
    items: [1, 2, 3].map(order => ({
      order,
      name: '第' + order + '項',
      result: (results && results[order]) || 'V',
      note: (results && results[order]) === 'X' ? '仍異常' : '',
    })),
  };
}

function assertRejectedWithoutSideEffects(fixture, payload, pattern) {
  assert.throws(() => fixture.context.handleSubmission_(payload), pattern);
  assert.equal(fixture.world.pdfs, 0, '被拒絕的送出不可產生 PDF');
  assert.equal(fixture.world.writes, 0, '被拒絕的送出不可寫入紀錄');
  assert.equal(fixture.world.locked, false, '拒絕後必須釋放鎖');
}

// ===== 能確認資料時的既有行為 =====
test('未結案異常鎖定項次，已完成者解鎖', () => {
  const rows = [INCIDENT_HEADERS, OPEN_INCIDENT,
    ['INC-2', 'EQP-1', '每日', 2, '第二項', '2026-11-01', '已修復', '已完成']];
  assert.deepEqual(lockedOrders(setup({ incidentRows: rows }).context), [3]);
});

test('表頭完整但沒有資料，才是真正沒有異常', () => {
  assert.deepEqual(lockedOrders(setup({ incidentRows: [INCIDENT_HEADERS] }).context), []);
});

test('其他設備或其他表單的異常資料不影響本表', () => {
  const rows = [INCIDENT_HEADERS,
    ['INC-3', 'EQP-2', '每日', '', '別台', '2026-11-01', '別台異常', '處理中'],
    ['INC-4', 'EQP-1', '每月', '', '月檢', '2026-11-01', '月檢異常', '處理中']];
  assert.deepEqual(lockedOrders(setup({ incidentRows: rows }).context), []);
});

test('已完成的舊資料即使項次無效也不阻擋填報', () => {
  const rows = [INCIDENT_HEADERS, ['INC-5', 'EQP-1', '每日', '', '舊資料', '2026-01-01', '舊', '已完成']];
  assert.deepEqual(lockedOrders(setup({ incidentRows: rows }).context), []);
});

test('欄位值前後空白仍屬於本設備與本表單', () => {
  [['INC-6', 'EQP-1', '每日 ', 3, '第三項', '2026-11-01', '尾空白', '處理中'],
    ['INC-7', 'EQP-1 ', '每日', 3, '第三項', '2026-11-01', '尾空白', '處理中'],
    ['INC-8', 'EQP-1', '每日', '3', '第三項', '2026-11-01', '字串項次', ' 處理中 ']].forEach(row => {
    assert.deepEqual(lockedOrders(setup({ incidentRows: [INCIDENT_HEADERS, row] }).context), [3]);
  });
});

test('表頭前後空白不影響判定', () => {
  const headers = INCIDENT_HEADERS.map(name => name + ' ');
  assert.deepEqual(lockedOrders(setup({ incidentRows: [headers, OPEN_INCIDENT] }).context), [3]);
});

test('Sheets 轉成數字的設備代號仍比對得到', () => {
  const row = OPEN_INCIDENT.slice();
  row[1] = 123;
  const { context } = setup({ incidentRows: [INCIDENT_HEADERS, row] });
  const locked = plain(context.getLockedItemsForEquipment_('123', 'daily'));
  assert.deepEqual(locked.map(item => item.order), [3]);
});

test('其他設備的無效表單類型不影響本表，已完成者也不阻擋', () => {
  const rows = [INCIDENT_HEADERS,
    ['INC-9', 'EQP-2', '不明', 3, '別台', '2026-11-01', '別台異常', '處理中'],
    ['INC-10', '', '不明', 3, '無設備', '2026-11-01', '無設備', '處理中'],
    ['INC-11', 'EQP-1', '不明', 3, '舊資料', '2026-01-01', '舊', '已完成']];
  assert.deepEqual(lockedOrders(setup({ incidentRows: rows }).context), []);
});

test('舊分頁名稱仍可讀取', () => {
  const fixture = setup({ incidentRows: [INCIDENT_HEADERS, OPEN_INCIDENT] });
  fixture.sheets['異常事件'] = fixture.sheets[INCIDENT_SHEET];
  delete fixture.sheets[INCIDENT_SHEET];
  assert.deepEqual(lockedOrders(fixture.context), [3]);
});

// ===== 無法確認時必須失敗，不可當成沒有異常 =====
test('異常分頁不存在時拋錯', () => {
  const fixture = setup({ withoutIncidentSheet: true });
  assert.throws(() => lockedOrders(fixture.context), /無法核對未結案異常/);
});

test('異常分頁完全空白時拋錯', () => {
  const fixture = setup({ incidentRows: [['']] });
  assert.throws(() => lockedOrders(fixture.context), /無法核對未結案異常/);
});

['設備代號', '表單類型', '項次', '項目名稱', '通報日期', '異常說明', '狀態'].forEach(column => {
  test('異常表缺「' + column + '」欄時拋錯', () => {
    const headers = INCIDENT_HEADERS.map(name => (name === column ? column + '_已改名' : name));
    const fixture = setup({ incidentRows: [headers, OPEN_INCIDENT] });
    assert.throws(() => lockedOrders(fixture.context), new RegExp('無法核對未結案異常.*' + column));
  });
});

['', 'daily', '不明', null].forEach(type => {
  test('本設備未結案列的表單類型為 ' + JSON.stringify(type) + ' 時拋錯並指出事件', () => {
    const row = OPEN_INCIDENT.slice();
    row[2] = type;
    const fixture = setup({ incidentRows: [INCIDENT_HEADERS, row] });
    assert.throws(() => lockedOrders(fixture.context), /無法核對未結案異常.*INC-1.*表單類型/);
  });
});

['', '第3項', 0, null, -1, 3.5].forEach(order => {
  test('未結案異常項次為 ' + JSON.stringify(order) + ' 時拋錯並指出事件', () => {
    const row = OPEN_INCIDENT.slice();
    row[3] = order;
    const fixture = setup({ incidentRows: [INCIDENT_HEADERS, row] });
    assert.throws(() => lockedOrders(fixture.context), /無法核對未結案異常.*INC-1/);
  });
});

test('未結案異常沒有事件ID時改指出列號', () => {
  const row = OPEN_INCIDENT.slice();
  row[0] = '';
  row[3] = '';
  const fixture = setup({ incidentRows: [INCIDENT_HEADERS, row] });
  assert.throws(() => lockedOrders(fixture.context), /無法核對未結案異常.*第 2 列/);
});

test('試算表讀取失敗照常往外拋', () => {
  const fixture = setup();
  fixture.sheets[INCIDENT_SHEET].getDataRange = () => { throw new Error('Sheets 暫時失敗'); };
  assert.throws(() => lockedOrders(fixture.context), /Sheets 暫時失敗/);
});

// ===== 真實 doGet：前端必須收到看得懂的失敗，不能拿到空鎖定 =====
const BROKEN_DATA = [
  ['缺分頁', { withoutIncidentSheet: true }, /缺少機具設備異常事件分頁/],
  ['缺欄位', { incidentRows: [INCIDENT_HEADERS.filter(name => name !== '狀態'), OPEN_INCIDENT] }, /缺少「狀態」欄位/],
  ['無效項次', { incidentRows: [INCIDENT_HEADERS, ['INC-1', 'EQP-1', '每日', '', '第三項', '2026-11-01', '異常', '處理中']] }, /INC-1 缺少有效項次/],
  ['無效表單類型', { incidentRows: [INCIDENT_HEADERS, ['INC-1', 'EQP-1', '不明', 3, '第三項', '2026-11-01', '異常', '處理中']] }, /INC-1 缺少有效表單類型/],
];

BROKEN_DATA.forEach(([label, options, message]) => {
  ['checklistBootstrap', 'lockedItems'].forEach(api => {
    test(api + ' 在' + label + '時回傳原文錯誤且沒有鎖定清單', () => {
      const response = get(setup(options).context, { api, form: 'daily', eqp: 'EQP-1' });
      assert.equal(response.ok, false);
      assert.match(response.error, /^無法核對未結案異常：/);
      assert.match(response.error, message);
      assert.equal(response.locked, undefined);
    });
  });

  test('真實 doPost 在' + label + '時回傳原文錯誤且沒有副作用', () => {
    const fixture = setup(options);
    fixture.context.requirePublicSession_ = () => {};
    const output = fixture.context.doPost({
      parameter: {},
      postData: { contents: JSON.stringify(submission()) },
    });
    const response = JSON.parse(output.text);
    assert.equal(response.ok, false);
    assert.match(response.error, /^無法核對未結案異常：/);
    assert.match(response.error, message);
    assert.equal(fixture.world.pdfs, 0);
    assert.equal(fixture.world.writes, 0);
    assert.equal(fixture.world.locked, false);
  });
});

[99, 4].forEach(order => {
  test('未結案項次 ' + order + ' 不在目前表單內時，bootstrap 就回明確錯誤', () => {
    const row = OPEN_INCIDENT.slice();
    row[3] = order;
    const fixture = setup({ incidentRows: [INCIDENT_HEADERS, row] });
    const response = get(fixture.context, { api: 'checklistBootstrap', form: 'daily', eqp: 'EQP-1' });
    assert.equal(response.ok, false);
    assert.match(response.error, /^無法核對未結案異常：INC-1.*不在目前表單內/);
  });
});

test('未結案項次不在表單內且沒有事件ID時，改指出項次', () => {
  const row = OPEN_INCIDENT.slice();
  row[0] = '';
  row[3] = 99;
  const fixture = setup({ incidentRows: [INCIDENT_HEADERS, row] });
  const response = get(fixture.context, { api: 'checklistBootstrap', form: 'daily', eqp: 'EQP-1' });
  assert.equal(response.ok, false);
  assert.match(response.error, /^無法核對未結案異常：第 99 項 的項次不在目前表單內/);
});

test('項目順序為字串時，bootstrap 首次與快取都不誤擋', () => {
  const fixture = setup({ incidentRows: [INCIDENT_HEADERS, OPEN_INCIDENT] });
  fixture.sheets['檢查項目'].rows.slice(1).forEach(row => { row[1] = String(row[1]); });
  for (const label of ['首次', '快取']) {
    const response = get(fixture.context, { api: 'checklistBootstrap', form: 'daily', eqp: 'EQP-1' });
    assert.equal(response.ok, true, label);
    assert.deepEqual(response.locked.map(item => item.order), [3], label);
  }
});

test('checklistBootstrap 在資料正常時回傳模板與鎖定項', () => {
  const fixture = setup({ incidentRows: [INCIDENT_HEADERS, OPEN_INCIDENT] });
  const response = get(fixture.context, { api: 'checklistBootstrap', form: 'daily', eqp: 'EQP-1' });
  assert.equal(response.ok, true);
  assert.equal(response.meta.items.length, 3);
  assert.deepEqual(response.locked.map(item => item.order), [3]);
});

// ===== 真實 handleSubmission_：缺資料與鎖內即時查核 =====
test('正常送出完成一次 PDF 與紀錄（對照組）', () => {
  const fixture = setup();
  const result = fixture.context.handleSubmission_(submission());
  assert.equal(result.ok, true);
  assert.equal(fixture.world.pdfs, 1);
  assert.equal(fixture.world.writes, 1);
  assert.equal(fixture.world.locked, false);
});

test('異常表缺欄位時拒絕送出，不把未結案異常放行', () => {
  const headers = INCIDENT_HEADERS.map(name => (name === '狀態' ? '處理狀態' : name));
  const fixture = setup({ incidentRows: [headers, OPEN_INCIDENT] });
  assertRejectedWithoutSideEffects(fixture, submission(), /無法核對未結案異常/);
});

test('異常分頁不存在時拒絕送出', () => {
  const fixture = setup({ withoutIncidentSheet: true });
  assertRejectedWithoutSideEffects(fixture, submission(), /無法核對未結案異常/);
});

test('未結案項次不可改標正常，維持異常則可送出', () => {
  const rejected = setup({ incidentRows: [INCIDENT_HEADERS, OPEN_INCIDENT] });
  assertRejectedWithoutSideEffects(rejected, submission(), /仍有未處理異常/);

  const accepted = setup({ incidentRows: [INCIDENT_HEADERS, OPEN_INCIDENT] });
  assert.equal(accepted.context.handleSubmission_(submission({ 3: 'X' })).ok, true);
  assert.equal(accepted.world.writes, 1);
});

// 往返測試用真實 writeIncidents_：寫入端與讀取端對表頭的認定必須一致。
[null, ...INCIDENT_HEADERS].forEach(spaced => {
  const label = spaced ? '表頭「' + spaced + '」帶空白' : '表頭正常';
  test(label + '時，標異常後的下一次送出仍被鎖定', () => {
    const headers = INCIDENT_HEADERS.map(name => (name === spaced ? name + ' ' : name));
    const fixture = setup({ incidentRows: [headers], realWriteIncidents: true });
    assert.equal(fixture.context.handleSubmission_(submission({ 3: 'X' })).ok, true);

    const rows = fixture.sheets[INCIDENT_SHEET].rows;
    assert.equal(rows.length, 2, '應寫入一筆異常');
    const value = name => rows[1][INCIDENT_HEADERS.indexOf(name)];
    assert.equal(value('設備代號'), 'EQP-1');
    assert.equal(value('表單類型'), '每日');
    assert.equal(value('項次'), 3);
    assert.ok(value('事件ID'), '事件ID 不可空白');
    assert.ok(value('狀態'), '狀態不可空白');

    assert.deepEqual(lockedOrders(fixture.context), [3]);
    const pdfs = fixture.world.pdfs;
    const writes = fixture.world.writes;
    assert.throws(() => fixture.context.handleSubmission_(submission()), /仍有未處理異常/);
    assert.equal(fixture.world.pdfs, pdfs, '被拒絕的送出不可產生 PDF');
    assert.equal(fixture.world.writes, writes, '被拒絕的送出不可寫入紀錄');
  });
});

test('異常鎖定與模板都在取得鎖之後才讀取', () => {
  const fixture = setup();
  fixture.context.handleSubmission_(submission());
  assert.ok(fixture.sheets[INCIDENT_SHEET].readsWhileLocked >= 1, '異常表須在鎖內讀取');
  assert.ok(fixture.sheets['檢查項目'].readsWhileLocked >= 1, '檢查項目須在鎖內讀取');
});

test('等鎖期間新增的異常仍會擋下送出', () => {
  const fixture = setup();
  fixture.world.onLock = () => fixture.sheets[INCIDENT_SHEET].rows.push(OPEN_INCIDENT.slice());
  assertRejectedWithoutSideEffects(fixture, submission(), /仍有未處理異常/);
});

test('等鎖期間模板變更仍會擋下舊表單', () => {
  const fixture = setup();
  fixture.world.onLock = () => {
    fixture.sheets['檢查項目'].rows.push(['F-TEST-D', 4, '第四項', '', true]);
  };
  assertRejectedWithoutSideEffects(fixture, submission(), /模板已更新/);
});

test('等鎖期間設備停用仍會擋下送出', () => {
  const fixture = setup();
  fixture.world.onLock = () => { fixture.sheets['設備清單'].rows[1][7] = false; };
  assertRejectedWithoutSideEffects(fixture, submission(), /設備已停用/);
});

test('送出不可使用 60 秒公開模板快取', () => {
  const fixture = setup();
  const cached = get(fixture.context, { api: 'checklistBootstrap', form: 'daily', eqp: 'EQP-1' });
  assert.equal(cached.meta.items.length, 3);
  fixture.sheets['檢查項目'].rows.push(['F-TEST-D', 4, '第四項', '', true]);
  const stale = get(fixture.context, { api: 'meta', form: 'daily', eqp: 'EQP-1' });
  assert.equal(stale.meta.items.length, 3, '前提：公開查詢仍在快取期內');
  assertRejectedWithoutSideEffects(fixture, submission(), /模板已更新/);
});

test('送件計時依流程順序標記各段，被拒絕時停在驗證之後', () => {
  const marks = [];
  const fixture = setup();
  assert.equal(fixture.context.handleSubmission_(submission(), { mark: name => marks.push(name) }).ok, true);
  assert.deepEqual(marks, [
    '驗證與模板', '等待鎖', '重送檢查', '鎖定項目', '表單比對',
    '產生PDF或文件', '雲端硬碟', '寫紀錄', '異常追蹤', '異常通報', '主管通知',
  ]);

  const rejectedMarks = [];
  const rejected = setup({ incidentRows: [INCIDENT_HEADERS, OPEN_INCIDENT] });
  assert.throws(() => rejected.context.handleSubmission_(submission(), { mark: name => rejectedMarks.push(name) }), /仍有未處理異常/);
  assert.deepEqual(rejectedMarks, ['驗證與模板', '等待鎖', '重送檢查']);
});

console.log('異常鎖定 fail-closed 與鎖內查核測試通過：' + cases + ' 組。');
