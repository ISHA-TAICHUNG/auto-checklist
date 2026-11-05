#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../apps-script/Calendar.gs'), 'utf8');
const MAIN = '內外場-堆高機、移動式、危運、吊籠、一壓';
const AERIAL = '高空工作車';
const CRANE = '固定式起重機';
let checks = 0;

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
  const db = { getSheetByName: name => name === '系統設定' ? settingsSheet : null };
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

function test(name, fn) { fn(); checks += 1; console.log(`✓ ${name}`); }

test('115/12/31 與116/1/1各讀自己的年度，歷史查詢不變', () => {
  const { books, usage } = runtime();
  books.old2026.sheets[0].set(12, 31, 0, '115堆課程');
  books.new2027.sheets[0].set(1, 1, 0, '116堆課程');
  assert.equal(usage('堆高機', '2026-12-31').content, '115堆課程');
  assert.equal(usage('堆高機', '2027-01-01').content, '116堆課程');
});

test('中控台傳入115來源仍依116日期重開，不繞過年度設定', () => {
  const { books, usage } = runtime();
  books.old2026.sheets[0].set(5, 18, 0, '舊堆');
  books.new2027.sheets[0].set(5, 18, 3, '新外場堆');
  assert.equal(usage('堆高機', '2027-05-18', { spreadsheet: books.old2026 }).content, '新外場堆');
});

test('同context跨年重用時，錯配同一試算表仍檢查年度', () => {
  const { state, usage } = runtime();
  state.settings.venueSheetsByYear = '{"115":"old2026","116":"old2026"}';
  const context = {};
  usage('堆高機', '2026-12-31', context);
  assert.throws(() => usage('堆高機', '2027-01-01', context), /標題年度/);
});

test('同context正常跨年仍各選正確來源', () => {
  const { books, usage } = runtime();
  books.old2026.sheets[0].set(1, 2, 0, '115堆');
  books.new2027.sheets[0].set(1, 2, 0, '116堆');
  const context = {};
  assert.equal(usage('堆高機', '2026-01-02', context).content, '115堆');
  assert.equal(usage('堆高機', '2027-01-02', context).content, '116堆');
});

test('五個場地欄全讀、星期與其他課程排除，回傳來源座標', () => {
  const { books, usage } = runtime();
  books.new2027.sheets[0].set(5, 18, 0, '吊總');
  books.new2027.sheets[0].set(5, 18, 3, '外場堆1');
  const result = usage('堆高機', '2027-05-18');
  assert.equal(result.used, true); assert.equal(result.content, '外場堆1');
  assert.equal(result.sources.find(row => row.used).field, '外場-堆高機');
  assert.match(result.sources.find(row => row.used).cell, /^[A-Z]+20$/);
});

test('假日逐格排除，不蓋掉另一個場地的有效課程', () => {
  const { books, usage } = runtime();
  books.new2027.sheets[0].set(5, 18, 0, '連假');
  books.new2027.sheets[0].set(5, 18, 3, '外場堆1');
  assert.equal(usage('堆高機', '2027-05-18').used, true);
});

test('高空獨立分頁空白時補讀綜合後欄，堆高機不誤算高空', () => {
  const { books, usage } = runtime();
  books.new2027.sheets[0].set(5, 18, 4, '5/17高空車');
  assert.equal(usage(AERIAL, '2027-05-18').content, '5/17高空車');
  books.new2027.sheets[0].set(5, 18, 4, '忠明堆高機');
  assert.equal(usage(AERIAL, '2027-05-18').used, false);
});

test('高空兩來源取聯集、重複內容去重但保留來源', () => {
  const { books, usage } = runtime();
  books.new2027.sheets[0].set(5, 18, 4, '高空車');
  books.new2027.sheets[2].set(5, 18, 0, '高空車');
  const result = usage(AERIAL, '2027-05-18');
  assert.equal(result.content, '高空車'); assert.equal(result.sources.filter(row => row.used).length, 2);
});

test('一來源有使用，另一來源讀取失敗仍報錯', () => {
  const { books, usage } = runtime();
  books.new2027.sheets[2].set(5, 18, 0, '高空車');
  books.new2027.sheets[0].fail = true;
  assert.throws(() => usage(AERIAL, '2027-05-18'), /來源讀取失敗/);
});

test('補充分頁不存在或日期列缺漏都回報錯誤', () => {
  const { state, books, usage } = runtime();
  state.settings.venueUsageSupplementalTabs = JSON.stringify({ [AERIAL]: [{ tab: '不存在', keywords: ['高空'] }] });
  assert.throws(() => usage(AERIAL, '2027-05-18'), /補充場地表分頁不存在/);
  books.new2027.sheets[0].values[2][1] = '';
  assert.throws(() => usage('堆高機', '2027-01-01'), /找不到該日/);
});

test('設定讀取失敗不回退115，年度缺漏與壞JSON均報錯', () => {
  const { state, usage } = runtime();
  state.failSettings = true;
  assert.throws(() => usage('堆高機', '2027-01-01'), /設定服務不可用/);
  state.failSettings = false;
  state.settings.venueSheetsByYear = '{';
  assert.throws(() => usage('堆高機', '2027-01-01'), /JSON/);
  state.settings.venueSheetsByYear = '{}';
  assert.throws(() => usage('堆高機', '2027-01-01'), /尚未設定民國 116/);
});

test('拒絕陣列、空ID、衝突年度；支援西元鍵且驗證檔名年份', () => {
  const { state, usage, books } = runtime();
  for (const value of ['[]', '{"116":""}', '{"116":"new2027","2027":"old2026"}']) {
    state.settings.venueSheetsByYear = value;
    assert.throws(() => usage('堆高機', '2027-01-01'));
  }
  state.settings.venueSheetsByYear = '{"2027":"new2027"}';
  assert.equal(usage('堆高機', '2027-01-01').year, 116);
  books.new2027.getName = () => '115-術科V1';
  assert.throws(() => usage('堆高機', '2027-01-01'), /標題年度/);
});

test('未設定年度map保留單一來源舊用法與gid解析', () => {
  const { state, books, usage } = runtime();
  delete state.settings.venueSheetsByYear;
  books.old2026.sheets[1].set(1, 2, 0, '固定式課程');
  assert.equal(usage(CRANE, '2026-01-02', undefined, 'gid:2').content, '固定式課程');
});

test('四月五月月界、不同日期與右側工程備註不串欄', () => {
  const { books, usage } = runtime();
  books.new2027.sheets[0].set(4, 30, 4, '四月堆');
  books.new2027.sheets[0].set(5, 1, 0, '五月堆');
  assert.equal(usage('堆高機', '2027-04-30').content, '四月堆');
  assert.equal(usage('堆高機', '2027-05-01').content, '五月堆');
  assert.equal(usage(CRANE, '2027-12-01').used, false);
});

test('固定式總保留使用且不再列疑義，純會議排除，混合假日保留待確認', () => {
  const { books, usage } = runtime();
  const fixed = books.new2027.sheets[1];
  fixed.set(2, 16, 0, '總');
  const result = usage(CRANE, '2027-02-16');
  assert.equal(result.used, true); assert.equal(result.needsReview, false);
  fixed.set(2, 16, 0, '策略規劃會議');
  assert.equal(usage(CRANE, '2027-02-16').used, false);
  fixed.set(2, 16, 0, '總/228連假');
  assert.equal(usage(CRANE, '2027-02-16').used, false);
  assert.equal(usage(CRANE, '2027-02-16').needsReview, true);
});

test('確認不操作的文字優先於堆字，保留原文與排除原因', () => {
  const { books, usage } = runtime();
  books.new2027.sheets[0].set(4, 27, 0, '龍井印堆2/考職安乙不能考即測');
  const result = usage('堆高機', '2027-04-27');
  assert.equal(result.used, false); assert.equal(result.needsReview, false);
  assert.match(result.reason, /不操作機具/);
  assert.equal(result.sources[0].content, '龍井印堆2/考職安乙不能考即測');
});

test('吊與堆只按關鍵字判類別，正常簡寫不產生疑義', () => {
  const { books, usage } = runtime();
  const sheet = books.new2027.sheets[0];
  for (const text of ['吊總', '即吊4', '即1吊5(人多再考吊6)']) {
    sheet.set(3, 17, 0, text);
    const result = usage('移動式起重機', '2027-03-17', undefined, MAIN);
    assert.equal(result.used, true); assert.equal(result.needsReview, false);
    assert.equal(result.sources[0].matchedMachineKeywords.some(row =>
      row.category === '移動式起重機' && row.keywords.includes('吊')), true);
    assert.equal(usage('堆高機', '2027-03-17').used, false);
  }
  sheet.set(3, 17, 0, '堆總');
  assert.equal(usage('堆高機', '2027-03-17').used, true);
  assert.equal(usage('移動式起重機', '2027-03-17', undefined, MAIN).used, false);
});

test('固、地面、機上都有固定式辨識證據，專頁吊掛不被重新分類排除', () => {
  const { books, usage } = runtime();
  const sheet = books.new2027.sheets[1];
  for (const text of ['龍井三下固1', '井地面印4', '龍井機上日1', '即固6']) {
    sheet.set(3, 15, 0, text);
    const result = usage(CRANE, '2027-03-15');
    assert.equal(result.used, true); assert.equal(result.needsReview, false);
    assert.equal(result.sources[0].matchedMachineKeywords.some(row => row.category === CRANE), true);
  }
  sheet.set(3, 15, 0, '龍井吊掛1');
  assert.equal(usage(CRANE, '2027-03-15').used, true);
});

test('預暫不影響機具關鍵字，也不把一般考職安乙擴成停用', () => {
  const { books, usage } = runtime();
  for (const text of ['龍井堆日1預台電', '考職安乙暫/井堆印1', '考職安乙/堆高機']) {
    books.new2027.sheets[0].set(8, 27, 0, text);
    const result = usage('堆高機', '2027-08-27');
    assert.equal(result.used, true); assert.equal(result.needsReview, false);
    assert.equal(result.content, text);
  }
});

test('同日只排除確認不操作的格，其他欄有效堆課程仍計入', () => {
  const { books, usage } = runtime();
  const sheet = books.new2027.sheets[0];
  sheet.set(4, 27, 0, '堆高機/考職安乙 不能考\n即測');
  sheet.set(4, 27, 3, '外場堆1');
  const result = usage('堆高機', '2027-04-27');
  assert.equal(result.used, true); assert.equal(result.content, '外場堆1');
  assert.equal(result.sources[0].used, false);
  assert.match(result.sources[0].reason, /不操作機具/);
});

test('待考區與挖掘擬真只占空間，固定式專頁或含堆字也不算操作', () => {
  const { books, usage } = runtime();
  for (const text of ['須要待考區', '需要待考區', '考挖掘擬真', '堆高機/須要待考區']) {
    books.new2027.sheets[1].set(2, 24, 0, text);
    const result = usage(CRANE, '2027-02-24');
    assert.equal(result.used, false); assert.equal(result.needsReview, false);
    assert.match(result.reason, /僅占用空間/);
  }
});

test('地名錯字不影響堆辨識，高機按確認別名算堆高機而非高空', () => {
  const { books, context, usage } = runtime();
  books.new2027.sheets[0].set(8, 21, 3, '籠井堆假1');
  const forklift = usage('堆高機', '2027-08-21');
  assert.equal(forklift.used, true); assert.equal(forklift.needsReview, false);
  books.new2027.sheets[0].set(11, 25, 4, '11/23忠明高機');
  const aerial = usage(AERIAL, '2027-11-25');
  assert.equal(aerial.used, false); assert.equal(aerial.needsReview, false);
  const result = usage('堆高機', '2027-11-25');
  assert.equal(result.used, true); assert.equal(result.needsReview, false);
  assert.equal(result.content, '11/23忠明高機');
  assert.equal(context.getVenueMachineKeywordMatches_('11/23忠明高機')[0].category, '堆高機');
});

test('獨立高空分頁也不將高機或堆高機誤算高空', () => {
  const { books, usage } = runtime();
  const sheet = books.new2027.sheets[2];
  for (const [text, used, needsReview] of [['忠明高機', false, false],
    ['堆高機', false, false], ['高空車', true, false], ['堆高機/高空車', true, false]]) {
    sheet.set(11, 25, 0, text);
    const result = usage(AERIAL, '2027-11-25');
    assert.equal(result.used, used); assert.equal(result.needsReview, needsReview);
  }
});

test('高機別名保留自訂關鍵字原文匹配，其他類別不擴充', () => {
  const { state, books, context, usage } = runtime();
  books.new2027.sheets[0].set(11, 25, 4, '11/23忠明高機');
  for (const keyword of ['堆', '堆高機', '高機', '忠明高機']) {
    state.settings.venueUsageRequiredKeywords = '堆高機=' + keyword;
    assert.equal(usage('堆高機', '2027-11-25').used, true);
  }
  assert.equal(context.matchesVenueCategoryKeywords_('高機', ['堆'], '移動式起重機'), false);
  state.settings.venueUsageRequiredKeywords = '堆高機=龍井';
  assert.equal(usage('堆高機', '2027-11-25').used, false);
  assert.equal(context.matchesVenueCategoryKeywords_('堆高機', ['堆高機'], '堆高機'), true);
});

test('同格高機與明確高空可分別命中兩類，原文保持不變', () => {
  const { books, usage } = runtime();
  const text = '忠明高機/高空車';
  books.new2027.sheets[0].set(11, 25, 4, text);
  for (const category of ['堆高機', AERIAL]) {
    const result = usage(category, '2027-11-25');
    assert.equal(result.used, true); assert.equal(result.content, text);
    assert.equal(result.needsReview, false);
  }
});

test('高機別名不繞過不操作、占空間與假日優先', () => {
  const { books, usage } = runtime();
  for (const text of ['高機/考職安乙不能考即測', '高機/須要待考區', '高機/考挖掘擬真', '高機/連假']) {
    books.new2027.sheets[0].set(11, 25, 4, text);
    const result = usage('堆高機', '2027-11-25');
    assert.equal(result.used, false); assert.ok(result.reason);
  }
});

test('重複名字與期別編號不跨日期去重，每次重新讀最新課表', () => {
  const { books, usage } = runtime();
  const sheet = books.new2027.sheets[1];
  const text = '龍井機上日1預漢翔';
  sheet.set(3, 15, 0, text); sheet.set(3, 16, 0, text);
  for (const date of ['2027-03-15', '2027-03-16']) {
    const result = usage(CRANE, date);
    assert.equal(result.used, true); assert.equal(result.needsReview, false);
    assert.equal(result.content, text);
  }
  sheet.set(3, 15, 0, '須要待考區');
  assert.equal(usage(CRANE, '2027-03-15').used, false);
  assert.equal(usage(CRANE, '2027-03-16').used, true);
});

test('未回答的課程混合會員大會保留原判定及待確認標記', () => {
  const { books, usage } = runtime();
  books.new2027.sheets[1].set(4, 24, 0, '龍井機上夜2/會員大會');
  const result = usage(CRANE, '2027-04-24');
  assert.equal(result.used, true); assert.equal(result.needsReview, true);
});

test('同次context重用讀取，下次查詢讀取課表更新', () => {
  const { state, books, usage } = runtime();
  const readContext = {};
  books.new2027.sheets[0].set(5, 18, 0, '堆1');
  usage('堆高機', '2027-05-18', readContext);
  const reads = books.new2027.sheets[0].reads;
  usage('堆高機', '2027-05-18', readContext);
  assert.equal(state.settingsReads, 1); assert.equal(books.new2027.sheets[0].reads, reads);
  books.new2027.sheets[0].set(5, 18, 0, '堆2');
  assert.equal(usage('堆高機', '2027-05-18').content, '堆2');
});

test('日期數字文字與日期物件均可讀，來源分頁缺失明確失敗', () => {
  const { books, usage } = runtime();
  const main = books.new2027.sheets[0];
  main.values[2][1] = '1'; main.set(1, 1, 0, '堆1');
  assert.equal(usage('堆高機', '2027-01-01').used, true);
  main.values[2][1] = new Date('2027-01-01T04:00:00Z');
  assert.equal(usage('堆高機', '2027-01-01').used, true);
  assert.throws(() => usage('堆高機', '2027-01-01', undefined, '不存在'), /分頁不存在/);
});

console.log(`場地年度銜接：${checks} 組行為驗證通過。`);
