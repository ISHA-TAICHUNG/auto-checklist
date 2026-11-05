# 116 年場地表相容性唯讀核對

- task_slug: venue-116-readonly-20261104
- 目標／驗收：核對年度切換、分頁與內容判斷，回答新增 116 年表能否銜接及辨識限制；以目前來源和指定試算表唯讀證據為準。
- writer: /root（僅本任務紀錄）；reviewer: /root/venue_reader
- lease_status: CLOSED
- allowed_paths: 本檔；reviewer 只能讀取 apps-script/Calendar.gs、Config.gs、Reminder.gs、DailyPpeAssignment.gs 及相對應 .js。
- forbidden_actions: 修改產品程式、試算表、設定、部署、觸發提醒、傳送訊息、下載、使用 Claude CLI；不讀寫舊 AGENT_LOG。
- 驗證：唯讀原始碼比對、Google Sheets 有界範圍讀取；可在記憶體模擬 Calendar.gs，禁止外部寫入。
- 初始狀態：專案無 .codegraph 索引；git status 已啟動但讀取尚未返回，故不假定工作目錄乾淨。
- stop_condition: reviewer 回傳來源行號及限制後停止；/root 整合回覆，不自動修改或部署。

## 完成證據

- reviewer /root/venue_reader：PASS；確認單一來源、只比月日、只取第一內容欄、精確名稱或 gid、假日優先及 DB 覆寫規則。
- 2026-11-04 唯讀取得 116 年三個分頁 A1:BX48／A1:Z48／A1:AA48，並取得本專案資料庫設定與設備分頁欄；設定仍指向標題為 115-術科V1 的來源。
- 高空車兩筆設備使用舊年度 gid，新表 gid 已不同；綜合分頁 5/18 有高空車，獨立高空分頁同日空白。
- 使用實際 Calendar.gs 在記憶體跑 8 個範例；會議與總在固定式預設判有使用、混合連假判不使用、否定備註未理解、多欄後段不讀、年份不比對。
- 公開 equipments API 可讀，回傳 14 筆啟用設備；不暴露場地分頁。資料庫 webAppUrl 與本機前端 endpoint 不同，因此未宣稱已核驗正式部署內部設定／程式版本。
- 無產品程式／試算表／設定／部署／通知變更；僅建立本任務與 review 紀錄。完整 git status 未完成，不推定 clean。
