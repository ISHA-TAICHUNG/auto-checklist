# 營運中控台安全操作與 LINE 提醒

- `task_slug`: `admin-dashboard-actions`
- `goal`: 讓營運中控台可直接開啟檢點／事件 PDF、處理或簽核頁，並在顯示實際收件人與預估額度後，由管理者確認發送 LINE 提醒。
- `acceptance`: 前端不接收或指定 LINE userId；後端以正式紀錄及訂閱者清單重算收件人；短效操作連結限定紀錄與用途；LINE 發送具防重、部分失敗重試與二次確認；不影響既有自動通知流程。
- `writer`: `codex-gpt-5.6`
- `reviewer`: `claude-opus-5-high`
- `lease_status`: `REVIEW`
- `allowed_paths`: `apps-script/AdminDashboard.gs`, `apps-script/DailyIncident.gs`, `apps-script/LineNotify.gs`, `apps-script/MachineIncidentHandling.gs`, `apps-script/Main.gs`, `apps-script/Setup.gs`, `apps-script/Submission.gs`, `css/dashboard.css`, `dashboard.html`, `js/api.js`, `js/dashboard.js`, corresponding ignored Apps Script `.js` mirrors, this task file, and `.ai/reviews/admin-dashboard-actions.md`.
- `forbidden_actions`: 不讀出或提交任何密鑰；不變更正式試算表資料；測試不得實際推送 LINE；不得 stage、覆寫或刪除其他未追蹤檔案；Claude reviewer 不得修改產品檔或部署。
- `verification`: Apps Script／frontend JavaScript syntax、`.gs/.js` mirror sync、行為安全測試、前後端 DOM contract、`git diff --check`、桌面與手機視覺檢查、Claude final diff review、正式 GitHub Pages／Apps Script 健康檢查。
- `handoff`: Claude 終審指出的長效 LINE 連結、舊快照清理、KPI 計數、個資日誌、防重送與無障礙問題均已修正；Apps Script／前端語法、鏡像、後端權限與長效連結模擬、DOM contract、桌面／手機互動、密鑰掃描與 diff check 均通過。現交 Claude Opus 5 high 唯讀複審，全程未發送真實 LINE。
- `stop_condition`: Claude 回覆 `PASS` 且 P0/P1 為零後，Codex 才可精確 stage、commit、push 與部署；否則 lease 回到 Codex 修正並重審。
