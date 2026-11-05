# LINE 填表狀態 metadata 讀取：獨立 Codex 審閱

- task_slug: line-status-performance-20261104。
- reviewer: Codex settings_reviewer；產品唯一 writer 為父代理。
- 結論：**PASS**。在 Templates／LineWebhook 與新正式測試的本輪範圍內，未發現需要修正的 P0／P1／P2。
- 本 reviewer 僅新增此檔；未寫入產品或正式測試、未部署、未改資料、未發送 LINE／Email，未讀寫舊 AGENT_LOG，未修改已 CLOSED 的 settings review。

## 範圍與來源核對

- 已讀任務契約及當前 Templates.gs、LineWebhook.gs、對應正式整合測試，並核對必要的 Reminder、PPE、月檢、待簽核及送出呼叫鏈。
- 與公開 GitHub 基線 `306bb3271757a55e544e074b1cfc31826338809b` 比對，Templates 變更只有作用域／原始表 loader，以及三個 getter 的讀取入口；原列解析、active、第一筆重複 ID、欄位與回傳形狀保留。LineWebhook 差異只有 cmdStatus 的 dry-run 包裝。
- Templates.gs／Templates.js、LineWebhook.gs／LineWebhook.js 分別逐位元相同；沒有將另一任務 Calendar／Main 變更視為本輪產品變更。

## 正確性與邊界

1. `Templates.gs:16`：作用域只活在同步 callback；巢狀呼叫重用外層 Map，`finally` 必定清除。沒有 CacheService、跨操作 TTL 或持久化快取。
2. `Templates.gs:26`：只允許「設備清單」「檢查表模板」，鍵包含 DB 身分；其他表名直接執行 loader，人員／權限資料不加入快取。loader 連 openById、sheet 及 getValues 一起被包住，命中時不再開啟試算表。
3. 讀取失敗在 Map 寫入之前拋出，不能保存為空資料。模板缺表或只有標題時 loader 回 null，保留既有 {} 回傳且不快取；同一作用域內補齊後可重讀。
4. `Templates.gs:39`：每次向呼叫端回傳新的列與 Date，getter 也重新建立回傳物件／週期陣列，避免呼叫端修改污染後續 metadata 查詢。
5. `LineWebhook.gs:280`：唯一啟用處是 cmdStatus 中的 `dailyReminderJob_({dryRun:true})`。主管 profile 在作用域結束後才讀取；其他 LINE 指令、公開 GET、正式提醒與送出沒有自動啟用。
6. dry-run 仍完整保留日檢、PPE、月檢與主管待簽核的流程及既有診斷。月檢／待簽核函式仍使用原本 dryRun 防護，不因這次快取改動觸發正式通知。
7. `Submission.gs:52`、`141`、`183` 的鎖前設備與鎖內表單查核路徑未改；Main 的 settings 作用域與本輪 metadata 作用域彼此獨立。因此送出不會自動沿用狀態指令的設備／模板快照。
8. metadata 是單次狀態計算的共同輸入；本輪沒有快取填報紀錄、完成狀態、異常、簽核或通知結果，也沒有移除原有驗證。

## 正式測試是否測到真正候選

- 新測試直接載入 Utils／Templates／Reminder／LineWebhook，執行真實 cmdStatus 與 dailyReminderJob；PPE／月檢僅以 getter 呼叫模式隔離，沒有為候選補 patch。
- baseline 只關閉作用域能力；候選保留真實實作。fixture 的設備讀取 32→1、週期模板 3→1、openById 35→2，狀態卡片 JSON 相同。
- 這是離線 fixture 計數，不是正式 Apps Script trace，也不代表整個指令只有兩次外部讀取。
- 下一指令更新設備啟用、名稱、模板週期與主管身分；直接 getter 的兩次新鮮度邊界、正式排程不啟用 scope、巢狀／拋錯清理、Date／物件／陣列隔離、失敗復原、缺表／空模板、重複 ID、active 同義值、跨 DB 及禁止人員表快取皆有斷言。
- 送出新鮮度是直接 getter 邊界測試與實際來源呼叫鏈核對；本 reviewer 未執行正式提交、PDF 或 Drive 外部操作。

## 獨立執行結果

| 驗證 | 結果 |
| --- | --- |
| `node scripts/test-line-status-metadata-snapshot.js` | PASS |
| `node scripts/test-daily-reminder-runtime.js` | PASS |
| `node scripts/test-daily-recipient-policy.js` | PASS，8 組政策案例，沒有網路或真實收件者 |
| `node scripts/test-line-dashboard-entry.js` | PASS |
| `node scripts/test-project-health.js` | PASS，17 組 |
| `node scripts/test-reminder-read-context.js` | PASS，保留前輪單次場地 context 整合 |
| `node scripts/check-apps-script-sync.js` | PASS，Config 正式值按既有規則排除 |

### 獨立記憶體 mutation 檢查

未寫入任何來源，分別覆蓋當次測試讀到的模組字串；六種缺漏均被正式新測試拒絕：

1. 移除 cmdStatus 的作用域 wrapper。
2. 略過 metadata 快取。
3. 移除 finally 清理。
4. 移除列與 Date 隔離。
5. 移除快取鍵的 DB 身分。
6. 放寬成允許人員／profile 表快取。

## 共用呼叫端前後狀態

| 呼叫端 | 調整前 | 調整後 | 證據／限制 |
| --- | --- | --- | --- |
| LINE 填表狀態 dry-run | 多次設備／模板全表讀取 | 當次 metadata 重用，卡片 JSON 相同 | 真實入口整合 fixture；待發布後原生 LINE 驗證 |
| 主管／人員 profile | 原本逐次查詢 | 保留逐次查詢，且位於 scope 外 | 跨指令角色更新及表名 allowlist 測試 |
| 填報／鎖前鎖內查核 | getter 直接讀最新資料 | 維持預設 fresh，未包 metadata scope | getter 邊界及來源核對；未執行正式填報 |
| 正式提醒排程 | 原有讀取、去重及失敗隔離 | 不自動啟用 metadata scope，通知流程不變 | 真實 job freshness、runtime 及通知政策回歸 |
| 其他 LINE 與 GET 呼叫 | 原本直接查詢 | 不自動啟用 metadata scope | 只有 cmdStatus 包裝的來源差異核對；未逐命令發送訊息 |

## 發布與量測界線

- 本 PASS 僅涵蓋本輪來源與離線驗證。發布應等待 venue-forklift-alias 共用部署邊界 CLOSED，重新抓最新 HEAD／固定版本，只替換 Templates／LineWebhook；其餘 25 個模組逐位元保留，不得從共享資料夾整包 push。
- LINE 原生觀察只能確定先前填表狀態超過 22 秒尚未回覆；85 秒是後續看見回覆的觀察點，不是精確反應時間。
- metadata 讀取次數改善不能換算成保證的 LINE 秒數。本 reviewer 未發送訊息；發布後需由 writer 另做原生回覆觀察及卡片內容核對。
