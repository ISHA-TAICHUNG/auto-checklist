# LINE 狀態日檢紀錄讀取：獨立 Codex 審閱

- task_slug: line-status-record-read-20261104。
- reviewer: Codex settings_reviewer；產品及正式測試的唯一 writer 為父代理。
- 最終結論：**PASS（初審 P2 已由測試補強關閉）**。未發現需要修改產品的功能或資料新鮮度缺陷；正式 metadata-wrapper 與 fallback 兩分支的整合證據已補齊。
- 本 reviewer 僅新增此 review 檔；未改產品或正式測試、未部署、未發送訊息、未寫正式資料，未修改前輪 CLOSED 的 review。

## 初審必要修正（已完成）

### P2：正式 metadata-wrapper 路徑未被新整合測試涵蓋（已補正）

- 位置：`scripts/test-line-status-record-read.js:47`–`50`，以及 `LineWebhook.gs:280`–`282`。
- 初審版本的測試 runtime 只載入 Reminder／LineWebhook，沒有 `withStatusMetadataReadSnapshot_`，因此初審新測試都走 fallback。正式環境已具備此 helper，會走第 281 行的 wrapper 分支。
- 獨立記憶體 mutation 證據：只移除第 281 行的 `reuseDailyRecords:true`、保留第 282 行 fallback 的選項，新測試仍輸出 PASS。這個遺漏會讓正式分支回到逐設備讀取，卻未被本輪成功標準的 7→1 測試抓到。
- 必要修正：保留 fallback 相容性驗證，另建立具備真實 Templates metadata helper 的 runtime，覆蓋正式分支的 7→1、卡片 JSON 一致及下一指令 fresh；只移除正式分支 opt-in 的 mutation 必須被測試拒絕。測試不得為候選注入 reuseDailyRecords 或快取實作。
- 目前產品兩個分支都有正確選項，無需為此修改產品；缺口是正式使用路徑的回歸證據。

### 補正後獨立重審

- `scripts/test-line-status-record-read.js:12` 現在預設 `useMetadataScope=true`，`47`–`49` 載入真實 Templates helper；主候選測試確實走正式 wrapper，完整保留 7→1、卡片一致、跨指令更新與失敗復原斷言。
- `80`–`90` 額外建立沒有 helper 的 fallback runtime，確認能力缺席、1 次讀取、卡片一致及下一指令新增填報的 fresh 結果。
- 獨立重新執行日檢紀錄整合與 metadata 整合測試，均 PASS。記憶體 mutation 分別移除正式 wrapper 或 fallback 任一分支的 opt-in，現在兩種缺漏都被正式測試拒絕。
- 此次補正只需調整正式測試；本 reviewer 沒有修改產品或測試，初審 P2 關閉。

## 已核對的產品行為

1. `Reminder.gs:152` 同時要求 `dryRun` 與嚴格布林值 `reuseDailyRecords===true`，才建立函式內本地 context。一般 dry-run、正式提醒（即使誤帶旗標）皆保留原本逐次查核。
2. `Reminder.gs:176` 僅將當次 context 傳入日檢查詢；沒有擴張既有 metadata 或 settings 作用域，也沒有修改 Calendar、月檢、PPE、通知或送出流程。
3. `Reminder.gs:250` 的 getter 預設無 context 即 fresh；有 context 時核對 DB 身分。只共用原始資料，不保存第一個類別或日期的布林判定。
4. 缺表仍拋錯、空表仍按原語意回 false 且不保存、服務讀取失敗不保存。必要欄位驗證完成後才寫入 context；後續仍保留原日期／每日型別／category 的嚴格判定。
5. 原始列僅在內部讀取，不修改或回傳給呼叫端；沒有全域保存、跨指令 TTL 或持久化資料。
6. `LineWebhook.gs:281`／`282` 目前皆明確傳入 opt-in，主管身分及後續卡片流程未改。
7. 與公開基線 `ee12764584c29f4b5d1e1cdd800f293c97362382` 的差異限於這次 context、getter 的共用讀取及兩個 opt-in；兩組 `.gs/.js` 各自逐位元一致。

## 已獨立執行

| 驗證 | 結果 |
| --- | --- |
| `test-line-status-record-read.js` | PASS；補正後獨立重跑，正式 wrapper 與 fallback 均有整合證據 |
| `test-line-status-metadata-snapshot.js` | PASS |
| `test-reminder-read-context.js` | PASS |
| `test-daily-reminder-runtime.js` | PASS |
| `test-daily-recipient-policy.js` | PASS，8 組、無真實傳輸 |
| `test-project-health.js` | PASS，17 組 |
| `check-apps-script-sync.js` | PASS，Config 正式值按原規則排除 |

### 記憶體 mutation 結果

| 遺漏／回歸 | 是否被正式新測試拒絕 |
| --- | --- |
| 移除兩分支 opt-in | 是 |
| 只移除正式 metadata 分支 opt-in | 初審未拒絕；補正後已拒絕，P2 關閉 |
| 只移除 fallback 分支 opt-in | 補正後已拒絕 |
| 正式提醒誤啟用快取 | 是 |
| 一般 dry-run 誤啟用快取 | 是 |
| 遺漏成功資料快取 | 是 |
| context 跨指令保存 | 是 |
| 遺漏 DB 身分檢查 | 是 |
| 遺漏必要欄位驗證 | 是 |

## 發布界線

- P2 測試補強已重新審查通過，本切片已 PASS；發布仍須完成最新遠端比對與隔離套件門檻。
- 此效能切片只能證明日檢紀錄的同次讀取從 D 次變 1 次，不代表 LINE 固定秒數；仍需發布後原生量測。
- 發布前重新取得最新遠端，只替換本輪 Reminder／LineWebhook，其餘 25 個模組逐位元保留；不以舊版整包覆蓋共享工作目錄或雲端。
