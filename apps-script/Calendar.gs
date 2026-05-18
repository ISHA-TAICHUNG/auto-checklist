/**
 * ===== 場地使用判斷 =====
 *
 * 用途：讀取「場地使用試算表」（你給的 1ZCC99WjQuI...），判斷指定日期是否有人使用該場地。
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
    const v = cellStr_(headerRow[c]);
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

      return { used: true, content, reason: null };
    }
  }
  return { used: false, content: '', reason: '當月找不到該日' };
}
