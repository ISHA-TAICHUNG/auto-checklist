/**
 * ===== 系統設定 =====
 * 部署 Apps Script Web App 後，把 exec URL 填到 API_BASE
 * 例如：https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxx/exec
 */
window.SYSTEM_CONFIG = {
  // 必填：Apps Script Web App 的 exec URL
  API_BASE: 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_EXEC_URL_HERE',

  // 機構抬頭（顯示在 header）
  ORG_NAME: '<機構名稱>',

  // 系統版本（顯示用）
  VERSION: 'v1.0',
};
