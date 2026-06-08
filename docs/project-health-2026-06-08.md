# ISHA 檢查與通報工作台專案健檢報告

檢查日期：2026-06-08 17:55  
檢查範圍：GitHub Pages 前端、Apps Script Web App、LINE webhook / Rich Menu、Apps Script source sync、Git / deployment 狀態。

## 結論

整體狀態：可用。

剛修正的 LINE `待處理` 問題已確認不是指令路由失效，而是 LINE 官方帳號 webhook 曾指到舊 deployment。現在 LINE webhook 已指回正式 Web App，線上查核為通過。

## 線上服務狀態

| 項目 | 結果 | 備註 |
|---|---:|---|
| GitHub Pages 最新部署 | 通過 | `08e10fd` 的 `pages-build-deployment` 成功 |
| `index.html` | 200 | `ISHA 檢查與通報工作台` |
| `daily.html` | 200 | 每日作業前檢點表 |
| `monthly.html` | 200 | 每月定期檢查紀錄 |
| `incident.html` | 200 | 日常異常事件通報 |
| GAS `api=health` | 通過 | `auto-checklist-api` |
| GAS `api=branding` | 通過 | 機構名稱正常回傳 |
| LINE Rich Menu | 通過 | default rich menu 與設定值相符 |
| LINE webhook | 通過 | endpoint base 與 query token 均相符 |
| `syncLineWebhookEndpoint` 保護 | 通過 | 未帶 `adminToken` 回未授權 |

## 本機與部署檢查

| 檢查 | 結果 |
|---|---|
| Apps Script `.js` 語法 | 通過 |
| `.gs` / `.js` 鏡像 | 通過，`Config` 例外 |
| `git diff --check` | 通過 |
| 最近 5 commits gitleaks | no leaks |
| GAS Web App deployment | `@111`，描述：`v8.74 — LINE webhook 健康查核` |

`Config.gs` 與 `Config.js` 差異是預期設計：Git source 保留 placeholder，clasp live mirror 放實際部署設定。

## 已確認的指令/按鈕風險

| 功能 | 狀態 | 說明 |
|---|---|---|
| `待處理` LINE 指令 | 通過 | 本機 dispatcher 測 `待處理`、前後空白、零寬字元皆路由到日常事件未結案清單 |
| Rich Menu「日常待處理」 | 通過 | area action 送出文字 `待處理` |
| webhook 指向 | 通過 | LINE 平台現在指到 `AKfycbwr.../exec` |
| 舊 Quick Reply | 未在現行 source 發現 | `訂閱 / 取消通知` 只出現在舊紀錄或舊部署，不在現行 LINE quick reply |

## 殘留注意事項

| 等級 | 項目 | 建議 |
|---|---|---|
| 中 | 專案根目錄仍有未追蹤的 `starter-kit/`、`docs/superpowers/`、starter zip 與分享範本 | 若確認要保留，建議之後集中歸檔或加入明確 `.gitignore`；本次未移動，避免碰到既有資料 |
| 低 | 完整 filesystem gitleaks 會被未追蹤 zip / starter-kit 拖慢 | 本次改掃最近 5 commits；若要完整掃描，建議先排除 zip 與 starter-kit |
| 低 | `clasp run` 仍受 Google Execution API 權限限制 | 不影響 Web App；需要手動執行 Apps Script 函式時，仍建議從 GAS 編輯器或 admin endpoint 操作 |
| 低 | LINE 真實點擊測試無法由本機完全模擬 | 已用 LINE 平台 endpoint 查核與 dispatcher 單元模擬補足；建議手機端再試一次 `待處理` |

## 後續建議

1. 手機 LINE 實測 `待處理`，確認回覆已不是舊 Quick Reply。
2. 定期用 `lineWebhookHealth` 檢查 webhook，避免 LINE Developers Console 被手動改回舊 URL。
3. 每次更動 Rich Menu 後，重新執行 `installDefaultLineRichMenu` 或 admin action `installRichMenu`，再用 `richMenuHealth` 查核。
4. 若要做完整資安掃描，先處理未追蹤 zip / starter-kit，避免掃描時間不可控。
