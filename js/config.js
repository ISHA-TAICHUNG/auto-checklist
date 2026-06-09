/**
 * ===== 系統設定 =====
 *
 * 部署時要改兩個值：
 *   1. API_BASE  — Apps Script Web App 的 exec URL
 *      （部署 Apps Script 為 Web App 後複製出來的網址）
 *   2. API_TOKEN — 共享 token，必須跟 Config.gs 中 CONFIG.API_TOKEN 完全相同
 *      （建議 32 字元以上的隨機字串）
 *
 * ⚠ 注意：因為 GitHub Pages 前端是公開的，這個 token 等於是「半公開」。
 *    主要作用是擋掉不知道網址直接打 API 的機器人，不是真正的身份驗證。
 *    若需要真正驗證，要改用 Google 登入機制（OAuth）。
 */
window.SYSTEM_CONFIG = {
  // 必填：Apps Script Web App 的 exec URL
  API_BASE: 'https://script.google.com/macros/s/AKfycbydnAxKVywvhH1P7qQEE2HDWGJn5NJUGTmN_ewEgyCRNyIq4Q4MkebQqTpm1BlvZt-b6w/exec',

  // 必填：共享 token（與後端 Config.gs 的 API_TOKEN 一致）
  API_TOKEN: '246dc615455a79d4b2437c8d48047d15622d282d175c0494',

  // 機構抬頭 — 由前端啟動時 fetch API_BASE?api=branding 動態載入
  // 實際機構名稱存在後端 DB「系統設定」的 organizationName，不寫死在 source code
  ORG_NAME: '',

  // 系統版本（顯示在首頁 footer，給操作員看的版本號）
  // 慣例：major UX / feature 改才 bump（例如加新機具類別、改 PDF 排版、改填表流程）
  // 純後端修 bug 不用動（後端有自己的部署版本 v8.x）
  VERSION: 'v1.2',
};
