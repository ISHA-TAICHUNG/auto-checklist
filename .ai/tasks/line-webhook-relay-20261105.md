# LINE Webhook 前置層

- task_slug: line-webhook-relay-20261105
- writer: Claude（管理職類測驗網題庫 session）；reviewer: Claude reviewer agent
- lease_status: 待 hao 決定（v144 實測合計 7761 毫秒；建議停止優化並 push）
- 目標：按 LINE 按鈕後立即看到轉圈，不增加任何額度。回覆內容的耗時不變（幫助約 4 秒、狀態約 15～18 秒，v136 原生量測）。
- 硬限制：不可增加訊息額度。Worker 只呼叫 chat/loading/start 與 Apps Script，不呼叫 LINE 訊息 API；reply 依官方收費文件不計入，轉圈不屬於官方列出的計入方式。POST 只送一次，任何轉址都不重送。
- allowed_paths: cloudflare/line-webhook-relay/；apps-script/LineNotify、LineWebhook、Main 的 .gs 與 .js；scripts/test-line-webhook-relay.js、scripts/test-settings-read-snapshot.js（build 字串）；本檔。
- forbidden_actions: 未經 hao 核准不切 Webhook；不代填任何金鑰；真實 LINE 訊息只限私人對話的「幫助」「狀態」，不觸發填報、簽核或陳核（陳核會走 push）。
- 2026-11-05 hao 同意開始上線並將操作交給 Claude；金鑰由 hao 自行輸入，切換 Webhook 需當下再確認。Cloudflare 帳號為 geminihao0516 個人帳號。

## 2026-11-05 接手進度（自動檢查表對話）

- 待辦 1 完成：v140 原始碼已提交（d06cb5b，分支 fix/line-status-timing，未 push）。
- 待辦 2 完成：Worker `isha-line-webhook-relay` 已於 21:17 刪除。刪除前金鑰為空；Cloudflare 指標全部只有 18:41（部署同一分鐘）2 筆請求，對得上當時的 GET 404、POST 500 測試。Worker 程式留在 d06cb5b 的 git 歷史。
- 待辦 3 調整：不用 Logger／console。程式用預設 GCP 專案，匿名 doPost 的執行項目無法展開紀錄，`clasp logs` 也回 Permission denied（isha-taichung-test 沒連到這支程式，開權限無效）；錯 token 測試請求已驗證看不到紀錄。改成傳「狀態計時」時把各段毫秒數回在 LINE，reply 不計額度；一般「狀態」回覆不變，總秒數可由執行項目頁對照。
- v141 已發布（21:25）：從雲端 HEAD（等於 v140）建受限套件，只換 LineNotify、LineWebhook、Main、Reminder；HEAD 與 v141 都和套件逐位元相同；兩個固定部署 @141，build `2026-11-05-line-status-timing`。回滾：兩部署改回 v140。
- 發布後驗證：兩個入口 health 正常。第一輪表單 20/21，`FORK-LJ-B` 月檢回「系統處理失敗，請聯絡管理員」一次，原因不明（執行項目全部顯示已完成，看不到例外）；同一張表單隨後重試 5/5 成功，第二輪 21/21，鎖定 0。這次改動沒有碰表單路徑。
- 全套離線測試 25/25；`test-checklist-loading.js` 需要 `PLAYWRIGHT_MODULE`，且專案內 Playwright 要的瀏覽器版本未安裝，要包一層 `channel: 'chrome'` 才會真的跑。
- 未驗證：真實 LINE 上的「狀態計時」回覆與版面、實際秒數。
- 待 hao 傳「狀態計時」後依數字決定優化；量完移除指令與放寬的測試比對。
- v141 實測一筆（hao 21:40，LINE 原生）：事件到程式 2022、合計 20615 毫秒，其中設備日檢 10233、場地防護具 5620、設備與週期設定 1441、待簽核 1250、月檢 864。同時段 3 筆 doPost 總秒數 26.7、29.1、22.7，比先前的 15～18 秒慢，原因未查。
- v142 已發布（22:11）：場地防護具重用同次已讀的場地資料；填報紀錄只有 LINE 狀態查詢才共用，正式提醒仍逐次查核；同一次操作內分頁與年度只查一次；設備日檢拆成場地與填報紀錄兩段；轉圈 30 秒。受限套件只換 Calendar、DailyPpeAssignment、LineNotify、LineWebhook、Main、Reminder；已確認 `4fd4cf9` 與 v141 除 Config 與 manifest 外相同，HEAD 與 v142 都和套件逐位元相同。回滾：兩部署改回 v141；觸發器跑 HEAD，要再 push 舊內容才會退回。
- 發布後驗證：兩個入口 health 正常，build `2026-11-05-line-status-read-reuse`；表單 21/21，鎖定 0。
- 未驗證：v142 的實際秒數、正式提醒自然執行、原生 LINE 轉圈。待 hao 傳「狀態計時」比較；量完移除指令與放寬的測試比對。
- v142 實測一筆（hao，LINE 原生）：事件到程式 1988、合計 13876 毫秒；設備與週期設定 812、設備日檢-場地 1921、設備日檢-填報紀錄 6392、場地防護具 1089、月檢 1024、待簽核 1563。
- v143 已發布（22:36）：原方案是只讀需要的欄位，看程式後改做更小的修正。每台設備原本都重掃整張表且每列都轉日期，同一張表的月檢與待簽核只花 1～1.6 秒，所以推測主因是重複掃描。改成先比對表單類型與類別才轉日期，同次狀態查詢同類別共用結果；正式提醒不共用。受限套件只換 DailyPpeAssignment、Main、Reminder；已確認 `fba0eac` 與 v142 除 Config 與 manifest 外相同，HEAD 與 v143 都和套件逐位元相同。回滾：兩部署改回 v142；觸發器跑 HEAD，要再 push 舊內容才會退回。
- 發布後驗證：兩個入口 health 正常，build `2026-11-05-line-status-scan-reuse`；表單 21/21，鎖定 0。
- v143 實測一筆（hao，LINE 原生，11/6 凌晨約 03:00）：事件到程式 2627、合計 11465 毫秒；設備與週期設定 994、設備日檢-場地 2303、設備日檢-填報紀錄 1831、場地防護具 194、月檢 942、待簽核 3655、轉圈 695、訂閱者資料 709。填報紀錄 6392→1831、場地防護具 1089→194，推測成立；其他段普遍慢 20～50%，待簽核 1563→3655 原因未定（本版沒改該段，單筆可能是波動）。
- 待簽核現為最大段：`listPendingApprovalRecords_`（Submission.gs:651）對每列都完整解析後才篩選。hao 同意改這段；查程式後發現狀態卡片本來就濾掉待簽核結果（`isNonActionableChecklistStatus_`，LineNotify.gs:1122），改為更小的做法：LINE 狀態查詢帶 `skipPendingApproval` 直接不算，正式提醒、管理頁試算不帶旗標照舊。`listPendingApprovalRecords_` 本身沒改。
- 刻意的行為差異：待簽核出錯時，v143 的狀態卡片會多一列標錯名稱的「主管待簽核日檢」失敗項，v144 不再顯示；正式提醒出錯仍記入管理頁健康檢查。狀態查詢不再覆寫 `PENDING_APPROVAL_REMINDER_LAST_DRY_RUN`，`DAILY_REMINDER_LAST_DRY_RUN_V1` 不再含待簽核一筆；讀取端只有管理 API，健康檢查只讀正式 `lastRun`。
- v144 已發布（11/6 03:19）：`8ecc462`，受限套件只換 LineWebhook、Main、Reminder；已確認 `bf3c0b3` 與 v143 除 Config 與 manifest 外相同，HEAD 與 v144 都和套件逐位元相同。兩入口 build `2026-11-06-line-status-skip-pending-approval`，表單 21/21、鎖定 0（3.23／4.46／5.83 秒）。回滾：兩部署改回 v143；觸發器跑 HEAD，要再 push 舊內容才會退回。
- v144 實測一筆（hao，LINE 原生，11/6 約 03:25）：事件到程式 2467、合計 7761 毫秒；設備與週期設定 1260、設備日檢-場地 2147、設備日檢-填報紀錄 1274、場地防護具 126、月檢 1248、待簽核 0、轉圈 489、訂閱者資料 1145。合計歷程：v141 20615 → v142 13876 → v143 11465 → v144 7761。
- 剩餘各段約 1～2 秒且分散：場地要跨次快取外部場地表（有資料新鮮度風險）；訂閱者資料每次重讀整張訂閱者表（快取會延後主管權限撤銷生效）；月檢可再重用同次已讀的填報紀錄。報酬遞減，建議停在 v144。
- 未驗證：各版只有一筆，段落間波動約 ±50%、正式提醒自然執行。量完移除指令與放寬的測試比對。

## 2026-11-05 決定與待辦

hao 接受建議：不加前置層，改查「狀態」查詢的 15～18 秒，並說「通知小幫手這部分都修改，改到自動檢查表_電子話的專案對話匡進行討論」。原因：前置層只省轉圈前 2～3 秒，回覆不會變快，還要多存一份 LINE 金鑰並同步維護；webhook 路徑（靜態閱讀）沒有全域鎖、回覆前不寫試算表日誌，轉圈前只剩 Apps Script 起動。

目前狀態：

- 兩個固定部署是 v140（health build `2026-11-05-line-webhook-relay`），只多 `endpointIsExpectedRelay` 欄位與轉圈 20 秒。Webhook 從未切換，仍直連 Apps Script。
- Worker `isha-line-webhook-relay` 已部署但閒置，帳號 geminihao0516，從未收過 LINE 事件；`wrangler secret list` 為空。`LINE_WEBHOOK_RELAY_URL` 未設定。
- 未提交：`apps-script/LineNotify.gs`、`LineWebhook.gs`、`Main.gs`、`scripts/test-settings-read-snapshot.js`、`scripts/test-line-webhook-relay.js`、`cloudflare/`、本檔。`.js` 不進版控，內容等於線上 v140，不可還原。

待辦（三項都已獲 hao 同意）：

1. 提交 v140 原始碼：只加相關檔案，不用 `git add .`（工作區有大量無關未追蹤檔），不 push。
2. 移除閒置 Worker：確認沒有流量與金鑰後 `wrangler delete`，並移除 `cloudflare/`。`endpointIsExpectedRelay` 已不需要，連同 `scripts/test-line-webhook-relay.js` 的相關斷言在下一版一併拿掉；轉圈 20 秒保留。
3. 替 `cmdStatus_` 加分段計時：`LineWebhook.gs:276` 的 `dailyReminderJob_`、PPE、每日作業、訂閱者資料各段，只用 `Logger`／`console`，不寫試算表，不記 userId 等個資。審閱後走受限發布（`.gs` 與 `.js` 都改、更新 build 字串與 `scripts/test-settings-read-snapshot.js`、`clasp --user isha263`），再請 hao 傳幾次「狀態」量測，依結果再決定優化，不憑讀取次數推算秒數。

注意：`clasp list-deployments` 更新後約 1 分鐘才顯示新版本；回滾點是 v140。

## 上線順序（已取消，僅留存）

### 1. Apps Script 發布（切換前必做）

由 hao 核准，以 `isha26336999@gmail.com` 走受限發布流程，勿從共用工作目錄整包 clasp push。`apps-script/.claspignore` 排除 `.gs`，實際推送的是 `.js`，以下修改 `.gs` 與 `.js` 都要改，並確認部署內容。

- 健康檢查新增 `endpointIsExpectedRelay`，比對新的 Script Property `LINE_WEBHOOK_RELAY_URL`。切換後現有三個 endpoint 比對欄位會恆為 false，失去判斷能力。
- `LineWebhook.gs:77` 的轉圈秒數由 10 改為 20（`LineNotify.gs:651` 上限）。LINE 以最後一次請求為準，10 秒會在狀態回覆到達前結束。

### 2. 部署 Worker

由 hao 設定 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`GAS_WEBHOOK_URL` 三個 secret（`wrangler secret put`）。此時 LINE 尚未指向 Worker，不影響線上使用者，未簽章請求一律 401。

- `GAS_WEBHOOK_URL` 必須用 LINE 目前指向的那一個固定入口（專案有兩個），先記下來；回滾也要從同一個入口呼叫，因為 `buildExpectedLineWebhookEndpoint_` 依當下部署的網址決定端點。
- Worker 部署後才知道網址，此時到 Apps Script 專案設定新增 Script Property `LINE_WEBHOOK_RELAY_URL`（值為 Worker 網址）。程式只讀不寫，設定後不用重新發布。沒設定時第 5 步的 `endpointIsExpectedRelay` 必定為 false。

### 3. 切換前演練

用已簽章的合成請求打 Worker，內容為「幫助」加假 replyToken，userId 用 hao 自己的（假 ID 可能讓轉圈回 400，干擾驗收）。不可用「陳核」，那會走 push。這會真實走完 doPost，reply 因 token 無效而失敗，不計額度。錯 token 演練改回後，要再跑一次正常請求確認恢復。

- Apps Script 執行紀錄中只有一次 doPost。
- Cloudflare log 沒有 `[relay]` 錯誤，排除 Google 擋結果網址造成的誤報。
- 暫時用錯 token 演練，確認查得到 `[relay] gas invalid_webhook_token`，再改回正確值。

### 4. 備妥回滾，選離峰切換

- 備妥 `adminToken`，記下切換前的端點，確認 `lineWebhookHealth` 呼叫得通。回滾本身不能事先空跑。
- 回滾方式：管理動作 `syncLineWebhookEndpoint` 會把網址改回 Apps Script，不需改程式。

### 5. 切換後驗證，任一項失敗立刻回滾

- 私訊傳「幫助」與「狀態」：立即出現轉圈、回覆正常、中文解碼正常。
- Apps Script 執行紀錄中每則指令只有一次 doPost。
- `lineWebhookHealth` 的 `endpointIsExpectedRelay` 為 true。

## 上線後的維運規則

- 新建 Apps Script deployment 或輪替 `LINE_WEBHOOK_QUERY_TOKEN` 時，必須同步更新 Worker 的 `GAS_WEBHOOK_URL`，並傳一則真實指令驗證。健康欄位只能確認 LINE 指向 Worker，確認不了 Worker 指向哪個 deployment；舊 deployment 仍可能回成功。
- 輪替 `LINE_CHANNEL_SECRET` 或 `LINE_CHANNEL_ACCESS_TOKEN` 時，必須同步更新 Worker。channel secret 不同步時，Worker 會對所有事件回 401，整個 bot 沉默，而且這條路徑刻意不寫 log（公開網址被亂打會灌爆紀錄），要用 LINE 後台 Verify 檢查。
- LINE Verify 只驗到 Worker 的簽章與設定，不會碰 Apps Script，通過不代表轉送正常。
- 執行 `syncLineWebhookEndpoint` 會繞過 Worker，只在回滾時使用。
- `[relay] gas TimeoutError` 代表超過 25 秒，不代表失敗；Apps Script 應仍會跑完（未實測）。
- Worker log 只回答「轉送有沒有成功」，而且沒有主動告警，要有人去查才看得到。成功不代表回覆已送出，指令失敗要看 Apps Script 的 Logger。

## 驗證紀錄

- `cd cloudflare/line-webhook-relay && node --test index.test.mjs`；`node scripts/test-line-webhook-relay.js`；`node scripts/check-apps-script-sync.js`；`node scripts/test-project-health.js`
- 第四輪審閱：Apps Script 可發布、Worker 可部署；reviewer 該輪曾執行一次 `git fetch --dry-run`，超出只讀範圍但不改 refs。
- 第一輪審閱 FAIL：轉送失敗無訊號、健康檢查失效。第二輪 FAIL：部分失敗回應不留紀錄、跟隨轉址遇 307／308 會重送 POST。第三輪 Worker 程式碼 PASS，另有 4 項 P2 與本紀錄的修正項，已修。
- 健康檢查失效尚未解決，待上線順序第 1 步。
- 未驗證：真實 Apps Script 從 Workers 的行為、連線中斷後 Apps Script 是否繼續執行（Worker 25 秒會主動斷線，這個假設很關鍵）、Cloudflare 正式環境、原生 LINE 體感、實際 CPU 用量（Free 方案每請求上限 10 ms，超過回 Error 1102 且事件不會轉送，演練時要到 Cloudflare 後台確認）。
