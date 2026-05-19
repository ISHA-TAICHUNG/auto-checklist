# 安全模型 — 已知 trade-off 與升級條件

## 當前安全模型（v7.x）

| 層級 | 防護 |
|---|---|
| 前端 → 後端 | API_TOKEN 共享 secret（半公開，在 `js/config.js`）|
| 後端 doPost | size limit 5MB + signature regex + result/risk/methods whitelist + LockService |
| 後端 admin endpoints | 全部需要 token + 唯讀 / 受限副作用 |
| `fetchPdf` | 範圍限制：必須在 ARCHIVE_ROOT_FOLDER_ID 下 + mimeType=application/pdf |
| Drive 歸檔 | 結構化權限：由部署者擁有，僅共用對象可看 |
| Sheets DB | 部署者擁有，僅共用對象可看 |
| 場地表 | 由原作者擁有，部署者僅讀取權 |
| 機構名稱 / email | 不在 source code，runtime 從 DB「系統設定」載入 |

## 已知 trade-off

**`API_BASE` 與 `API_TOKEN` 在 `js/config.js` 中明文存在 git 與 GitHub Pages**

原因：GitHub Pages 是靜態託管、沒有 server-side template，前端 JS 必須能直接讀到值才能呼叫後端。

實質風險（中等）：
- 攻擊者拿到 token 後，可呼叫 admin endpoints（看異常清單、下載歸檔 PDF）
- PDF 含填表人姓名 + 手寫簽名 = 個資外洩
- 假填檢查表（被 size / regex / whitelist 擋掉明顯偽造，但精心偽造能通過）

實質風險（低）：
- 不會洩漏機構身分（source code 都 placeholder 化）
- 不會洩漏個人 email（已移至 DB 系統設定）
- 不會直接暴露 Drive / Sheets ID（只在 Apps Script 內部，沒 push 到 git）

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
3. （可選）regenerate API_TOKEN 同步更新 Config.gs + js/config.js

## 升級到「方案 B: GitHub Actions 注入」的時機

不改 visibility，但用 GitHub Actions 在 build 時把 token 從 Secrets 注入

升級條件：
- [ ] 不想付費但要 token 不在 git history
- [ ] 系統規模擴大、多人協作開發

升級步驟（約 30 分鐘工程）：
1. GitHub repo → Settings → Secrets → Actions → 新增 `API_BASE`、`API_TOKEN`
2. 加 `.github/workflows/pages.yml` 在 deploy 前替換 `js/config.js` 內 placeholder
3. 把 `js/config.js` 內 real value 改回 `PASTE_YOUR_...` 並 commit
4. push 後 Actions 自動跑，產出含真實值的 `js/config.js` 並 deploy 到 Pages
5. （Bonus）`js/config.js` 加入 `.gitignore` 改用 `.template` 模板

需要時找我做。

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
- ❌ 跨機構共用同一個 API_TOKEN（每個部署應該獨立）
