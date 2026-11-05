/**
 * ===== 場地使用判斷 =====
 *
 * 用途：依 DB 系統設定 venueSheetsByYear 選年度來源；未配置時相容 venueSheetId。
 *
 * 場地表結構（橫式行事曆，每月日期欄＋一至多個場地內容欄）：
 *   列 1：1月 _ 2月 _ 3月 _ ... 12月 _
 *   列 2：星期 日期 固定式｜日期 固定式｜日期 固定式｜...
 *   列 3+：星期(A) 1日(B) 課程(C) | 1日(D) 課程(E) | 1日(F) 課程(G) | ...
 *
 * 日期欄可能是純數字、文字、或日期型別（依使用者輸入而定），這裡都處理。
 */

const VENUE_CALENDAR_VERSION = '2026-11-04.3';

/** 依檢查日期選年度，再逐格合併同類別場地；讀取失敗不能當成沒有使用。 */
function getVenueUsage_(equipment, date, context) {
  const parts = dateParts_(date);
  const state = getVenueReadState_(context);
  const source = resolveVenueYearSource_(parts.y, state.settings);
  let ss = state.spreadsheets[source.id];
  if (!ss) {
    const supplied = context && context.spreadsheet;
    ss = supplied && supplied.getId() === source.id
      ? supplied : SpreadsheetApp.openById(source.id);
    state.spreadsheets[source.id] = ss;
  }
  const workbookYear = source.id + ':' + parts.y;
  if (source.mapped && !state.validatedWorkbookYears[workbookYear]) {
    validateVenueWorkbookYear_(ss, parts.y);
    state.validatedWorkbookYears[workbookYear] = true;
  }
  const tabName = equipment.venueSheetTab || CONFIG.VENUE_SHEET_DEFAULT_TAB;
  const primary = getCachedVenueSheet_(ss, source.id, tabName, state);
  if (!primary) throw new Error('場地表分頁不存在：' + tabName);
  const required = getVenueUsageRequiredKeywords_(equipment, state.settings);
  const definitions = [{ sheet: primary, keywords: required }];
  getVenueSupplementalTabs_(state.settings, equipment.category).forEach(def => {
    const sheet = getCachedVenueSheet_(ss, source.id, def.tab, state);
    if (!sheet) throw new Error('補充場地表分頁不存在：' + def.tab);
    if (sheet.sheetId !== primary.sheetId) {
      definitions.push({ sheet, keywords: def.keywords });
    }
  });

  // 先完成所有來源讀取，避免第一頁有課就掩蓋另一頁讀取失敗。
  const cells = [];
  definitions.forEach(def => {
    readVenueMonthCells_(def.sheet, parts, source.id, state).forEach(cell => {
      cells.push(Object.assign({}, cell, { keywords: def.keywords }));
    });
  });
  const sources = cells.filter(cell => cell.content).map(cell => {
    let reason = null;
    const nonOperation = getVenueNonOperationReason_(cell.content);
    const holiday = state.holidays.find(kw => kw && cell.content.indexOf(kw) >= 0);
    if (nonOperation) reason = nonOperation;
    else if (holiday) reason = '節假日（' + holiday + '）';
    else if (/^(策略規劃會議|會員大會|台中林酒店春酒|春酒)$/.test(cell.content)) {
      reason = '非機具使用活動';
    } else if (equipment.category === '高空工作車' && cell.content.indexOf('高機') >= 0 &&
        cell.content.indexOf('高空') < 0) {
      reason = '未命中高空工作車明確關鍵字（高空）';
    } else if (cell.keywords.length && !matchesVenueCategoryKeywords_(
      cell.content, cell.keywords, equipment.category)) {
      reason = '未命中' + equipment.category + '使用關鍵字（' + cell.keywords.join('、') + '）';
    }
    return {
      tab: cell.tab, cell: cell.cell, field: cell.field, content: cell.content,
      used: !reason, reason,
      matchedMachineKeywords: getVenueMachineKeywordMatches_(cell.content),
      needsReview: venueContentNeedsReview_(cell.content, state.holidays),
    };
  });
  const usedSources = sources.filter(row => row.used);
  const contents = [...new Set((usedSources.length ? usedSources : sources).map(row => row.content))];
  return {
    used: usedSources.length > 0,
    content: contents.join('；'),
    reason: usedSources.length ? null : sources.length ? sources[0].reason : null,
    year: parts.y - 1911,
    calendarVersion: VENUE_CALENDAR_VERSION,
    sources,
    needsReview: sources.some(row => row.needsReview),
  };
}

/** 使用者已確認的非操作內容，優先於機具字詞；不擴張成整日停用。 */
function getVenueNonOperationReason_(content) {
  const text = String(content || '').replace(/\s/g, '');
  if (text.indexOf('考職安乙不能考即測') >= 0) return '不操作機具（考職安乙不能考即測）';
  if (text.indexOf('待考區') >= 0 || text.indexOf('挖掘擬真') >= 0) {
    return '僅占用空間（待考區／挖掘擬真）';
  }
  return null;
}

/** 簡寫僅提供辨識證據，不推算期別或改變專屬分頁的既有類別。 */
function getVenueMachineKeywordMatches_(content) {
  const definitions = [
    { category: '堆高機', keywords: ['堆', '高機'] },
    { category: '移動式起重機', keywords: ['移動式', '吊'] },
    { category: '固定式起重機', keywords: ['固', '地面', '機上'] },
    { category: '高空工作車', keywords: ['高空'] },
  ];
  const text = String(content || '');
  return definitions.map(def => ({
    category: def.category, keywords: def.keywords.filter(keyword => text.indexOf(keyword) >= 0),
  })).filter(def => def.keywords.length);
}

function venueContentNeedsReview_(content, holidays) {
  const text = String(content || '');
  if (getVenueNonOperationReason_(text)) return false;
  if (/(?:^|[\/／\n])喬-/.test(text)) return true;
  const hasHoliday = holidays.some(keyword => keyword && text.indexOf(keyword) >= 0);
  const mixedHoliday = hasHoliday && text.split(/[\/／\n]/).some(part =>
    part.trim() && !holidays.some(keyword => keyword && part.indexOf(keyword) >= 0));
  const mixedMeeting = /策略規劃會議|會員大會|春酒/.test(text) &&
    !/^(策略規劃會議|會員大會|台中林酒店春酒|春酒)$/.test(text);
  return mixedHoliday || mixedMeeting;
}

/** 僅重用呼叫端傳入的單次執行 context，不建立跨請求快取。 */
function getVenueReadState_(context) {
  if (context && context.venueCalendarState &&
      context.venueCalendarState.dbId === CONFIG.DB_SHEET_ID) return context.venueCalendarState;
  const db = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = db.getSheetByName('系統設定');
  if (!sheet) throw new Error('場地年度設定無法讀取：缺少系統設定分頁');
  const settings = Object.create(null);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(row => {
      const key = String(row[0] || '').trim();
      if (key && !Object.prototype.hasOwnProperty.call(settings, key)) settings[key] = row[1];
    });
  }
  let holidays = context && context.holidays;
  if (!holidays) {
    const holidaySheet = db.getSheetByName('節假日關鍵字');
    holidays = holidaySheet && holidaySheet.getLastRow() > 1
      ? holidaySheet.getRange(2, 1, holidaySheet.getLastRow() - 1, 1).getValues()
        .map(row => String(row[0] || '').trim()).filter(Boolean)
      : CONFIG.HOLIDAY_KEYWORDS_DEFAULT;
  }
  const state = {
    dbId: CONFIG.DB_SHEET_ID, settings, holidays,
    spreadsheets: {}, months: {}, sheets: {}, validatedWorkbookYears: {},
  };
  if (context) context.venueCalendarState = state;
  return state;
}

function resolveVenueYearSource_(year, settings) {
  const raw = settings.venueSheetsByYear;
  if (raw === undefined || raw === null || raw === '') {
    const id = String(settings.venueSheetId || CONFIG.VENUE_SHEET_ID_FALLBACK || '').trim();
    if (!id) throw new Error('尚未設定場地使用試算表');
    return { id, mapped: false };
  }
  const entries = parseVenueConfigObject_(raw, 'venueSheetsByYear');
  const normalized = Object.create(null);
  Object.keys(entries).forEach(key => {
    if (!/^\d{3,4}$/.test(key)) throw new Error('年度場地設定含無效年份');
    const value = entries[key];
    const y = Number(key) < 1911 ? Number(key) + 1911 : Number(key);
    if (y < 1912 || y > 2200 || typeof value !== 'string' || !/^[\w-]+$/.test(value)) {
      throw new Error('年度場地設定含無效年份或試算表 ID');
    }
    if (normalized[y] && normalized[y] !== value) throw new Error('年度場地設定有重複衝突');
    normalized[y] = value;
  });
  if (!normalized[year]) throw new Error('尚未設定民國 ' + (year - 1911) + ' 年場地表');
  return { id: normalized[year], mapped: true };
}

function parseVenueConfigObject_(raw, name) {
  let value;
  try { value = JSON.parse(String(raw)); } catch (_) { throw new Error(name + ' 不是有效 JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(name + ' 必須是年度／類別對應物件');
  }
  return value;
}

function validateVenueWorkbookYear_(ss, year) {
  const match = String(ss.getName()).match(/^(?:民國)?(\d{3,4})(?:年|[\s_-]|$)/);
  if (!match) return;
  const declared = Number(match[1]) < 1911 ? Number(match[1]) + 1911 : Number(match[1]);
  if (declared !== year) throw new Error('場地表標題年度與檢查日期不符');
}

function getVenueSupplementalTabs_(settings, category) {
  const raw = settings.venueUsageSupplementalTabs;
  if (raw === undefined || raw === null || raw === '') return [];
  const config = parseVenueConfigObject_(raw, 'venueUsageSupplementalTabs');
  const rows = config[category];
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error('補充場地分頁設定必須是陣列');
  return rows.map(row => {
    if (!row || typeof row.tab !== 'string' || !row.tab.trim() ||
        !Array.isArray(row.keywords) || !row.keywords.length ||
        row.keywords.some(kw => typeof kw !== 'string' || !kw.trim())) {
      throw new Error('補充場地分頁須設定名稱及明確課程關鍵字');
    }
    return { tab: row.tab.trim(), keywords: row.keywords.map(kw => kw.trim()) };
  });
}

/** 一次讀取當月矩形；排除星期欄與年曆右側的獨立備註。 */
function readVenueMonthCells_(venueSheet, parts, sourceId, state) {
  const cacheKey = sourceId + ':' + venueSheet.sheetId + ':' + parts.m;
  let month = state.months[cacheKey];
  if (!month) {
    const sheet = venueSheet.sheet;
    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    if (!lastCol || lastRow < 3) throw new Error('場地表無日期資料列');
    const headers = sheet.getRange(1, 1, 2, lastCol).getValues();
    const dateIndex = headers[0].findIndex(v => cellStr_(v).replace(/\s/g, '') === parts.m + '月');
    if (dateIndex < 0) throw new Error('場地表月份欄位不存在：' + parts.m + '月');
    let end = lastCol;
    for (let c = dateIndex + 1; c < lastCol; c += 1) {
      if (/^\d{1,2}月$/.test(cellStr_(headers[0][c]).replace(/\s/g, '')) ||
          cellStr_(headers[1][c]) === '日期') { end = c; break; }
    }
    const columns = [];
    for (let c = dateIndex + 1; c < end; c += 1) {
      const field = cellStr_(headers[1][c]);
      if (field && field !== '星期') columns.push({ index: c, field });
    }
    if (!columns.length && dateIndex + 1 < end) {
      columns.push({ index: dateIndex + 1, field: '' });
    }
    if (!columns.length) throw new Error('場地表缺少月份內容欄');
    month = {
      dateIndex, columns, tab: sheet.getName(),
      rows: sheet.getRange(3, dateIndex + 1, lastRow - 2, end - dateIndex).getValues(),
    };
    state.months[cacheKey] = month;
  }
  const rowIndex = month.rows.findIndex(row => {
    const value = row[0];
    if (value === '' || value === null || value === undefined) return false;
    return (value instanceof Date ? dateParts_(value).d : Number(value)) === parts.d;
  });
  if (rowIndex < 0) throw new Error('場地表當月找不到該日：' + parts.d);
  return month.columns.map(column => ({
    tab: month.tab, field: column.field,
    cell: venueColumnLabel_(column.index + 1) + (rowIndex + 3),
    content: cellStr_(month.rows[rowIndex][column.index - month.dateIndex]),
  }));
}

function venueColumnLabel_(column) {
  let label = '';
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + (value - 1) % 26) + label;
  }
  return label;
}

// 同一次操作內每個分頁只向試算表服務查一次；找不到不保存，下一台設備會重查。
function getCachedVenueSheet_(ss, sourceId, tabRef, state) {
  const key = sourceId + ':' + tabRef;
  if (!state.sheets[key]) {
    const sheet = getVenueSheetByRef_(ss, tabRef);
    if (!sheet) return null;
    state.sheets[key] = { sheet, sheetId: sheet.getSheetId() };
  }
  return state.sheets[key];
}

function getVenueSheetByRef_(ss, tabRef) {
  const ref = String(tabRef || '').trim();
  if (!ref) return null;

  const byName = ss.getSheetByName(ref);
  if (byName) return byName;

  const gidMatch = ref.match(/^(?:gid:)?(\d+)$/i);
  if (!gidMatch) return null;

  const gid = Number(gidMatch[1]);
  return ss.getSheets().find(sheet => sheet.getSheetId() === gid) || null;
}

/**
 * 部分設備類別共用同一張場地分頁；若只看「內容非空」會把其他課程誤判為使用。
 * 例如堆高機與移動式/吊車共用分頁時，內容需出現「堆」才視為堆高機有使用。
 *
 * 可在 DB「系統設定」加入：
 *   venueUsageRequiredKeywords = 堆高機=堆
 * 多類別用分號或換行分隔，例如：
 *   堆高機=堆;固定式起重機=天車,固定式
 */
function getVenueUsageRequiredKeywords_(equipment, settings) {
  const category = String((equipment && equipment.category) || '').trim();
  if (!category) return [];

  const raw = settings ? settings.venueUsageRequiredKeywords : getSetting_('venueUsageRequiredKeywords', '');
  const configured = parseVenueUsageRequiredKeywords_(raw, category);
  if (configured !== null) return configured;

  const defaults = CONFIG.VENUE_USAGE_REQUIRED_KEYWORDS_DEFAULT || {};
  if (!defaults[category] && ['移動式', '移動式起重機'].indexOf(category) >= 0) {
    return ['移動式', '吊'];
  }
  return (defaults[category] || []).map(k => String(k || '').trim()).filter(Boolean);
}

function parseVenueUsageRequiredKeywords_(raw, category) {
  const text = String(raw || '').trim();
  if (!text) return null;

  const entries = text.split(/[;\n]/);
  for (const entry of entries) {
    const parts = String(entry || '').split(/[=:]/);
    if (parts.length < 2) continue;

    const key = String(parts[0] || '').trim();
    if (key !== category) continue;

    return String(parts.slice(1).join('=') || '')
      .split(/[,\uFF0C、]/)
      .map(k => String(k || '').trim())
      .filter(Boolean);
  }
  return null;
}

/** 保留原文匹配；使用者已確認的高機別名只擴充堆高機類別。 */
function matchesVenueCategoryKeywords_(content, keywords, category) {
  if (hasAnyKeyword_(content, keywords)) return true;
  if (category !== '堆高機') return false;
  return hasAnyKeyword_(String(content || '').replace(/堆?高機/g, '堆高機'), keywords);
}

function hasAnyKeyword_(content, keywords) {
  const text = String(content || '');
  return keywords.some(kw => kw && text.indexOf(kw) >= 0);
}
