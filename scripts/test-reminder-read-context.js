#!/usr/bin/env node

// 離線 fixture：不使用真實認證、收件者或網路。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../apps-script/Calendar.gs'), 'utf8');
const MAIN = '內外場-堆高機、移動式、危運、吊籠、一壓';
const AERIAL = '高空工作車';
const CRANE = '固定式起重機';

function calendar(tab, id, year, fields) {
  const values = Array.from({ length: 33 }, () => []);
  const starts = {};
  for (let month = 1; month <= 12; month += 1) {
    const start = values[0].length;
    starts[month] = start + 1;
    values[0].push('', `${month}月`, ...fields.map(() => ''));
    values[1].push('星期', '日期', ...fields);
    for (let day = 1; day <= 31; day += 1) {
      values[day + 1].push('一', day <= new Date(year, month, 0).getDate() ? day : '',
        ...fields.map(() => ''));
    }
  }
  values[0].push(''); values[1].push('');
  values[2].push('不應作為十二月課程的工程備註');
  const sheet = {
    getName: () => tab, getSheetId: () => id,
    getLastRow: () => values.length, getLastColumn: () => values[0].length,
    reads: 0,
    getRange(row, col, nr, nc) {
      sheet.reads += 1;
      if (sheet.fail) throw new Error('測試來源讀取失敗');
      return { getValues: () => Array.from({ length: nr }, (_, r) =>
        Array.from({ length: nc }, (_, c) => values[row + r - 1]?.[col + c - 1] ?? '')) };
    },
    set(month, day, field, value) { values[day + 1][starts[month] + field + 1] = value; },
    values,
  };
  return sheet;
}

function runtime() {
  const state = {
    settings: {
      venueSheetId: 'old2026', venueSheetsByYear: JSON.stringify({ 115: 'old2026', 116: 'new2027' }),
      venueUsageRequiredKeywords: '高空工作車=高',
      venueUsageSupplementalTabs: JSON.stringify({ [AERIAL]: [{ tab: MAIN, keywords: ['高空'] }] }),
    },
    failSettings: false, opens: [], settingsReads: 0,
  };
  const books = {};
  [2026, 2027].forEach(year => {
    const id = year === 2026 ? 'old2026' : 'new2027';
    const sheets = [calendar(MAIN, 1, year, ['內場-堆高機', '內場-一壓',
      '內場-移動式', '外場-堆高機', '外場-移動式、高空車']),
    calendar(CRANE, 2, year, ['固定式']), calendar(AERIAL, 3, year, ['高空工作車'])];
    books[id] = {
      getId: () => id, getName: () => `${year - 1911}-術科V1`,
      getSheetByName: name => sheets.find(sheet => sheet.getName() === name),
      getSheets: () => sheets, sheets,
    };
  });
  const settingsSheet = {
    getLastRow: () => Object.keys(state.settings).length + 1,
    getRange: () => ({ getValues: () => {
      state.settingsReads += 1;
      if (state.failSettings) throw new Error('設定服務不可用');
      return Object.entries(state.settings);
    } }),
  };
  const db = {
    getSheetByName: name => (name === '系統設定' ? settingsSheet : name === '填報紀錄' ? state.recordSheet : null),
  };
  const context = vm.createContext({
    Date,
    CONFIG: {
      DB_SHEET_ID: 'db', VENUE_SHEET_ID_FALLBACK: 'old2026', VENUE_SHEET_DEFAULT_TAB: CRANE,
      HOLIDAY_KEYWORDS_DEFAULT: ['元旦', '春節', '連假'],
      VENUE_USAGE_REQUIRED_KEYWORDS_DEFAULT: { 堆高機: ['堆'], 高空工作車: ['高'] },
    },
    cellStr_: value => String(value ?? '').trim(),
    dateParts_: date => ({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }),
    getSetting_: (key, fallback) => state.settings[key] || fallback,
    SpreadsheetApp: { openById: id => {
      state.opens.push(id);
      if (id === 'db') return db;
      if (!books[id]) throw new Error('測試來源不存在');
      return books[id];
    } },
  });
  vm.runInContext(source, context);
  function usage(category, iso, readContext, tab) {
    return context.getVenueUsage_({ category,
      venueSheetTab: tab || ({ 堆高機: MAIN, [AERIAL]: AERIAL, [CRANE]: CRANE })[category] },
    new Date(`${iso}T04:00:00Z`), readContext);
  }
  return { state, books, context, usage };
}

const actualReminder = fs.readFileSync('apps-script/Reminder.gs', 'utf8');

// 場地模組由另一項工作獨立發布；舊版仍須接受額外參數並維持行為。
// 沒有新版 context 能力時先驗證呼叫端介面，具備能力時執行下方真實讀取計數。
if (!source.includes('function getVenueReadState_')) {
  const contexts = [];
  const equipment = Array.from({ length: 6 }, (_, i) => ({
    equipmentId: 'LEGACY-' + i, category: '堆高機', active: true,
  }));
  const c = vm.createContext({ Logger: { log() {} } });
  vm.runInContext(actualReminder, c);
  Object.assign(c, {
    skipNonPrimaryDailyReminderRuntime_: () => null,
    beginDailyReminderRun_: () => ({}),
    finishDailyReminderRun_: () => {},
    todayStart_: () => new Date('2026-11-04T04:00:00Z'),
    getEquipmentList_: () => equipment,
    getEquipmentById_: id => equipment.find(row => row.equipmentId === id),
    getTemplateCyclesByCategory_: () => ({ 堆高機: ['每日'] }),
    getVenueUsage_: (row, date, context) => {
      assert(context && typeof context === 'object', '每次場地查詢須收到本次操作 context');
      contexts.push(context);
      return { used: false };
    },
  });
  const first = c.dailyReminderJob_({ dryRun: true });
  const second = c.dailyReminderJob_({ dryRun: true });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(contexts.length, 12);
  assert(contexts.slice(0, 6).every(value => value === contexts[0]));
  assert(contexts.slice(6).every(value => value === contexts[6]));
  assert.notEqual(contexts[0], contexts[6], '不同操作不可共用 context');
  assert(first.every(row => row.action === 'skip'));
  console.log('Reminder 舊場地介面相容性通過：同次 context 重用、跨次隔離；新版 Calendar 才執行完整讀取計數。');
  process.exit(0);
}

const baselineReminder = actualReminder
  .replace(/^\s*const venueReadContext = \{\};[^\n]*\r?\n/m, '\n')
  .replace('getVenueUsage_(full, today, venueReadContext)',
    'getVenueUsage_(full, today)');
assert(baselineReminder.includes('getVenueUsage_(full, today);'));
const candidateReminder = actualReminder;
assert(candidateReminder !== baselineReminder, '正式 Reminder 尚未加入單次場地 context');
const lineSource = fs.readFileSync('apps-script/LineWebhook.gs', 'utf8');
const configSource = fs.readFileSync('apps-script/Config.gs', 'utf8');
const settingStart = configSource.indexOf('let settingsReadSnapshot_');
const settingEnd = configSource.indexOf('/**\n * 取得場地表 ID', settingStart);
assert(settingStart >= 0 && settingEnd > settingStart);

function makeStatusRuntime(useContext, suppliedEquipment, realRecords) {
  const r = runtime();
  const equipment = suppliedEquipment || Array.from({ length: 6 }, (_, i) => ({
    equipmentId: 'TEST-' + i, category: '堆高機', active: true, venueSheetTab: MAIN,
  }));
  vm.runInContext(configSource.slice(settingStart, settingEnd), r.context);
  vm.runInContext(useContext ? candidateReminder : baselineReminder, r.context);
  vm.runInContext(lineSource, r.context);
  let sendCalls = 0;
  Object.assign(r.context, {
    Logger: { log() {} },
    skipNonPrimaryDailyReminderRuntime_: () => null,
    beginDailyReminderRun_: () => ({}),
    finishDailyReminderRun_: () => {},
    todayStart_: () => new Date('2027-05-18T04:00:00Z'),
    getEquipmentList_: () => equipment,
    getEquipmentById_: id => equipment.find(e => e.equipmentId === id),
    getTemplateCyclesByCategory_: () => Object.fromEntries(
      equipment.map(e => [e.category, ['每日']])),
    hasDailyRecordInCategory_: realRecords ? r.context.hasDailyRecordInCategory_ : () => false,
    sendUnfilledReminder_: () => { sendCalls += 1; },
    buildChecklistStatusFlex_: rows => rows,
    withQuickReply_: x => x,
    lineReply_: (token, messages) => messages,
  });
  r.run = () => r.context.withSettingsReadSnapshot_(() =>
    r.context.cmdStatus_('test-reply-token', 'test-user', {}))[0];
  r.counts = () => ({
    settingsReads: r.state.settingsReads,
    venueOpens: r.state.opens.filter(id => id === 'new2027').length,
    monthRangeReads: r.books.new2027.sheets[0].reads,
  });
  r.sendCalls = () => sendCalls;
  r.runJob = options => r.context.dailyReminderJob_(options);
  return r;
}

const before = makeStatusRuntime(false);
const after = makeStatusRuntime(true);
assert.equal(JSON.stringify(after.run()), JSON.stringify(before.run()));
assert.deepEqual(before.counts(), {
  settingsReads: 6, venueOpens: 6, monthRangeReads: 12,
});
assert.deepEqual(after.counts(), {
  settingsReads: 1, venueOpens: 1, monthRangeReads: 2,
});

// 第二次 LINE 操作必須取得新課表與新年度設定。
after.books.new2027.sheets[0].set(5, 18, 0, '新增堆高機課程');
const updated = after.run();
assert.equal(updated.filter(row => row.action === 'wouldMail').length, 1);
assert.equal(updated.find(row => row.action === 'wouldMail').usage, '新增堆高機課程');
assert.equal(after.state.settingsReads, 2);
after.state.settings.venueSheetsByYear = '{}';
assert(after.run().every(row => row.action === 'failed'));
assert.equal(after.state.settingsReads, 3);
assert.equal(after.sendCalls(), 0, '狀態查詢 dry-run 不可寄送');

// 失敗讀取不能成為「無使用」或成功快取，後續操作可復原。
const settingsFailure = makeStatusRuntime(true);
settingsFailure.state.failSettings = true;
assert(settingsFailure.run().every(row => row.action === 'failed'));
assert.equal(settingsFailure.state.settingsReads, 6,
  '設定服務讀取失敗時，每設備重試，不可保存失敗的空設定');
settingsFailure.state.failSettings = false;
assert(settingsFailure.run().every(row => row.action === 'skip'));
assert.equal(settingsFailure.sendCalls(), 0);

const monthFailure = makeStatusRuntime(true);
monthFailure.books.new2027.sheets[0].fail = true;
assert(monthFailure.run().every(row => row.action === 'failed'));
assert.equal(monthFailure.state.settingsReads, 1);
monthFailure.books.new2027.sheets[0].fail = false;
monthFailure.books.new2027.sheets[0].set(5, 18, 0, '恢復堆高機課程');
assert.equal(monthFailure.run().filter(row => row.action === 'wouldMail').length, 1);
assert.equal(monthFailure.sendCalls(), 0);

// 同一月份 raw data 可以重用，但各設備類別仍各自套用關鍵字。
const mixed = makeStatusRuntime(true, Array.from({ length: 6 }, (_, i) => ({
  equipmentId: 'MIXED-' + i, active: true, venueSheetTab: MAIN,
  category: i % 2 ? '高空工作車' : '堆高機',
})));
// 明確指定不重疊的測試關鍵字，避免「高」也命中「堆高機」的字詞歧義。
mixed.state.settings.venueUsageRequiredKeywords = '堆高機=堆高機;高空工作車=高空車';
mixed.books.new2027.sheets[0].set(5, 18, 0, '堆高機課程');
mixed.books.new2027.sheets[0].set(5, 18, 4, '高空車課程');
const notices = mixed.run().filter(row => row.action === 'wouldMail');
assert.equal(notices.length, 2);
assert.equal(notices.find(row => row.category === '堆高機').usage, '堆高機課程');
assert.equal(notices.find(row => row.category === '高空工作車').usage, '高空車課程');
assert.equal(mixed.state.settingsReads, 1);
assert.equal(mixed.books.new2027.sheets[0].reads, 2);
assert.equal(mixed.sendCalls(), 0);
// 正式通知以離線 stub 驗證同類別去重，沒有真實收件者或傳輸。
const notifyBefore = makeStatusRuntime(false);
const notifyAfter = makeStatusRuntime(true);
for (const r of [notifyBefore, notifyAfter]) {
  r.books.new2027.sheets[0].set(5, 18, 0, '堆高機課程');
}
const beforeRows = notifyBefore.runJob({ dryRun: false });
const afterRows = notifyAfter.runJob({ dryRun: false });
assert.equal(JSON.stringify(afterRows), JSON.stringify(beforeRows));
assert.equal(afterRows.filter(row => row.action === 'mailed').length, 1);
assert.equal(notifyBefore.sendCalls(), 1);
assert.equal(notifyAfter.sendCalls(), 1, '同類別六台仍只通知一次');
notifyAfter.books.new2027.sheets[0].set(5, 18, 0, '');
assert.equal(notifyAfter.runJob({ dryRun: false })
  .filter(row => row.action === 'mailed').length, 0);
assert.equal(notifyAfter.sendCalls(), 1, '下一操作空課表不得沿用前次課程寄送');

// 場地防護具：沿用前段已讀的場地與填報紀錄，結果要和各自重新讀取完全相同。
const ppeSource = fs.readFileSync('apps-script/DailyPpeAssignment.gs', 'utf8');
function makePpeRuntime(headers = ['檢查日期', '表單類型', '設備類別', ' 設備代號 ']) {
  const r = makeStatusRuntime(true, [
    { equipmentId: 'FORK-1', category: '堆高機', active: true, venueSheetTab: MAIN },
    { equipmentId: 'FORK-2', category: '堆高機', active: true, venueSheetTab: MAIN },
    { equipmentId: 'VENUE-FORK', category: '防護具檢點', active: true, venueSheetTab: MAIN },
    { equipmentId: 'VENUE-CRANE', category: '防護具檢點', active: true, venueSheetTab: CRANE },
  ], true);
  vm.runInContext(ppeSource, r.context);
  r.context.formatISODate_ = date => date.toISOString().slice(0, 10);
  r.context.parseISODate_ = iso => new Date(iso + 'T04:00:00Z');
  r.recordReads = 0;
  const rows = [
    headers,
    [new Date('2027-05-18T04:00:00Z'), '每日', '防護具檢點', 'VENUE-FORK'],
    // 昨天的日檢與今天的月檢都不算今天已填，少了這兩個條件會漏發。
    ['2027-05-17', '每日', '防護具檢點', 'VENUE-CRANE'],
    ['2027-05-18', '每月', '防護具檢點', 'VENUE-CRANE'],
  ];
  r.state.recordSheet = {
    getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => { r.recordReads += 1; return rows; } }),
  };
  r.books.new2027.sheets[0].set(5, 18, 0, '堆高機課程');
  r.books.new2027.sheets[1].set(5, 18, 0, '固定式課程');
  r.lookups = { byName: 0, workbookName: 0 };
  const book = r.books.new2027;
  const getSheetByName = book.getSheetByName;
  book.getSheetByName = name => { r.lookups.byName += 1; return getSheetByName(name); };
  const getName = book.getName;
  book.getName = () => { r.lookups.workbookName += 1; return getName(); };
  return r;
}
const ppeRows = rows => rows.filter(row => row.type === 'dailyPpeStatus');

// 防護具掃描只對表單類型與設備相符的列轉日期，結果不變。
const ppeScan = makePpeRuntime();
ppeScan.state.recordSheet.getDataRange = () => ({ getValues: () => [
  ['檢查日期', '表單類型', '設備類別', '設備代號'],
  [new Date('2027-05-18T04:00:00Z'), '每日', '防護具檢點', 'VENUE-CRANE'],
  [new Date('2027-05-18T04:00:00Z'), '每月', '防護具檢點', 'VENUE-FORK'],
  [new Date('2027-05-18T04:00:00Z'), '每日', '防護具檢點', 'VENUE-FORK'],
] });
let ppeConversions = 0;
const ppeFormat = ppeScan.context.formatISODate_;
ppeScan.context.formatISODate_ = date => { ppeConversions += 1; return ppeFormat(date); };
assert.equal(ppeScan.context.dailyPpeHasDailyRecordForEquipment_('VENUE-FORK', ppeScan.context.todayStart_()), true);
assert.equal(ppeConversions, 2, '目標日期一次，相符的日檢列一次');

// 防護具判定維持去除前後空白：這三種已填紀錄都要分開驗證，否則第一列命中就測不到後面。
[
  [' 2027-05-18 ', '每日', '防護具檢點', 'VENUE-FORK'],
  ['2027-05-18', ' 每日 ', '防護具檢點', 'VENUE-FORK'],
  ['2027-05-18', '每日', '防護具檢點', ' VENUE-FORK '],
].forEach(row => {
  const r = makePpeRuntime();
  r.state.recordSheet.getDataRange = () => ({ getValues: () => [
    ['檢查日期', '表單類型', '設備類別', '設備代號'], row,
  ] });
  assert.equal(r.context.dailyPpeHasDailyRecordForEquipment_('VENUE-FORK', r.context.todayStart_()), true,
    JSON.stringify(row));
});

const ppeStatus = makePpeRuntime();
const ppeResult = ppeRows(ppeStatus.runJob({ dryRun: true, reuseDailyRecords: true }));
assert.equal(ppeResult.find(row => row.equipmentId === 'VENUE-FORK').alreadyFilled, true,
  '共用紀錄時表頭前後空白仍要對得到設備代號');
assert.equal(ppeResult.find(row => row.equipmentId === 'VENUE-CRANE').alreadyFilled, false);
assert.equal(ppeStatus.recordReads, 1, '狀態查詢的填報紀錄只讀一次');
assert.equal(ppeStatus.state.settingsReads, 1, '場地設定只讀一次');
assert.equal(ppeStatus.state.opens.filter(id => id === 'new2027').length, 1, '場地表只開一次');
assert.equal(ppeStatus.lookups.byName, 2, '兩個分頁各查一次，不隨設備台數增加');
assert.equal(ppeStatus.lookups.workbookName, 1, '場地表年度只驗證一次');
assert.equal(ppeStatus.books.new2027.sheets[0].reads, 2, '同月份原始資料只讀一次');

const ppeAlone = makePpeRuntime();
const ppeAloneRows = ppeAlone.context.dailyPpeChecklistStatusResults_(ppeAlone.context.todayStart_());
assert.equal(JSON.stringify(ppeAloneRows), JSON.stringify(ppeResult), '不傳 context 時結果相同');
assert.equal(ppeAlone.recordReads, 2, '不傳 context 時仍各自重新讀取');
assert.equal(ppeAlone.state.settingsReads, 2);

// 正式提醒只共用場地資料，填報紀錄每次都重新查核。
const ppeFormal = makePpeRuntime();
ppeFormal.runJob({ dryRun: false });
assert.equal(ppeFormal.recordReads, 4, '正式提醒的兩台設備與兩項防護具都要重新讀紀錄');
assert.equal(ppeFormal.state.settingsReads, 1);
assert.equal(ppeFormal.sendCalls(), 1);

// 共用資料缺欄位時仍要回報失敗，不可當成未填或已填。
const ppeMissing = makePpeRuntime(['檢查日期', '表單類型', '設備類別']);
const ppeMissingRows = ppeMissing.runJob({ dryRun: true, reuseDailyRecords: true });
assert.equal(ppeRows(ppeMissingRows).length, 0);
assert.equal(ppeMissingRows.filter(row => row.action === 'failed' && row.category === '場地防護具狀態').length, 1);

// 場地表年度驗證失敗不保存：每台設備都要重新驗證並回報失敗，不可改讀錯誤年度的資料。
const wrongYear = makeStatusRuntime(true);
let workbookNameCalls = 0;
wrongYear.books.new2027.getName = () => { workbookNameCalls += 1; return '115-術科V1'; };
wrongYear.books.new2027.sheets[0].set(5, 18, 0, '堆高機課程');
const wrongYearRows = wrongYear.run();
assert.equal(wrongYearRows.length, 6);
assert(wrongYearRows.every(row => row.action === 'failed'), '年度不符時每台設備都要失敗');
assert.equal(workbookNameCalls, 6);

// 補充分頁與主分頁相同時不重複列出來源。
const sameTab = runtime();
sameTab.books.new2027.sheets[0].set(5, 18, 4, '高空車課程');
assert.equal(sameTab.usage(AERIAL, '2027-05-18', {}, MAIN).sources.length, 1);

// 分頁找不到不保存，下一台設備要重查而不是沿用空結果。
const missingTab = makePpeRuntime();
const realGetSheetByName = missingTab.books.new2027.getSheetByName;
let hideMainTab = true;
missingTab.books.new2027.getSheetByName = name => (hideMainTab && name === MAIN ? null : realGetSheetByName(name));
missingTab.books.new2027.getSheets = () => [];
const venueContext = {};
const probe = { category: '堆高機', venueSheetTab: MAIN };
const when = missingTab.context.todayStart_();
assert.throws(() => missingTab.context.getVenueUsage_(probe, when, venueContext), /場地表分頁不存在/);
hideMainTab = false;
assert.equal(missingTab.context.getVenueUsage_(probe, when, venueContext).used, true);

console.log('Reminder 場地讀取整合測試通過：6/6/12→1/1/2、狀態一致、跨操作更新、失敗復原、類別隔離及通知去重。');
