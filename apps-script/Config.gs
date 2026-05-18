/**
 * ===== 系統全域設定 =====
 * 部署後，請把這裡的 ID 改成你建立的實際資源 ID
 * 詳細步驟請看 docs/deployment-guide.md
 */

const CONFIG = {

  // ------ 時區（所有日期格式化用這個，不要依賴 Apps Script 預設）------
  // 新建 Apps Script 預設可能是 GMT，會讓民國年月日差一天
  TIMEZONE: 'Asia/Taipei',

  // ------ API 共享 token（防匿名濫用 POST）------
  // 部署時改成隨機字串（建議 32+ 字元）。前端 web/js/config.js 要設定相同的值。
  // 注意：因為前端是公開的 GitHub Pages，這個 token 等於是「半公開」，
  // 主要目的是擋掉不知道網址直接打 API 的機器人。要更嚴的話需要登入機制。
  API_TOKEN: 'REPLACE_WITH_RANDOM_TOKEN_AT_LEAST_32_CHARS',

  // ------ 防 DoS：payload 大小與簽名長度上限 ------
  MAX_PAYLOAD_BYTES: 500 * 1024,     // 整個 JSON 上限 500KB
  MAX_SIGNATURE_BYTES: 300 * 1024,   // 簽名 base64 上限 300KB
  MAX_TEXT_FIELD_LENGTH: 500,         // 任一文字欄位上限（inspector/note/desc/action/review）

  // ------ 資料來源 ------

  // 系統資料庫（檢查表模板、設備清單、檢查項目、填報紀錄、人員、設定）
  // 部署時建立一個新的 Google Sheets，把它的 ID 填到這裡
  DB_SHEET_ID: 'REPLACE_WITH_YOUR_DB_SHEET_ID',

  // 場地使用試算表（你提供的「115-術科V1」那張）
  // 之後每年新建時，到 DB 的「系統設定」工作表更改即可
  // 預設讀取「系統設定」表中的 venueSheetId 鍵值，這裡只是 fallback
  VENUE_SHEET_ID_FALLBACK: '1ZCC99WjQuIKmDuR8L3jOTmKHI0hgTk0rJMm_vyQX45o',

  // 場地使用試算表的「分頁」名稱
  // 之後新增其他機具（堆高機、高空工作車）時，在 DB「機具場地對應」表設定
  VENUE_SHEET_DEFAULT_TAB: '固定式起重機',

  // ------ 雲端歸檔 ------

  // PDF 歸檔的根資料夾（Drive 中先建一個資料夾，把它的 ID 填這裡）
  // 結構會是：[根資料夾] / [機具類別] / [民國年] / [民國月] / [檔名].pdf
  ARCHIVE_ROOT_FOLDER_ID: 'REPLACE_WITH_YOUR_DRIVE_FOLDER_ID',

  // ------ 提醒信 ------

  REMINDER_EMAIL_TO: '<reminder-recipient@example.com>',
  REMINDER_EMAIL_CC: '',           // 副本（多人用逗號隔開）
  REMINDER_EMAIL_FROM_NAME: '自動檢查表提醒系統',

  // 每天觸發提醒的時間（24 小時制，整點）
  REMINDER_TRIGGER_HOUR: 9,

  // ------ 機構抬頭（PDF 上會顯示）------

  ORGANIZATION_HEADER: '<機構名稱>',

  // ------ 預設設備（系統啟用時自動建立第一筆設備）------

  DEFAULT_EQUIPMENT: {
    equipmentId: 'CRANE-LJ-001',
    equipmentName: '<設備名稱>',
    machineSerial: '12F36D0130001',
    machineType: '普通架空移動起重機',
    category: '固定式起重機',
    location: '<位置>',
    venueSheetTab: '固定式起重機',   // 對應場地表的分頁名稱
  },

  // ------ 節假日排除關鍵字（預設）------
  // 場地表的儲存格內容若「包含」任一關鍵字，就視為「不使用」，不寄提醒信
  // 這份預設清單會在初始化時寫入 DB「系統設定」工作表
  // 之後管理員可在 Sheets 自行增刪，不需改程式
  HOLIDAY_KEYWORDS_DEFAULT: [
    '元旦', '春節', '和平紀念', '清明', '勞動', '端午',
    '國慶', '教師', '中秋', '行憲', '光復', '連假',
  ],

};

/**
 * 從 DB「系統設定」工作表讀取設定值；找不到則回傳 fallback
 */
function getSetting_(key, fallback) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
    const sheet = ss.getSheetByName('系統設定');
    if (!sheet) return fallback;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return fallback;
    const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (const row of values) {
      if (row[0] === key) return row[1] || fallback;
    }
  } catch (e) {
    Logger.log('讀取設定失敗：' + e);
  }
  return fallback;
}

/**
 * 取得場地表 ID（優先讀 DB 設定，未設定則用 fallback）
 */
function getVenueSheetId_() {
  return getSetting_('venueSheetId', CONFIG.VENUE_SHEET_ID_FALLBACK);
}

/**
 * 取得當前要用的節假日關鍵字清單（讀 DB「節假日關鍵字」表，沒有就用預設）
 */
function getHolidayKeywords_() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
    const sheet = ss.getSheetByName('節假日關鍵字');
    if (!sheet) return CONFIG.HOLIDAY_KEYWORDS_DEFAULT;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return CONFIG.HOLIDAY_KEYWORDS_DEFAULT;
    return sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getValues()
      .map(r => String(r[0] || '').trim())
      .filter(Boolean);
  } catch (e) {
    Logger.log('讀取節假日關鍵字失敗：' + e);
  }
  return CONFIG.HOLIDAY_KEYWORDS_DEFAULT;
}
