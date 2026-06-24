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

  // ------ Admin token verifier（選填）------
  // 正式部署可在 ignored 的 Config.js 填入 ADMIN_TOKEN 的 SHA-256 hex。
  // source 版本保持空值，避免把 production verifier 推上 GitHub。
  ADMIN_TOKEN_SHA256: '',

  // ------ 防 DoS：payload 大小與圖片上限 ------
  MAX_PAYLOAD_BYTES: 5 * 1024 * 1024, // 整個 JSON 上限 5MB（含多張異常照片）
  MAX_SIGNATURE_BYTES: 300 * 1024,    // 簽名 base64 上限 300KB
  MAX_PHOTO_BYTES: 600 * 1024,        // 單張異常照片 base64 上限 600KB（已壓縮版）
  MAX_PHOTOS_PER_ITEM: 4,             // 單一檢查項目最多 4 張異常照片
  MAX_TEXT_FIELD_LENGTH: 500,         // 任一文字欄位上限（inspector/note/desc/action/review）

  // ------ 資料來源 ------

  // 系統資料庫（檢查表模板、設備清單、檢查項目、填報紀錄、人員、設定）
  // 部署時建立一個新的 Google Sheets，把它的 ID 填到這裡
  DB_SHEET_ID: 'REPLACE_WITH_YOUR_DB_SHEET_ID',

  // 場地使用試算表（你提供的「<場地使用表名稱>」那張）
  // 之後每年新建時，到 DB 的「系統設定」工作表更改即可
  // 預設讀取「系統設定」表中的 venueSheetId 鍵值，這裡只是 fallback
  VENUE_SHEET_ID_FALLBACK: 'REPLACE_WITH_YOUR_VENUE_SHEET_ID',

  // 場地使用試算表的「分頁」名稱
  // 之後新增其他機具（堆高機、高空工作車）時，在 DB「機具場地對應」表設定
  VENUE_SHEET_DEFAULT_TAB: '固定式起重機',

  // ------ 雲端歸檔 ------

  // PDF 歸檔的根資料夾（Drive 中先建一個資料夾，把它的 ID 填這裡）
  // 一般結構：[根資料夾] / [機具類別] / [民國年] / [民國月] / [檔名].pdf
  // 教室月檢：[根資料夾] / 置備之安全衛生量測設備及個人防護具每月檢核表 / [民國年] / [民國月] / [教室] / [檔名].pdf
  ARCHIVE_ROOT_FOLDER_ID: 'REPLACE_WITH_YOUR_DRIVE_FOLDER_ID',

  // ------ 提醒信（這些是 source code 預設值，runtime 會被 DB 系統設定覆蓋）------

  REMINDER_EMAIL_TO_DEFAULT: 'admin@example.com',  // DB 設定 reminderEmailTo 會覆寫
  REMINDER_EMAIL_CC: '',                           // 副本（多人用逗號隔開）
  REMINDER_EMAIL_FROM_NAME: '自動檢查表提醒系統',

  // 每天觸發提醒的時間（24 小時制，整點）
  REMINDER_TRIGGER_HOUR: 9,

  // ------ 機構抬頭（source code 預設，runtime 從 DB 系統設定 organizationName 載入）------
  ORGANIZATION_HEADER_DEFAULT: '本中心',

  // ------ GitHub Pages 前端 URL（DB 系統設定 webFrontendUrl 會覆蓋）------
  DEFAULT_WEB_FRONTEND_URL: '',

  // ------ 預設設備（系統啟用時自動建立第一筆設備，僅做為範例 placeholder）------
  DEFAULT_EQUIPMENT: {
    equipmentId: 'EQUIPMENT-001',
    equipmentName: '設備 1 號',
    machineSerial: 'SN-XXXXXX',
    machineType: '機械型式',
    category: '機具類別',
    location: '所在位置',
    venueSheetTab: '機具類別',
  },

  // ------ 節假日排除關鍵字（預設）------
  // 場地表的儲存格內容若「包含」任一關鍵字，就視為「不使用」，不寄提醒信
  // 這份預設清單會在初始化時寫入 DB「系統設定」工作表
  // 之後管理員可在 Sheets 自行增刪，不需改程式
  HOLIDAY_KEYWORDS_DEFAULT: [
    '元旦', '春節', '和平紀念', '清明', '勞動', '端午',
    '國慶', '教師', '中秋', '行憲', '光復', '連假',
  ],

  // ------ 共用場地分頁的「使用判定必要關鍵字」------
  // 場地表分頁若同時放多種課程，內容非空不一定代表該設備類別有使用。
  // 例如堆高機與移動式/吊車共用分頁時，只有內容含「堆」才視為堆高機有使用。
  // 可用 DB「系統設定」venueUsageRequiredKeywords 覆蓋，格式：堆高機=堆
  VENUE_USAGE_REQUIRED_KEYWORDS_DEFAULT: {
    '堆高機': ['堆'],
    '高空工作車': ['高'],
  },

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
 * 取得機構抬頭（runtime）— DB 系統設定 organizationName 優先，否則 fallback
 */
function getOrgHeader_() {
  return getSetting_('organizationName', '') || CONFIG.ORGANIZATION_HEADER_DEFAULT;
}

/**
 * 取得提醒信收件人（runtime）— DB 系統設定 reminderEmailTo 優先
 */
function getReminderEmail_() {
  return getSetting_('reminderEmailTo', '') || CONFIG.REMINDER_EMAIL_TO_DEFAULT;
}

/**
 * 取得 admin token（從 Script Properties 讀，與 API_TOKEN 隔離）
 *
 * 安全分層（codex review 2026-05-26）：
 *   - API_TOKEN     寫在 js/config.js → 任何 GitHub Pages 訪客都能拿到，只能用在唯讀類 endpoint
 *   - ADMIN_TOKEN   存在 Apps Script Script Properties → 只有 admin 知道，用於寫入/破壞性 endpoint
 *
 * 若 Script Properties ADMIN_TOKEN 未設置，仍可用 production Config.js 內的
 * ADMIN_TOKEN_SHA256 verifier 驗證 GCP Secret Manager 內的 admin token。
 *
 * 設置方式：Apps Script 編輯器 → ⚙ 專案設定 → Script Properties → 新增 ADMIN_TOKEN
 */
function getAdminToken_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN') || '';
  } catch (e) {
    return '';
  }
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text || ''),
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => {
    const value = b < 0 ? b + 256 : b;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

/**
 * 校驗 admin token + 拒絕跟 API_TOKEN 重複（防 admin 誤設成同值）
 *
 * @return true 通過；false 拒絕（呼叫端應 throw '未授權'）
 */
function checkAdminToken_(provided) {
  const candidate = String(provided || '');
  if (!candidate || candidate === CONFIG.API_TOKEN) return false;

  const adminToken = getAdminToken_();
  if (adminToken && adminToken.length >= 32 && adminToken !== CONFIG.API_TOKEN) {
    if (candidate === adminToken) return true;
  }

  const expectedHash = String(CONFIG.ADMIN_TOKEN_SHA256 || '').trim().toLowerCase();
  if (expectedHash && /^[0-9a-f]{64}$/.test(expectedHash)) {
    return sha256Hex_(candidate) === expectedHash;
  }
  return false;
}

/**
 * 破壞性動作（cleanupAll / cleanupDate）的 HTTP kill switch
 *
 * 預設 false → 不允許從公開 Web App 呼叫，只能從 Apps Script 編輯器手動執行函式
 * 設 true 才允許（仍要 ADMIN_TOKEN + 既有 confirm=YES_DELETE_ALL）
 *
 * 設置：Script Properties → ALLOW_DESTRUCTIVE_HTTP = YES
 */
function destructiveHttpAllowed_() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty('ALLOW_DESTRUCTIVE_HTTP') || '').toUpperCase() === 'YES';
  } catch (e) {
    return false;
  }
}

/**
 * LINE webhook 用的 query token（替代 X-Line-Signature header — GAS 讀不到 headers）
 *
 * 設置：
 *   1. Script Properties → LINE_WEBHOOK_QUERY_TOKEN = 隨機 32+ 字串
 *   2. LINE Developers Console → Webhook URL = exec_url?lineWebhookToken=該字串
 *
 * 若 LINE_WEBHOOK_QUERY_TOKEN 未設 → 一律拒絕 webhook（fail-closed，避免匿名觸發完成異常等指令）
 */
function getLineWebhookQueryToken_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_QUERY_TOKEN') || '';
  } catch (e) {
    return '';
  }
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
