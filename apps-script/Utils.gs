/**
 * ===== 共用工具：日期、字串、格式化 =====
 *
 * 所有日期函數都透過 tz_() 取得「Asia/Taipei」，
 * 避免 Apps Script 預設 GMT 造成民國年月日差一天的 bug。
 */

/**
 * 取得設定的時區（fallback 為 script timezone）
 */
function tz_() {
  return (CONFIG && CONFIG.TIMEZONE) || Session.getScriptTimeZone();
}

/**
 * 取得指定日期在台北時區的「年、月、日」三個整數
 */
function dateParts_(date) {
  const s = Utilities.formatDate(date, tz_(), 'yyyy-MM-dd');
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/**
 * 西元年轉民國年（以台北時區的年為基準）
 */
function toROC_(date) {
  return dateParts_(date).y - 1911;
}

/**
 * 民國年月日字串（用於檔名）
 * 例：2026/5/18 -> "1150518"
 */
function formatROCDate_(date) {
  const { y, m, d } = dateParts_(date);
  return `${y - 1911}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

function formatROCYear_(date) {
  return `${toROC_(date)}年`;
}

function formatROCMonth_(date) {
  const { m } = dateParts_(date);
  return `${String(m).padStart(2, '0')}月`;
}

/**
 * 取得西元日期字串 YYYY-MM-DD（用於 DB 比對）
 */
function formatISODate_(date) {
  return Utilities.formatDate(date, tz_(), 'yyyy-MM-dd');
}

/**
 * 將 "YYYY-MM-DD" 字串解析為 Date 物件（以台北時區的 0:00 為準）
 * 直接 new Date('2026-05-31') 會被當 UTC 0:00，台北時區會多 8 小時、跨日不出錯但仍危險
 */
function parseISODate_(s) {
  if (s instanceof Date) return s;
  if (!s || typeof s !== 'string') throw new Error('日期格式錯誤');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('日期格式錯誤：' + s);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`);
}

/**
 * 取得今日 0 點（台北時區）
 */
function todayStart_() {
  const now = new Date();
  return parseISODate_(formatISODate_(now));
}

/**
 * 取得昨日 0 點
 */
function yesterdayStart_() {
  const t = todayStart_();
  t.setDate(t.getDate() - 1);
  return t;
}

function uuid_() {
  return Utilities.getUuid();
}

/**
 * 驗證 signature 必須是合法的 data:image/(png|jpeg);base64,... 格式
 *
 * 業務規則：簽名「必填」，未提供視為錯誤（職業安全衛生管理辦法要求簽名留證）
 */
function validateSignature_(dataUrl) {
  if (!dataUrl) throw new Error('缺少簽名');
  if (typeof dataUrl !== 'string') throw new Error('簽名格式錯誤');
  if (dataUrl.length > CONFIG.MAX_SIGNATURE_BYTES) throw new Error('簽名圖太大');
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new Error('簽名格式錯誤');
  }
  return true;
}

/**
 * 把任意字串限制長度、去除控制字元
 */
function sanitizeText_(s, maxLen) {
  if (s === null || s === undefined) return '';
  let str = String(s);
  // 去除 ASCII 控制字元（保留 \n、\t）
  str = str.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  const limit = maxLen || CONFIG.MAX_TEXT_FIELD_LENGTH;
  if (str.length > limit) str = str.substring(0, limit);
  return str;
}

/**
 * 安全取得儲存格字串
 */
function cellStr_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * HTML escape — Apps Script 模板的 <?= ?> 預設就會 escape，
 * 但有些位置我們手動拼字串就要呼叫這個
 */
function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
