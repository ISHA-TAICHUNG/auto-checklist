# 單次操作的系統設定讀取優化

- 目標：減少同一次網頁查詢、檢點表送出及 LINE webhook 的重複 Sheets 讀取。
- writer: Codex 本對話（settings-read-snapshot-20261104）；reviewer: 獨立 Codex settings_reviewer；lease_status: CLOSED（已發布，正式回讀、瀏覽器量測與獨立發布驗收均完成）。
- 負責：本對話是唯一產品 writer；reviewer 僅可讀產品與測試，並寫入 .ai/reviews/settings-read-snapshot-20261104.md；不讀寫舊 AGENT_LOG。
- allowed_paths：Config.gs、Main.gs、Reminder.gs 與對應本機 .js；js/api.js、daily.html、monthly.html 的效能與安全載入；scripts/test-settings-read-snapshot.js、scripts/test-reminder-read-context.js；一併發布既有 test-api-client-auth.js、test-main-auth-routing.js、test-checklist-loading.js 的 bootstrap 測試；本檔與指定審閱紀錄。禁止修改 Calendar、場地設定與他任務 fixture。
- 相容性：保留 API、回傳格式、票證驗證、填報／文件／歸檔／通知的先後順序。
- 資料權威：Google Sheets；暫存僅限同步函式作用域，結束或拋錯即清除，不寫入 CacheService。
- 排除：管理操作、提醒排程與直接執行函式維持原本讀取；不快取人員權限、填報、異常與簽核狀態。
- 基線：Config.gs、Main.gs 的工作目錄內容與 Git index blob 相符；完整 git status 受其他 iCloud 未下載檔案阻塞，不假定整個專案乾淨。
- 驗證：設定預設值與錯誤相容性、20 次查詢的讀取次數、跨請求更新、巢狀／拋錯清理、授權拒絕、管理讀後寫後讀；執行可用的既有驗證及 .gs/.js 同步檢查。
- 回復：還原本次兩個來源函式範圍及其 .js 對應變更，不動其他工作；正式版本若發布則保留上一部署供回復。
- 停止條件：功能回歸、原始碼／本機部署副本差異未釐清或無法保留本機 Config 的正式設定時停止該步。
- 發布授權：使用者於本對話明確回覆「交給你全權處理」，涵蓋必要下載、回歸、此項效能調整的正式發布與驗證；不擴張為資料庫遷移或通知對象變更。
- 最終狀態：後端正式 v129、前台資產 2026110401 與 GitHub commit 306bb3271757a55e544e074b1cfc31826338809b 均已發布並讀回；本機19個、獨立GitHub候選18個測試程式皆通過。下方保留各階段檢查點，不能將早期未完成狀態當成目前狀態。

## 首輪待授權前的驗證與限制（歷史檢查點）

- 調整前特徵測試：20 次設定查詢觸發 20 次 Sheets 讀取；原本預設值、重複鍵、讀取失敗行為通過。
- 調整後 `node scripts/test-settings-read-snapshot.js` 通過：20 次查詢只讀一次，跨請求更新、讀取失敗後重試、巢狀／拋錯清理、日期隔離、預設值物件身分、資料庫身分切換、GET／送出／LINE 路由、票證與 webhook 憑證拒絕、管理即時讀取及舊版 Config 相容性。
- Config.gs、Main.gs 的修改前內容已由重建基線的 Git blob 雜湊核對 index，目標範圍沒有吸收先前未提交修改；差異格式檢查通過。完整 status／一般 diff 因其他未下載物件阻塞，未宣稱專案整體乾淨。
- Config.gs／Config.js 本次函式內容一致，未輸出正式設定；尚不可通過完整 .gs／.js 同步門檻。
- 既有 `test-checklist-loading.js` 因沒有可用 Playwright 而跳過，不能計為通過。其他既有驗證因檔案讀取未完成，尚未取得結果。
- 沒有進行正式表單寫入、PDF／Drive／LINE 實測、部署、Git push 或 Cloudflare 建置；不把讀取次數改善換算成線上秒數。

## 共用呼叫端的前後狀態

| 呼叫端 | 調整前 | 調整後 | 證據／限制 |
| --- | --- | --- | --- |
| 一般 GET 網頁查詢 | 每次 getSetting 重讀 | 單次請求重用，下一請求重新讀取 | 路由模擬與設定更新測試；未上線 |
| 檢點表送出 | 同一送出重複讀設定 | 票證驗證後才進入設定作用域 | 票證拒絕／跨送出測試；PDF、歸檔、紀錄及通知函式與順序原樣保留，未做外部寫入測試 |
| LINE webhook | 同一 webhook 重複讀設定 | webhook 憑證驗證後才進入作用域 | 正反向路由模擬；未發送 LINE 訊息，尚未量測實際回覆 |
| GET 管理／POST 管理操作 | 修改後立即重新讀取 | 同原行為，不啟用作用域 | 管理讀後寫後讀測試 |
| 其他 POST、排程與直接執行函式 | 即時讀取設定 | 維持即時讀取 | 未包入作用域；直接讀取特徵測試通過，既有排程整合測試未完成 |

## 後續界線

1. 等 Main.js 與既有測試可讀後，先核對舊 Main.js 與修改前來源的一致性，再同步本次差異。
2. 完成既有驗證與 .gs／.js 同步門檻後，才能準備正式部署；不得覆寫尚未核對的本機部署副本。
3. 上線後另量測 GET、送出及 LINE；本輪不進行資料庫遷移、背景任務改寫或前台搬遷。

## 2026-11-04 接續執行與共用部署邊界

- 已用系統下載 API 取得必要程式；Main.js 修改前內容與來源基線一致，已同步本次差異；完整 Apps Script .gs/.js 同步檢查通過（Config 正式設定獨立保留）。
- 已驗證 clasp 命名帳號 isha263 為專案指定 Google 帳號，兩份 clasp 設定與 runtime PRIMARY_SCRIPT_ID 同指正式專案；預設 clasp 帳號不同，所有發布操作必須明確帶 isha263。
- 已保存雲端 HEAD、前台正式 v124、部署清單與設定備份至權限 0700／0600 的暫存目錄；HEAD 與 v124 相同。
- 雲端 Main 尚缺本機已提交的 checklistBootstrap／getPublicFormMeta_；前台實測會先得到未知 api，再走 meta＋lockedItems。此相容性缺口納入本輪審閱與發布，須確認鎖定資料仍即時讀取、送出仍重新讀最新模板。
- health 新增非破壞性 build 欄位，作為正式版本讀回證據；既有 version=1.0 保留。
- 已發現另有 ACTIVE 的 venue-year-rollover-20261104，擁有 Calendar 及 project-health 場地 fixture；本對話不得修改、提交或發佈該未完成工作。
- 禁止從共享工作目錄整包 clasp push；發布必須從最新雲端內容建立受限暫存套件，只替換已審閱的 Config、Main，其餘雲端模組逐位元保留。等待場地任務的部署 lease 釋放，並在發布前重新比對遠端版本與來源。
- 其餘既有測試多數已通過；五個 iCloud 延遲測試已從 GitHub 取得與本機 index blob 完全相同的來源，於暫存來源執行，未覆寫尚未讀取的檔案。project-health 的場地 fixture 與另一任務新 Calendar 不符，交由該任務所有者處理；本輪不修改 Calendar／fixture。
- reviewer 必須依實際 Config／Main 差異與測試回覆 PASS 或 REVISE，列必要行號及風險；未 PASS 不發布。

## 正式前台核對與範圍收斂

- GitHub main 為 5a4f8f5f9ca2a806e3738c24d21960296d35544f。實際瀏覽器確認正式日檢頁仍呼叫 meta、lockedItems，並未呼叫 bootstrap；第一次實測可填約 6.326 秒，無 page error。
- 更正先前僅依本機來源的推論：本機前後台已有未發布 bootstrap，正式前後台都仍為舊版；不能將目前延遲歸因為正式前台已發出失敗的 bootstrap 請求。
- 本輪需將已存在且測試完成的 js/api.js、daily.html、monthly.html 小範圍差異一併發佈，採合併查詢、讀取失敗停止填報、明確重試與 15 秒讀取上限；api.js 資產版本升為 2026110401。
- 正式 backend 的 meta 將使用 60 秒公開模板快取；異常鎖定每次即時查詢，送出仍在鎖內讀最新模板。最終回覆須說明模板變更可能最多延遲 60 秒反映。
- 純 Config／Main 與凍結雲端其他模組的候選版本，17 組 project-health 故障注入已通過；日／月檢瀏覽器失敗重試及異常鎖定測試在本機完整暫存 bundle 通過。
- 另一任務新增 Calendar 單次 context 後，Reminder 若未傳 context 仍逐設備直讀設定；獨立 reviewer 已以真實呼叫鏈確認 6 台：設定讀 6→1、場地 open 6→1、月份 Range 12→2，狀態內容相同。將建立單獨的 Reminder context 小修正及正式測試，再送同一 reviewer 審查。
- Calendar 所有權及遠端發佈時序仍尊重場地任務；本輪候選套件更新範圍調整為已核准的 Config、Main、Reminder，其他模組取最新雲端且逐位元保留。
- Reminder 兩行正式實作及 .js 副本已完成；scripts/test-reminder-read-context.js 直接測候選 Reminder，fixture 自包含，不依賴他任務未發布測試。讀取計數、下一操作更新、讀取失敗／復原、類別隔離、dry-run 及正式通知 stub 去重皆通過。
- 已執行並通過現行 17 組 project-health、18 組場地相容性、提醒 runtime／recipient、main routing、API client、settings snapshot 與 .gs/.js 同步檢查；正式資料、Email／LINE 尚無測試寫入或發送。
- 最終離線全套：19 個 test-*.js 全數 exit 0、無跳過，包括日／月檢真實 Chrome 瀏覽器測試；結果另存於受限 release 暫存目錄。Calendar 相關來源若於發布前變更，需再針對最終雲端內容檢查相容性。
- 獨立 reviewer 對 Reminder 的正式兩行與整合測試補審 PASS；移除宣告、移除第三參數或移除兩行的 mutation 均能使正式測試失敗，未發現 P0/P1/P2。

## 最終發布與回讀

- 先等 venue-year-rollover-20261104 的 lease=CLOSED；重新取得最新雲端 v128，確認只有 Calendar 為該任務改動。
- 雲端本輪只改 Config、Main、Reminder；其餘24個模組與最新v128逐位元相同，正式Config的私密設定與其他函式保留。
- 第一輪部署更新後，清單回讀短暫保留舊版本，因此先依保存設定回復，逐一讀回原版本與HEAD確認；第二輪重用已核對的不可變v129，採更新確認值、個別部署GET、有界重試、health與重新取清單共同核對，最終兩個固定入口皆v129。
- 兩個固定入口的entryPoints完整物件與發布前相同，包含原網址、執行身分及存取設定；既有QR、LINE與簽核連結不需換址。
- health保留API version=1.0，build=2026-11-04-settings-read-snapshot；不可將API欄位誤當成部署版號。
- 使用既有專案GitHub帳號，以限定11檔建立commit 306bb3271757a55e544e074b1cfc31826338809b並非強制更新main；每個已提交blob均與測試候選核對相符。沒有提交Calendar、他任務fixture或任何正式Config.js。
- GitHub現行來源65個文字檔的候選快照，18個test程式全過；Pages build=built且commit一致。新Reminder測試在舊Calendar驗證呼叫端相容性，在新Calendar執行完整真實讀取計數，兩支路徑與缺漏mutation均獨立通過。
- GitHub發布透過repository API完成；本機Git refs與index未移動、他任務工作未stage或commit。後續Git同步須先讀本紀錄及共享工作目錄狀態，不得強推覆蓋遠端main。
- 獨立Codex發布後唯讀驗收PASS：正式health、14筆設備清單、日檢bootstrap schema及9項檢查、GitHub main／11檔範圍、Pages build、日月檢資產版本，三個前台來源在GitHub／公開Pages／本機逐位元一致。

## 正式瀏覽器與速度樣本

| 項目 | 發布前 | 發布後 | 界線 |
| --- | --- | --- | --- |
| 日檢頁可開始填寫 | 6.326秒（1次） | 4.761、3.148、3.496秒 | 正常Chrome，不含實際送出；本次樣本非長期平均 |
| 月檢頁可開始填寫 | 未量測 | 4.422秒 | 正式頁面及送出按鈕可見，無page error |
| 檢查表與異常鎖定的核心查詢 | meta＋lockedItems兩次 | checklistBootstrap一次 | 正式頁面網路請求確認；另外仍有branding與公開票證預載 |
| bootstrap API | 正式舊版未知api | 4.152、3.465、3.439秒，ok及schema通過 | GET唯讀；不能與舊版單支API直接當成端到端比較 |
| 六台同場地的設定／場地open／月份Range | 6／6／12 | 1／1／2 | 真實程式配離線fixture；不是LINE聊天室秒數 |

- 實際日／月檢頁均載入api.js?v=2026110401、只用合併核心查詢、無JavaScript錯誤；已保存畫面及受限機器可讀證據。
- 曾有自動化驗收在全站加Cache-Control請求標頭，導致Google端跨來源預檢拒絕；有／無該額外標頭的對照已確認是測試設定差異。一般瀏覽器通過，產品沒有因此被改動。

## 保留的行為與未實測項目

- 送出仍先驗證、製作文件／PDF、歸檔、寫紀錄與執行適用通知，成功後才回覆；未改為背景收件或提早宣稱PDF已完成。
- 異常鎖定每次重新查詢；模板／設備描述的公開快取最多約60秒，送出仍在鎖內檢查最新模板與異常。
- LINE通知對象、去重、簽核條件、排程及既有票證規則保留；Calendar年度功能保留，場地設定與正式填報資料未由本輪修改。
- 正式表單成功送出、PDF／Drive成品及LINE真人聊天室端到端回覆秒數，本輪沒有建立真實測試紀錄或發送訊息驗證；不可宣稱這些外部成果已實測。
- 本輪保留GitHub Pages，沒有更換平台、網址或新增付費服務。效能改善不等於Google後端與文件產製延遲歸零。
