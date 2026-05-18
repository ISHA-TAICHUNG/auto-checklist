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
 * 判斷邏輯：
 *   1. 給定日期 (例 115/5/18)
 *   2. 找該月對應的「日期欄」與「內容欄」
 *   3. 在那一欄找到 18 這個值
 *   4. 對應的內容欄儲存格有非空白文字 = 該日有使用
 *   5. 內容若包含節假日關鍵字（從「節假日關鍵字」表讀）→ 視為不使用
 */

/**
 * 取得指定設備在指定日期的場地使用狀況
 *
 * 回傳：
 *   { used: true/false, content: '...', reason: '節假日'/null }
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

  const month = date.getMonth() + 1;   // 1-12
  const day = date.getDate();           // 1-31

  // 找出該月的「日期欄」與「內容欄」
  // 列 1 是月份標題，月份標題出現在哪一欄，那欄就是日期欄，旁邊就是內容欄
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let dateCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    const v = cellStr_(headerRow[c]);
    if (v === `${month}月`) {
      dateCol = c + 1;   // 1-based
      break;
    }
  }
  if (dateCol < 0) {
    Logger.log(`場地表找不到月份欄：${month}月`);
    return { used: false, content: '', reason: '月份欄位不存在' };
  }
  const contentCol = dateCol + 1;

  // 從列 3 開始往下找日期值 = day 的那一列
  const lastRow = sheet.getLastRow();
  const dateValues = sheet.getRange(3, dateCol, lastRow - 2, 1).getValues();
  for (let i = 0; i < dateValues.length; i++) {
    const v = dateValues[i][0];
    if (v === null || v === undefined || v === '') continue;
    // Sheets 把日期數字讀進來可能是 number 或 string，統一轉 number
    const dayValue = Number(v);
    if (dayValue === day) {
      const row = i + 3;
      const content = cellStr_(sheet.getRange(row, contentCol).getValue());

      if (!content) {
        return { used: false, content: '', reason: null };
      }

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
