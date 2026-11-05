# 主管待簽核提醒清單：獨立 Codex 審閱

- task_slug: pending-approval-reminder-list-20261105
- reviewer: Codex /root/reminder_reviewer；唯一產品／正式測試 writer: Codex /root。
- 結論：**PASS**。沒有需要本輪修改的 P0／P1／P2 問題。
- 審閱範圍：實際產品 diff、新增測試、提醒 sender／排程及待簽核查詢的直接呼叫；只寫本 review，沒有修改產品、測試或任務契約。

## 證據與行為

- `apps-script/LineNotify.gs:1896` 原本 `slice(0, 8)`，總數卻使用完整 `records.length`；因此 9 筆時輸出 8 筆明細與「還有 1 筆」，與截圖吻合。
- `Submission.gs` 的 `pendingApprovalReminderJob_` 將完整 `records` 傳入 `sendPendingApprovalReminder_`；sender 再交 builder、Quick Reply 及原主管路由。上游沒有在這條發送路徑先裁成 8 筆。
- 產品 diff 唯一改動是摘要上限由 8 改為 10；`LineNotify.gs/.js` 逐位元一致。9／10 筆明細均完整列出；11 筆仍列 10 筆及準確「還有 1 筆」。收件人、排程、去重與資料操作未變。
- 新測試直接執行真實 builder／sender／Quick Reply；涵蓋 8、9、10、11 筆、總數、順序、換行、餘數、待簽核入口、24／48 小時文案與空清單不送。主管推送接縫以 stub 攔截，沒有真實網路傳輸。

## 獨立執行

| 驗證 | 結果 |
| --- | --- |
| `node scripts/test-pending-approval-reminder-list.js` | PASS，3 組 |
| `node scripts/test-daily-reminder-runtime.js` | PASS |
| `node scripts/test-daily-recipient-policy.js` | PASS，8 組 |
| `node scripts/test-project-health.js` | PASS，17 組 |
| `node scripts/check-apps-script-sync.js` | PASS |
| `cmp apps-script/LineNotify.gs apps-script/LineNotify.js` | PASS |
| `git diff --check` | PASS |

## 驗收界線

- 此修正是最多 10 筆的提醒摘要；超過 10 筆仍採既有摘要設計，不能稱任意筆數全部顯示。
- 「待簽核」查詢在不超過 10 筆時可顯示全部簽核卡；超過 10 筆時仍為 9 筆明細卡加一張餘數卡。本輪沒有修改此查詢規則。
- 本輪沒有讀取正式第 9 筆內容，不能推斷它是哪一筆設備；沒有部署、登入、發送 LINE／Email 或寫正式資料，也沒有驗證已發布後的原生 LINE 版面。既有聊天訊息不會因本機程式修改而更新。

## 使用者授權部署後：部署前審閱

- 本機程式審閱仍為 PASS；**發布腳本目前 REVISE**，部署後驗收尚未進行。
- 審閱受限暫存 `isha-approval-reminder-20261105-uj6qzjqp/release.py`、`manifest.safe.json` 與 `candidate-tests.safe.json`；沒有打開完整私有來源、Config 或憑證檔，也沒有執行任何遠端操作。
- 安全聚合證據顯示指定帳號／主專案核對通過，準備時兩固定部署均為 v138；候選 27 模組只有 LineNotify 不同，其他 26 模組 hash 相同，且 LineNotify 與本機已審候選一致。候選新測試、runtime、recipient、health 與 syntax 共 5 項 exitCode 均為 0。
- `prepare` 從 fresh HEAD 構造候選並要求原固定版本與 HEAD 一致；`publish` 在寫入前檢查 HEAD 與完整固定部署狀態，寫入後查 HEAD、不可變來源，最後保留兩固定入口設定並查 health。這些發布主路徑符合本輪隔離要求。

### P2：自動回復尚未檢查完整部署設定漂移

- 位置：受限暫存 `release.py:213`–`220` 的 `rollback`。
- 證據：回復前只核對 `entryPoints` 及 `versionNumber`，接著以原始完整 `deploymentConfig` 覆寫。若外部將 `description` 或 `manifestFileName` 改動，但入口及版本未變，仍會被原設定覆寫。
- 必要修正：所有 rollback 寫入前，當下完整 `deploymentConfig` 只允許等於 baseline，或本輪以 baseline 加上 `versionNumber=version`、`description=LABEL` 的候選配置；其他配置必須停止自動回復。原入口相等檢查仍須保留。修正後再做部署前複審。
- 此檢查點尚無 `progress.safe.json`、`release-result.safe.json` 或 `rollback.safe.json`，沒有正式發布／回復讀回證據；不能稱部署完成。準備時 v138 只代表該次觀測，恢復時仍須重新核對遠端漂移。

### LINE 驗收範圍調整

- 本專案無既有 LINE message validate 入口；`getLineConfig_` 從 Script Properties 取得 token。secrets 索引同專案條目僅列 API_TOKEN／資料庫與歸檔 ID，沒有本機 LINE token 索引；未讀取其他專案 token 或任何憑證值。
- 採正式不可變來源的 9／10／11 筆離線測試及部署版本／設定／health 讀回驗收。LINE 官方 validate、原生 LINE 版面與自然排程仍列未測；不新增遠端驗證橋接，不發真實訊息。

## 部署前複審：PASS

- 原 P2 已關閉；已實讀更新 `release.py`。rollback 在初次盤點及每次 PUT 前，均要求完整 deploymentConfig 只等於 baseline 或本輪新版配置，並另核對 entryPoints；第三種配置即停止。
- 回復 HEAD 前再次核對當下內容僅可能為 baseline 或候選；當下已是 baseline 時不再寫入。未發現其他必要修正。
- 已再讀 fresh `manifest.safe.json`／`candidate-tests.safe.json`：指定帳號及 primaryProjectMatch 皆 true，baselineVersions 為 138／138，27 模組只變更 LineNotify、保留其餘 26；5 項候選檢查全通過。
- 此為部署前腳本與候選 PASS，尚待正式發布後 readback；只有 root 持有遠端 writer 權限，本 reviewer 沒有執行發布或其他遠端寫入。

## 正式發布後驗收：PASS（v139）

- 已只讀核對 `release-result.safe.json`、`published-tests.safe.json`、`progress.safe.json` 與 manifest；正式發布版號為 **139**，兩個既有固定部署均為 **139**。
- Reviewer 另以本機程式重新計算 baseline／candidate／final HEAD／不可變版本的 type＋source hash，只輸出模組名稱及相等布林值：27 模組集合完全相同，candidate＝final HEAD＝不可變 v139；相對 v138 只有 LineNotify 變更、其餘 26 模組相同。
- 另重新比對 LineNotify 前後完整字串：baseline 中指定 builder anchor 恰有 1 次，僅將該處 `slice(0, 8)` 換為 `slice(0, 10)` 即與 v139 完整來源一致。沒有讀印 Config 或其他私有內容。
- Reviewer 另以本機程式比較兩組保存的固定部署讀回：各自 entryPoints／URLs 完全相同；排除本輪預期改動的版本與 description 後，其餘 deploymentConfig 相同。沒有變更固定入口、權限或執行設定。
- 發布腳本的實際 health 聚合讀回顯示兩個固定入口均 `ok=true`。回傳 build 保留既有 incident-lock 識別，API version 為 1.0；兩者均不是 Apps Script 部署版號，實際版號以 Script API 的 v139 讀回為準。
- 正式不可變來源的 5 項 published 檢查均 exitCode=0；Reviewer 再獨立載入不可變 v139 的 LineNotify，在沒有雲端服務的 Node VM 執行匿名 9／10／11 筆 fixture，分別列 9／10／10 筆，11 筆正確顯示「還有 1 筆」，均通過。
- 安全結果記錄真實訊息 0、未寫業務資料；本 reviewer 沒有呼叫 auth／prepare／publish／verify，也沒有任何遠端操作。發布腳本沒有觸發正式通知或重建排程。
- 最終結論：本輪純提醒摘要上限修正已完成部署及來源／版本／設定／health 驗收，**PASS**。LINE 官方 validate、原生 LINE 視覺版面與後續自然排程仍為未測，不能以此驗收聲稱它們已成功；舊聊天訊息也不會回溯更新。
