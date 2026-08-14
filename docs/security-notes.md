# 安全模型 — 已知 trade-off 與升級條件

## 當前安全模型

| 層級 | 防護 |
|---|---|
| 前端 → 後端 | 後端核發 10 分鐘短效、動作綁定、一次性操作票證；公開前端不保存共享密鑰 |
| 後端 doPost | size limit 5MB + signature regex + result/risk/methods whitelist + LockService |
| 後端 admin endpoints | 僅接受未公開的 `ADMIN_TOKEN`；公開操作票證不能授權管理功能 |
| Cloud Run → Apps Script | Secret Manager 中的伺服器 `API_TOKEN` + `ADMIN_TOKEN` 雙重驗證 |
| `fetchPdf` | 範圍限制：必須在 ARCHIVE_ROOT_FOLDER_ID 下 + mimeType=application/pdf |
| Drive 歸檔 | 結構化權限：由部署者擁有，僅共用對象可看 |
| Sheets DB | 部署者擁有，僅共用對象可看 |
| 場地表 | 由原作者擁有，部署者僅讀取權 |
| 機構名稱 / email | 不在 source code，runtime 從 DB「系統設定」載入 |

## 已知 trade-off

短效票證可撤銷曾公開的長效共享 token，限制重放時間、使用次數與動作範圍，但它不是使用者身分驗證。票證採伺服器簽章，核發時不寫入共用 Cache；只有成功使用後才暫存 nonce 以阻擋重放，避免匿名核發請求把合法票證逐出 Cache。CacheService 屬 best-effort，因此極端提前逐出時，一次性重放防護可能退化；票證仍受簽章、10 分鐘效期及 action 範圍限制。

因公開表單允許匿名開啟，具意圖的自動化程式仍可先取得新票證再嘗試送件；後端 payload 上限、欄位白名單、格式驗證、idempotency 與 LockService 仍是必要防線。若需辨識填表者身分，必須導入 LINE LIFF、Google Workspace 登入或其他登入機制。

舊版 `GET ?api=admin&adminToken=...` 只保留臨時診斷相容性；query string 可能進入瀏覽器歷史或執行紀錄，日常管理應使用營運中控台的 POST 流程。

## 升級到「方案 A: Private repo」的時機

把 `<your-github-username>/auto-checklist` 改為 private（保留 GitHub Pages 需要 GitHub Pro 或 Organization Free）

升級條件（任一觸發）：
- [ ] 觀察到「不明來源的 POST」污染 DB「填報紀錄」
- [ ] 主管 / 法務要求「source code 不公開」
- [ ] 系統有外洩事件 / 媒體報導
- [ ] 加入更敏感資料（薪資、健保、契約）

升級步驟：
1. GitHub repo → Settings → General → 滑到底 → Change visibility → Make private
2. 確認 Pages 仍可用（個人 Pro 帳號 / Organization）
3. 視需要旋轉伺服器 API_TOKEN；只更新 ignored Apps Script production config 與 Cloud Run Secret Manager，不放進前端

## 立即可用的監測（不用升級）

如果想知道「有沒有人在攻擊 API」：

1. Apps Script editor → 左側 **🔢 執行作業**
2. 看每天 `doPost` 的執行次數
3. 對照 DB「填報紀錄」當日新增筆數
4. 不一致（執行次數遠超實際填表）→ 可能有惡意 POST 試探

或寫進「異常 POST 偵測」endpoint（找我做）：偵測「結果代號不合法」「token 錯」「未授權」的 POST 累計超過閾值 → 寄告警信。

## 永久不會做的事

- ❌ 把 DB Sheet 設成「任何人可看」（即使是 read-only 也不行）
- ❌ 把 ARCHIVE_ROOT_FOLDER_ID 設成 public
- ❌ 在 source code 寫真實 email / 機構名稱（已 placeholder 化）
- ❌ 把伺服器 API_TOKEN、ADMIN_TOKEN、LINE token 或密碼放進 GitHub Pages
- ❌ 跨機構共用同一個伺服器 API_TOKEN（每個部署應該獨立）
