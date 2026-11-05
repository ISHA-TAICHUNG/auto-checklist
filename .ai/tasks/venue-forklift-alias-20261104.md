# 高機別名確認

- task_slug: venue-forklift-alias-20261104
- 目標／驗收：依使用者本聊天最新註解，將「高機」按堆高機辨識、取消該詞疑義；原文不改，高空車不誤判，非操作／占空間優先規則保留；測試、隔離部署及讀回。
- writer: /root；reviewer: /root/venue_reader；lease_status: CLOSED
- allowed_paths: apps-script/Calendar.gs、Calendar.js、scripts/test-venue-year-rollover.js、docs/venue-year-rollover-20261104.md、本檔與對應review；系統暫存中的受原admin驗證保護唯讀部署預覽。
- forbidden_actions: 不改原課表或DB、不發通知、不改其他任務Main／Config／Reminder本機檔、不動權限或觸發器、不Git push、不使用Claude CLI或舊日誌。
- 基線：前輪v131／Calendar 2026-11-04.2；本輪直接讀取相關原始碼，專案無CodeGraph索引；Git既有dirty狀態保留。
- 實作：僅堆高機類別的必要關鍵字比對額外接受高機正規化；保留原始字詞自訂匹配，matchedMachineKeywords納入高機；不新增提醒設備或表單。
- 必跑驗證：高機正反例、非操作／占空間／假日優先、高空對照、現有年度／多欄測試、project-health／Reminder回歸；正式兩入口版本／27模組／唯讀案例讀回。
- 停止與回復：審閱／測試未過不得發布；遠端基線／固定入口漂移停止；臨時Main於finally還原，最終只有Calendar差異。

## 完成證據

- Calendar模組`2026-11-04.3`，.gs/.js同sha256 98d3b552b007997af3e779d586f96a89d712cc74f626f3648da687d0462cbc5a。
- 30組課表／年度、17項project-health、提醒runtime與8項收件政策測試通過；原文／自訂詞／雙類混合／非操作優先均驗證。
- 獨立Codex來源、測試與部署小改審閱PASS。正式6個preview通過，特別驗高機來源格used:true，而非其他格撐起overall。
- 暫時v132；最終v133。最終固定部署GET短暫回讀不符，重新唯讀核對後兩入口均133，未盲目重送PUT。
- HEAD及不可變版全27模組符合預期；只有Calendar變，Main還原及其餘26模組保留；兩URL health與臨時action拒絕通過。
- 不寫DB、不改課表、不發通知；規則紀錄U07已確認。其他任務dirty內容保留，未stage／commit／push。
