# 課表字詞使用者定義套用

- task_slug: venue-keyword-clarifications-20261104
- 目標／驗收：套用本聊天9則註解；維持115／116年度對應，按當次最新課表判斷機具關鍵字；排除確認不操作與只占空間的內容；移除已釐清內容的待確認標記，測試、獨立Codex審閱、正式隔離部署及讀回。
- writer: /root；reviewer: /root/venue_reader。
- lease_status: CLOSED
- allowed_paths: apps-script/Calendar.gs、Calendar.js、scripts/test-venue-year-rollover.js、docs/venue-year-rollover-20261104.md、本檔及對應review；必要時在系統暫存產生受原有admin驗證保護的唯讀preview橋接，正式最終仍只Calendar差異。
- forbidden_actions: 不使用Claude CLI／舊AGENT_LOG；不改Main／Config另一任務本機修改；不改原課表、設備清單、通知對象、觸發器、權限；不發測試通知，不新增機具／表單；不Git push。
- 基線：前輪正式v128已驗證；Calendar本機.gs/.js可讀；無CodeGraph索引；完整git狀態以bounded read核對，不假定全庫clean。
- 規則：吊→移動式，堆→堆高機；固／地面／機上→固定式；預／暫與期別／數字不影響；每天讀最新課表；考職安乙不能考即測不操作；待考區／挖掘擬真只占空間。未回答的混合活動、工程與格式規則維持現況；不推定「高機」單獨代表哪類。
- 已確認：使用者回覆「只排除該格，其他欄照常判斷」；不擴張為整日停用。
- 驗證：詞彙正反例、同日另一欄／來源、跨請求滾動更新、跨年／多欄既有測試；project-health／提醒與收件政策回歸；正式HEAD／不可變版本／既有入口／26其他模組及唯讀preview讀回。
- 回復／停止：測試與審閱通過前不發布；遠端有未核對差異不覆寫；臨時橋接必於finally移除；不明語意保留原文。

## 發布基線補充

- 最新settings-read-snapshot任務已完成正式v129，兩個既有固定入口同版；本輪以重新讀取的v129為實際原版，保留Config／Main／Reminder效能更新。
- Calendar仍為已驗證的v128模組；只替換Calendar。兩個同版WebApp入口必須與handoff預期數量一致，逐個不可變版全模組與HEAD核對，若另有同版測試入口則停止。
- 發布前重新比對HEAD及每個固定deploymentConfig／entryPoints，正式後逐入口做版本、health與臨時action拒絕讀回，不更動本機其他任務檔。

## 完成

- 新模組版號`2026-11-04.2`；27組課表／年度測試、17項project-health、提醒runtime與8項收件政策測試通過，.gs/.js相同，目標git diff --check通過。
- 獨立Codex來源／測試／唯讀preview及部署方案審閱PASS；高機在獨立高空頁的一致性防護及固定部署漂移核對均已補正。
- 暫時v130僅增加受原有admin驗證保護的唯讀preview；15個正式案例全過。
- 最終 **v131**，以正式v129為原版，只有Calendar變、Main完全還原，其餘26模組相同；保留Config／Main／Reminder效能改善。
- 兩個固定入口均回讀v131，entryPoints／權限不變，逐網址health與臨時action拒絕通過；finalNetworkVerified=true。
- 本輪不寫任何資料庫、不更改原課表、不發通知或建立填報；確認詞與剩餘未定義項目已更新docs/venue-year-rollover-20261104.md。
- 本機其他任務dirty檔保留，本輪未stage／commit／push。程式與部署無待辦；剩餘高機單詞、混合活動及工程／格式規則維持原邊界。
