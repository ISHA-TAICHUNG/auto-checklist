# ISHA 全專案健檢修復

- task_slug: project-health-20260908
- writer: Codex 主代理（GPT-6）
- reviewer: 獨立 Codex 唯讀 reviewers
- lease_status: CLOSED
- 目標：查明線上排程、通知權限、填表／異常／簽核／中控台問題，局部修復並提交部署驗證。
- allowed_paths: apps-script/*.gs、必要 HTML/JS、scripts/test-*.js、README.md、此次 output 健檢報告。
- forbidden_actions: Claude CLI、發送 LINE/Email、建立或更改業務紀錄、改密鑰、清理既有 untracked、改其他專案。
- 驗證：專案 scripts/test-*.js、mirror check/sync、JavaScript syntax、Cloud Run npm test/audit、diff check、secrets scan、正式唯讀 API 與觸發器／部署版本。
- Reviewer 只讀，不執行正式 job、不登入或印出 secrets、不修改產品檔、不提交部署；回覆 PASS/REVISE 並附可重現證據與 file:line。
- stop_condition: 主代理完成修正、審閱及既有正式 deployment 更新、讀回驗證後 CLOSED；正式帳號必須 isha263。

## 2026-09-08 最終複審檢查點
### 完成：使用者本人授權後正式部署及無發送驗收通過
- commit bc31763已推送；建立版本120，官方原v119及legacy原v84兩個既有deployment均更新為120，URL不变。
- 原生協會編輯器紀錄11:26:48 installDailyReminderTrigger成功；受admin保護installer完成PPE。正式systemStatus僅dailyReminderJob_、dailyPpeAssignmentJob_各1，時區Asia/Taipei、archive/venue健康正常。
- dailyRecipientPreview即時讀正式Sheet成功，targetCount4；主專案身分驗證true。
- reminderStatus dryRun14項無error，PPE dryRun亦ok；daily/PPE lastDryRun均completed且failedCount0。lastRun仍null、deliveryAudit0，沒有建立虛假正式發送證據。
- LINE用量前後皆used41／remaining159；兩網址health200、未授權admin查詢均拒絕。版本120的27個非Config／manifest檔與本機逐位元一致。
- 兩個計時觸發器已重建；每日9點附近、防護具17點nearMinute15。Google計時不保證整點。下一次自然發送才會產生正式lastRun及投遞稽核，9/7歷史實際根因仍不可憑目前修復倒推。
- 無測試LINE/Email、無業務資料寫入、無新增密鑰；原untracked未提交。部署驗收完成，本task CLOSED，不建立額外自動通知。

### 以下為歷程（以本段完成狀態為準）
### 最新：10:47 程式已推送，等待本人驗證才能完成正式部署
- commit/main push: bc31763，27檔；clasp isha263 push 29檔到HEAD成功。固定deployments仍v119/v84，未更新。
- Pascal 與 Chandrasekhar 均重新完成最終唯讀複審PASS，P0/P1/P2=0（各自分工）；不是前輪usage limit結果。
- 日檢獨立fresh嚴格雙「是」名單、ID/欄位衝突failclosed、hash稽核20筆、受保護preview；5xx/timeout unknown不改寄。12支回歸全過，health17組、recipient8組；staged gitleaks無finding、syntax/mirror/diff-check通過。
- 所有原有untracked保留未stage；目前tracked乾淨，Pages index/dashboard/dashboard.js已HTTP200逐位元吻合（signature.js查核完成見工具結果）。
- Chrome原生協會視窗選定 installDailyReminderTrigger 後審查權限，Google停在正確帳號passkey本人驗證。不得代做本人驗證或繞過；等使用者完成。
- 初次定位編輯器遇所選dailyReminderJob的授權提示，已取消，未核准該次執行；之後明確改選installer才要求授權。未發測試通知。
- 接續：驗證Google授權→完成兩個installer（只安裝不跑job）→同一新version更新官方與legacy既有deployment→讀回private trigger各1／recipientPreview4／API與quota；不宣稱自然排程已驗收。

### 較早檢查點（已被上述提交與複審進度更新）
- 使用者確認至少林X男、曾X鈞、黃X涓及其餘同仁均收到9/7通知；視為誤發回報，不以目前四人設定否定。尚無逐人推播回條，不聲稱已證明特定路徑／歷史收件人數。
- 為核對三人列值，使用現有OAuth唯讀Sheets API遭403（clasp OAuth所屬Google專案未啟用Sheets API）；沒有新增OAuth scope或啟用外部專案API。subscriberStatus會經setupSubscriberSheet_而非純讀，未以該入口代查以免更動名單結構。
- 使用者追加截圖可讀日期1150907、上午9:37、高空工作車兩台（車載式／自走式）；與已查9/7 09:37提醒執行時間及類別吻合。此圖尚未顯示收件帳號身分，不能單憑截圖推得全16人或指定唯一執行來源。
- 追加9/7高空工作車誤發唯讀查核：current lineNotificationTargetStatus為訂閱16／日檢未填4；舊帳號同名API專案觸發器0，執行頁過去7天僅9/2四筆doGet，未見9/7通知job。不能宣稱舊帳號重疊為已證實根因。
- 直接Script API比對v84與v119：v84 sendReminder_漏傳notificationColumn會走全體訂閱，v119已有預設日檢分類防線；尚無昨日recipient明細證實實際使用哪條路徑。processes API兩帳號均403 insufficient scopes，改用舊帳號UI唯讀核實；未擴OAuth權限。
- 尚未 stage、commit、push、clasp push 或變更 deployment，正式仍為 v119。
- 兩位獨立 Codex reviewer 最終回合均因 usage limit 結束，不能視為 PASS；停止部署，保留本機修正。
- 目前 25 個 tracked 修改及新增 scripts/test-project-health.js；其餘 untracked 不得加入。
- 回歸 11/11、公文監測 4/4、npm audit 0、diff check、鏡像一致性及本輪 24 個語法單元通過。
- gitleaks stdin 掃描目前 tracked 文字與新增測試約 1.37 MB，無 findings；歷史另有 2 筆舊憑證 findings，不代表 Git 歷史已清除。
- 正式 dailyReminderTriggerStatus 回傳 count=1、handler=dailyReminderJob；帳號驗證正確。不代表今天寄送成功。
- 下一步：獨立複審最終 diff，特別是 owner-only RPC wrappers、userinfo.email scope、私有 trigger handler 遷移、異常建立 retry；通過後再精確提交部署。
- 部署需更新既有正式及 legacy v84 endpoint 到同一安全版本，並在正確帳號編輯器重建兩個提醒觸發器；不執行真正通知 job。
