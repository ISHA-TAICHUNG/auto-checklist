# 主管待簽核提醒清單顯示

- task_slug: pending-approval-reminder-list-20261105
- 目標與驗收：說明截圖的 9 筆只列 8 筆原因；提醒卡片改為最多列 10 筆，9／10 筆均完整呈現，超過 10 筆仍明示餘數並保留待簽核入口。
- writer: Codex /root；reviewer: Codex reminder_reviewer；lease_status: CLOSED（2026-11-05 由 Claude 接手結案）。
- allowed_paths: apps-script/LineNotify.gs 與 LineNotify.js 的 buildPendingApprovalReminderFlex_；scripts/test-pending-approval-reminder-list.js；本任務檔；對應 .ai/reviews/pending-approval-reminder-list-20261105.md（只由 reviewer 寫）；系統受限暫存中的發布套件／備份／驗證；本專案 Apps Script HEAD 與兩個既有固定部署。
- forbidden_actions: 不改收件人、排程、資料讀寫與正式業務資料；不送 LINE／Email、不新增登入或擴 OAuth scope、不改其他 dirty／untracked；不呼叫 Claude CLI、不讀寫舊協作日誌；不直接整包推送共享工作區，不改部署權限或 URL。
- 結構與交接：CodeGraph 查詢確認本專案無可用索引，已直接核對 builder、sender、排程呼叫及待簽核查詢；LineNotify tracked 乾淨且 .gs/.js 一致。舊 admin-dashboard-actions 為 REVIEW，本輪僅持有提醒摘要 builder，不接手其功能或發布權。
- 驗證命令：node scripts/test-pending-approval-reminder-list.js；node scripts/test-daily-reminder-runtime.js；node scripts/test-daily-recipient-policy.js；node scripts/test-project-health.js；node scripts/check-apps-script-sync.js；git diff --check。
- stop_condition: 重新核對指定 Google 帳號、最新 HEAD／固定部署及候選，只換本輪函式，保留其他模組；部署後版本／不可變來源／HEAD／設定／health 與正式不可變來源的 9／10／11 筆卡片測試均核對，獨立 Codex 發布驗收後關閉。漂移或不可回復風險未釐清時停止寫入；不測試真實推送。

- 實際修改：僅 builder 的 slice 上限 8→10，同步既有 .js 鏡像；新增 9 筆完整內容、8／10／11 筆邊界、sender 與真實 Quick Reply 的離線回歸測試。
- 驗證結果：新測試先 RED（8≠9），修後 3 組 PASS；runtime、recipient 8 組、health 17 組、鏡像與 diff check 全 PASS；獨立 Codex reviewer 重跑後 PASS，見對應 review。
- 交付限制：未 stage／commit／push／部署、未發真實訊息；未查正式第 9 筆身分。超過 10 筆仍保留摘要餘數。後續若授權發布，須重新核對最新正式來源及正確帳號，不可直接盲推整個工作區。

## 使用者授權部署後的驗收界線

- 已核對 LINE token 僅存 Script Properties，本專案沒有既有 LINE validate 入口或本機 token 索引；不讀其他專案 token、不新增臨時遠端橋接。官方 LINE validate 與原生 LINE 版面列為未測，不影響以正式來源、版本／設定與 health 核對本輪純顯示上限修正。

## 2026-11-05 Claude 接手結案

- 使用者於 17:15 要求交給 Claude。Claude 核對：兩個固定部署為 v139，工作目錄 LineNotify.gs 與不可變 v139 逐位元相同，異常鎖定修正的 Main、Submission、Templates 仍與 main 相同；全部 24 支離線測試通過。
- 修改與回歸測試已提交為 0cf5805 並推上 origin/main（作者 ISHA-TAICHUNG，SSH），本任務與審閱紀錄一併入庫。
- 未測：LINE 官方 validate、原生 LINE 版面、自然排程。下一次主管待簽核提醒由主管在 LINE 目視確認；未發真實訊息。
- 未處理：系統暫存發布目錄含 Config 私有副本，權限 0700，保留待使用者決定清理。
