# 網頁送件分段計時（v145）

- task_slug: submission-timing-20261106
- writer: Claude（主 session）；reviewer: reviewer agent（獨立、只讀）
- lease_status: 量測中（v145 已上線，等 hao 照常送出檢查表後傳「送件計時」）
- 目標：先量出網頁送件各段秒數，再決定要不要優化、改哪一段。不建測試資料，不改前台。

## 背景

- 11/4 Codex 用私人副本實測（v136）：日檢 14.9 秒、月檢待簽核 12.8 秒、主管簽核歸檔 9.8 秒、同 ID 重送 7.1 秒；沒有分段。重送在產生 PDF 前就結束，推測一半時間花在 PDF 之前。
- 執行紀錄讀不到（預設 GCP 專案），比照「狀態計時」改由 LINE 讀回。
- 已知可疑點：`findRecordByClientId_`（Submission.gs）每次送件都讀整張填報紀錄（含完整資料JSON）只為比對一欄；實際佔比未量。

## 做法

- `doPost` 一開始記時間；預設分支（送件）建立 `createSubmissionTiming_`，標記收件與解析、操作票證，傳入 `handleSubmission_(payload, timing)`，成功後保存到 Script Property `SUBMISSION_TIMING_LAST_V1`；送件失敗不保存。
- `handleSubmission_` 分段：驗證與模板、等待鎖、重送檢查、鎖定項目、表單比對、產生PDF或文件、雲端硬碟、寫紀錄、異常追蹤、異常通報、主管通知；保存時再記收尾。
- 只存日期時間、日檢或月檢、處理方式（PDF／待簽核文件／重送）、是否含異常、資料量、各段毫秒數、合計；不存紀錄 ID、人名或內容。寫入失敗只記 Logger，不影響送件。
- LINE：訂閱者私訊「送件計時」回最後一筆；群組與非訂閱者被擋。只保存最後一筆，同時送件時後寫者勝，以回覆中的時間辨認。

## 發布

- 提交：`694c6d2`（程式）、`3ddb80f`（補測試）；分支 `feature/submission-timing`。
- v145（11/6 03:44）：受限套件只換 LineWebhook、Main、Submission；已確認 `aa51ed8` 與 v144 除 Config 與 manifest 外相同，HEAD 與 v145 都和套件逐位元相同。兩入口 build `2026-11-06-submission-timing`，表單 21/21、鎖定 0（2.87／4.15／5.38 秒）。
- 回滾：兩部署改回 v144；觸發器跑 HEAD，要再 push 舊內容才會退回。

## 讀數注意

- 合計從 `doPost` 開頭起算，不含網路、上傳與 Apps Script 啟動；網頁上感受到的時間會更長，差額是程式外開銷。
- 保存本身的寫入時間不在合計內。

## 未驗證

- 真實送件的分段數字、保存寫入耗時、LINE 回覆畫面；v145 上線後第一筆真實送件是否正常（11/6 10:30 排程核對會看首批送件）。
- 量完要移除計時程式與「送件計時」指令。
