/**
 * ===== 系統設定 =====
 *
 * 部署時要改一個值：
 *   1. API_BASE  — Apps Script Web App 的 exec URL
 *      （部署 Apps Script 為 Web App 後複製出來的網址）
 *
 * 公開前端不保存共享 token。寫入操作會先向後端取得短效、動作綁定、
 * 一次性使用的操作票證；管理密鑰也不會儲存在瀏覽器。
 */
window.SYSTEM_CONFIG = {
  // 必填：Apps Script Web App 的 exec URL
  API_BASE: 'https://script.google.com/macros/s/AKfycbzxCBba-V42nYmB40TLDvJkCi2EhXC7v6TxhDAYnufQSoYbOyA4r-X0jAxlsJ5RnpXv/exec',

  // 機構抬頭 — 由前端啟動時 fetch API_BASE?api=branding 動態載入
  // 實際機構名稱存在後端 DB「系統設定」的 organizationName，不寫死在 source code
  ORG_NAME: '',

  // 系統版本（顯示在首頁 footer，給操作員看的版本號）
  // 慣例：major UX / feature 改才 bump（例如加新機具類別、改 PDF 排版、改填表流程）
  // 純後端修 bug 不用動（後端有自己的部署版本 v8.x）
  VERSION: 'v1.2',
};
