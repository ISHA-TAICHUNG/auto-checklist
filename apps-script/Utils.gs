/**
 * ===== 共用工具：日期、字串、格式化 =====
 */

/**
 * 西元年轉民國年
 * 例：2026 -> 115
 */
function toROC_(date) {
  return date.getFullYear() - 1911;
}

/**
 * 取得民國年月日字串（用於檔名）
 * 例：2026/5/18 -> "1150518"
 */
function formatROCDate_(date) {
  const y = toROC_(date);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 取得民國年（字串）
 */
function formatROCYear_(date) {
  return `${toROC_(date)}年`;
}

/**
 * 取得月份（字串，2 位數）
 * 例：5 月 -> "05月"
 */
function formatROCMonth_(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}月`;
}

/**
 * 取得西元日期字串 YYYY-MM-DD（用於 DB 比對）
 */
function formatISODate_(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 取得今日 0 點（去除時分秒）
 */
function todayStart_() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/**
 * 取得昨日 0 點
 */
function yesterdayStart_() {
  const t = todayStart_();
  t.setDate(t.getDate() - 1);
  return t;
}

/**
 * 把任意 Date 物件複製為當日 0 點
 */
function dateOnly_(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/**
 * 產生 UUID（用於填報紀錄 ID）
 */
function uuid_() {
  return Utilities.getUuid();
}

/**
 * 從 base64 dataURL 解析簽名圖（手寫簽名 canvas 用）
 * 例：data:image/png;base64,iVBORw0KG...
 */
function dataUrlToBlob_(dataUrl, filename) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const bytes = Utilities.base64Decode(match[2]);
  return Utilities.newBlob(bytes, mime, filename || 'signature.png');
}

/**
 * 安全取得儲存格字串（避免 null）
 */
function cellStr_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * 對 HTML 進行 escape（防止使用者輸入破壞 PDF 模板）
 */
function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
