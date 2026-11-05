# 月檢統計先篩選相關紀錄

- task_slug: monthly-status-filter-order-20261104
- writer: Codex本對話；reviewer: Codex settings_reviewer；lease_status: CLOSED（使用者登入後完成v136原生量測與freshness核對）
- 目標：LINE狀態v135仍超過35秒，消除月檢統計對非每月／非本類別紀錄重複解析月份的計算熱點。
- allowed_paths: apps-script/MonthlySafetyPpe.gs、MonthlySafetyPpe.js、scripts/test-monthly-status-filter-order.js；本檔與對應review；root唯一writer。
- forbidden_actions: 不改Calendar／Config／Main／Reminder／LineWebhook／Templates，不寫正式填報、課表或DB，不發正式通知，不變更觸發器／權限，不Claude CLI或舊日誌，不覆蓋他人dirty。
- 基線：兩入口v135；Github 63312914a10d4fe420102e3caefc22708a21da17。前輪task均CLOSED。沒有CodeGraph索引，已精讀目標函式與直接月份helper。
- 最小方案：monthlyCompletionFromRows_只改同if三條件順序，先用原String(...||'').trim()排除非每月／其他類別，再用原helper判定月份；loop、schema驗證、targetMonth、批准證據、早退與pendingStatus順序均保留。沒有新快取。
- 行為邊界：正常Sheets值及有效時區下輸出相同。極端情形下，不相關列的獨立月份Date不再呼叫格式化服務；該列原本可能因瞬時格式化例外讓整次查詢失敗，現在跳過該不相關列。相關月檢列、欄位缺漏、查詢日期及試算表讀取失敗仍走原查核；不把真正讀取失敗當空資料。
- 驗證：正式候選直接載入原source；baseline僅記憶體還原舊順序。900日檢＋100月檢／5類／3月份fixture對照真實job與狀態summary；月份解析15000→300，JSON一致；既有17月檢政策與通知、全回歸／獨立review，再隔離發布及原生LINE實測。
- 回復：新鮮HEAD與版本備份，只換MonthlySafetyPpe，其餘26模組逐位元保留；部署漂移先查明。

- 正式新測試先RED（candidate15000次）再GREEN（300次），格式化21791→341，完整狀態JSON與摘要逐字相同；六個必要欄位缺失及相關月檢月份／日期處理通過。產品只有同if兩行移序，.js先核對v135基線再同步。
- 工作區22支／公開候選21支測試與同步全PASS；獨立Codex審閱PASS，3種mutation被拒絕、相關列格式化及實際IO故障仍失敗。發布前已抓新鮮v135，候選僅MonthlySafetyPpe差異。

## 發布與最後驗證

- 兩固定入口均v136，更新ACK、直接部署GET、不可變版本與HEAD全27模組、health均核對通過；只換MonthlySafetyPpe，26模組逐位元保留，原URL／權限／執行設定保留。
- 公開來源commit：2953e0e4d18df85b471d13b8bdd2fffd9fdb7962，僅MonthlySafetyPpe.gs與新測試；本機Git index／refs不移動。
- v136發布後網頁表單可填時間：[{"page": "daily", "readySeconds": 4.613, "pageErrors": []}, {"page": "daily", "readySeconds": 4.065, "pageErrors": []}, {"page": "monthly", "readySeconds": 4.669, "pageErrors": []}]。未實際提交正式紀錄，故不將此秒數當作送出／PDF／Drive完成時間。
- 原生LINE最後驗證前出現「已自動登出，請重新登入」，未嘗試登入／索取密碼／掃QR；已請使用者自行登入後回覆。最新版LINE速度尚未量測，不可用synthetic解析次數換算，不能拿舊v134的28秒或v135>35秒當最新秒數。
- 剩餘一步：使用者登入後fresh確認專案Bot與空草稿，只送私人幫助／狀態、記錄實際回覆並對照5項待確認；完成後CLOSED。不觸發填報／簽核／群發。
- 私有檢查點：系統暫存isha-monthly-filter-20261104-_wh2m9xo/final-checkpoint.json；完整HEAD／candidate含Config實際秘密，維持0700目錄及0600檔案，不公開。

## 登入後完成原生驗證

- 使用者已自行登入，fresh確認私人ISHA通知小幫手及空白輸入欄；僅送幫助／狀態，未操作正式填報、簽核或通知。
- 重新讀取兩固定部署：均v136；對不可變版本逐位元核對MonthlySafetyPpe、LineWebhook、Reminder三模組與已審測候選完全一致。
- 原生LINE幫助：4.166秒首見完整回覆。填表狀態兩筆：14.780秒、18.020秒首見完整狀態卡；自Return起連續截圖，以可見回覆確認，不把圖片大小變化本身當作成功。此為小樣本近似觀察值，非固定SLA。
- 其中一次嘗試沒有確認訊息真正送出，未計入延遲；重新確認草稿「狀態」及送出綠色泡泡後取得第二筆18.020秒，不能把未送出時的35秒當成正式後端變慢。
- 狀態更新符合現況：高空工作車日檢已1/1、待確認由先前5變4；不能硬套舊的5項快照。兩次最新卡片均4項，未見錯誤卡。
- 網頁維持前次v136實測日檢4.613／4.065秒、月檢4.669秒（表單可填）；未把該數字當送出／PDF／Drive耗時。
- 結論：目前web約4～5秒、LINE幫助約4秒、狀態約15～18秒；相較前面28秒與另次>35秒有改善，狀態仍有等待，不宣稱即時、不宣稱所有LINE命令已逐一實測。
- 本輪程式／發布／測試／原生量測已完成，不再持有writer或共用部署lease；不續發其他變更。
