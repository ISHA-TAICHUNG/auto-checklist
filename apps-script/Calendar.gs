/**
 * ===== 場地使用判斷 =====
 *
 * 用途：讀取「場地使用試算表」（DB 系統設定 venueSheetId），判斷指定日期是否有人使用該場地。
 *
 * 場地表結構（橫式行事曆，每月 2 欄）：
 *   列 1：1月 _ 2月 _ 3月 _ ... 12月 _
 *   列 2：星期 日期 固定式｜日期 固定式｜日期 固定式｜...
 *   列 3+：星期(A) 1日(B) 課程(C) | 1日(D) 課程(E) | 1日(F) 課程(G) | ...
 *
 * 日期欄可能是純數字、文字、或日期型別（依使用者輸入而定），這裡都處理。
 */

function getVenueUsage_(equipment, date) {
  const venueId = getVenueSheetId_();
  const tabName = equipment.venueSheetTab || CONFIG.VENUE_SHEET_DEFAULT_TAB;

  const ss = SpreadsheetApp.openById(venueId);
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    Logger.log(`場地表找不到分頁：${tabName}`);
    return { used: false, content: '', reason: '分頁不存在' };
  }

  const parts = dateParts_(date);
  const month = parts.m;
  const day = parts.d;

  // 找出該月對應的「日期欄」與「內容欄」
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return { used: false, content: '', reason: '空白表' };

  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let dateCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    // 修 P2.1: 容錯 trailing / inner whitespace（場地表 header 寫成 '5月 ' 或 '5 月' 也認）
    const v = cellStr_(headerRow[c]).replace(/\s/g, '');
    if (v === `${month}月`) {
      dateCol = c + 1;
      break;
    }
  }
  if (dateCol < 0) {
    Logger.log(`場地表找不到月份欄：${month}月`);
    return { used: false, content: '', reason: '月份欄位不存在' };
  }
  const contentCol = dateCol + 1;

  // 從列 3 開始往下找日期
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return { used: false, content: '', reason: '無資料列' };

  const dateValues = sheet.getRange(3, dateCol, lastRow - 2, 1).getValues();
  for (let i = 0; i < dateValues.length; i++) {
    const v = dateValues[i][0];
    if (v === null || v === undefined || v === '') continue;

    let dayValue;
    if (v instanceof Date) {
      // Sheets 可能把 1, 2, 3 自動轉成日期物件
      dayValue = v.getDate();
    } else if (typeof v === 'number') {
      dayValue = v;
    } else {
      const n = Number(v);
      if (isNaN(n)) continue;
      dayValue = n;
    }

    if (dayValue === day) {
      const row = i + 3;
      const content = cellStr_(sheet.getRange(row, contentCol).getValue());

      if (!content) return { used: false, content: '', reason: null };

      // 節假日關鍵字檢查
      const keywords = getHolidayKeywords_();
      for (const kw of keywords) {
        if (kw && content.indexOf(kw) >= 0) {
          return { used: false, content, reason: `節假日（${kw}）` };
        }
      }

      const requiredKeywords = getVenueUsageRequiredKeywords_(equipment);
      if (requiredKeywords.length > 0 && !hasAnyKeyword_(content, requiredKeywords)) {
        return {
          used: false,
          content,
          reason: `未命中${equipment.category}使用關鍵字（${requiredKeywords.join('、')}）`,
        };
      }

      return { used: true, content, reason: null };
    }
  }
  return { used: false, content: '', reason: '當月找不到該日' };
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
function getVenueUsageRequiredKeywords_(equipment) {
  const category = String((equipment && equipment.category) || '').trim();
  if (!category) return [];

  const configured = parseVenueUsageRequiredKeywords_(getSetting_('venueUsageRequiredKeywords', ''), category);
  if (configured !== null) return configured;

  const defaults = CONFIG.VENUE_USAGE_REQUIRED_KEYWORDS_DEFAULT || {};
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

function hasAnyKeyword_(content, keywords) {
  const text = String(content || '');
  return keywords.some(kw => kw && text.indexOf(kw) >= 0);
}
