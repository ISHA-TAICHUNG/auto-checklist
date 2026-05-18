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
  API_BASE: 'https://script.google.com/macros/s/AKfycbwrAgEXjxRfvQtpGVFqRrHRmr-i5itZZSH9DmrvVl48YWlxFhdxJvEIwQYpR7rv6SkTrQ/exec',

  // 必填：共享 token（與後端 Config.gs 的 API_TOKEN 一致）
  API_TOKEN: '089da735a8fd6a1f4aea4eab0e74af3e62f1b2801cb3b69d',

  // 機構抬頭（顯示用）
  ORG_NAME: '<機構名稱>',

  // 系統版本
  VERSION: 'v1.0',
};
