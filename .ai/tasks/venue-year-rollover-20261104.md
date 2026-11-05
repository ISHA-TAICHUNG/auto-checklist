# 115／116 年場地表銜接與部署

- task_slug: venue-year-rollover-20261104
- 目標／驗收：依檢查日期選用年度來源；穩定分頁名稱；讀取同月多場地欄；高空車跨已知來源補讀；保留不明字詞待使用者定義；完成測試、獨立 Codex 審閱及授權範圍內部署與讀回。
- writer: /root；reviewer: /root/venue_reader；deployment_explorer: /root/venue_deploy_route。
- lease_status: CLOSED
- allowed_paths: apps-script/Calendar.gs、apps-script/Calendar.js、scripts/test-venue-year-rollover.js、scripts/test-project-health.js 中既有場地讀取 fixture、 本檔、對應 review 紀錄、docs/venue-year-rollover-20261104.md；正式資料庫僅年度來源與場地分頁對應之必要設定。
- forbidden_actions: 不改另一任務 Config/Main 未發布工作；不使用 Claude CLI；不讀寫舊 AGENT_LOG；不 Git push；不改課表內容；不發測試 LINE／Email、不改通知對象／觸發器／權限；不把不明簡寫猜成已確認業務規則。
- 基線：Calendar 原始碼已讀；無 .codegraph 索引；完整 Git 狀態另以 bounded read 查核，若 iCloud 阻塞不推定 clean。既有 settings-read-snapshot 任務局部未發布，部署須避免納入該差異。
- 必跑驗證：node scripts/test-venue-year-rollover.js；可用的日提醒／防護具回歸；來源與部署內容差異核對；跨年 12/31、1/1 與後段場地／高空補讀案例；正式唯讀診斷回讀。
- 資料權威：Google Sheets；每次請求依日期讀取年度來源；年度缺失或分頁／日期讀取錯誤不可當成無使用。
- 回復：保留現行部署版本與設定原值；部署只替換經審閱的 Calendar 模組，其餘遠端現行模組逐位元保留。
- stop_condition: 測試或 review 未過不得發布；無既有正確 Google 帳號授權不得部署；部署後讀回不符則回復並回報具體阻礙。

## 部署方式補充

- 已以指定帳號既有 OAuth 刷新後 live userinfo 核對；Apps Script API 可讀，HEAD 與目前前端固定 v124 全 27 檔相符。
- Sheets API 在既有 OAuth client 專案停用；不啟用 API、不改 IAM、不新增登入。Drive connector 不是部署帳號，僅用於唯讀核對。
- 採短暫且受原有 ADMIN_TOKEN 驗證保護的遠端 Main 管理入口：只套本次兩個年度設定與兩筆高空分頁、唯讀 preview；設定／驗證後還原原始 Main，最終版本僅 Calendar 改變。本機 dirty Main／Config 不修改。
- 暫時入口與私有原始碼基準保存在權限 0700／0600 的系統暫存目錄，僅 root 使用；不輸出憑證、私人 URL 或完整來源內容。

## 執行檢查點

- 遠端 Config 已核對正式DB身分，與早期Drive搜尋同名舊DB不同；本次所有寫入均由正式後端使用指定部署帳號執行，舊DB未寫入。
- 第一輪暫時v125：設定apply／status成功，前三個正式preview成功；後續遇到固定URL舊實例回應未知action，finally回復原Main／Calendar，v126讀回與原27模組基線一致。
- 年度設定為加法更新、高空分頁名稱向前相容，保留於正式DB；重跑apply已有idempotent與部分寫入復原測試。
- 第二輪以正式v126重新取得基線；只對尚未dispatch的未知action增加nonce與有界重試，未對不明寫入結果盲目重送。

## 完成

- 第二輪暫時v127，正式7個指定日期preview全過；最終發布 **v128**，Calendar版號`2026-11-04.1`。
- 年度設定status確認115／116兩鍵、補充來源啟用、兩筆高空分頁為穩定名稱；課表內容未改動。
- 最後網路讀回：HEAD與不可變v128皆符合預期；只有Calendar與原基線不同，Main完整還原、其餘26模組相同；固定入口及權限不變，臨時管理action已實際回應未知action（拒絕），health通過。
- 獨立Codex reviewer最終重新計算模組雜湊：PASS；來源／測試及部署狀態均核對。
- 18組課表測試、17項project-health、提醒runtime／收件政策與設定快照回歸通過；臨時遷移6組mock通過。沒有發送測試通知或新增正式填報。
- 待使用者回覆的11組字詞及位置：docs/venue-year-rollover-20261104.md（U01–U11）。無待發布程式工作。
- Git狀態／限縮diff仍受iCloud讀取逾時，未commit／push；其他任務Main／Config未發布內容保留。
