# LINE 狀態日檢紀錄重複讀取

- task_slug: line-status-record-read-20261104
- writer: Codex本對話；reviewer: Codex settings_reviewer；lease_status: CLOSED（v135發布核對完成，LINE仍慢，月檢計算另立切片）
- 目標：實測狀態仍28秒，限定將同次LINE狀態查詢的日檢填報紀錄讀取共用，不跨操作，不改正式提醒或送出。
- allowed_paths: apps-script/Reminder.gs、Reminder.js、LineWebhook.gs、LineWebhook.js、scripts/test-line-status-record-read.js；本檔與對應review。只由writer改產品／正式測試。
- forbidden_actions: 不改Calendar／Config／Main／Templates／正式資料，不群發、不寫檢查表、不變更權限與觸發器，不Claude CLI／舊日誌，不覆蓋他人dirty。
- 基線：兩正式入口v134；Github ee12764584c29f4b5d1e1cdd800f293c97362382。前輪已CLOSED；其他部署task均CLOSED。專案無CodeGraph索引，精讀相關兩函式與直接呼叫。
- 成功標準：狀態卡片前後一致、每次指令fresh、讀取錯誤仍失敗且下次可復原；正式dryRun:false與其他getter呼叫預設不共用；跑正式入口整合fixture、既有回歸、獨立審閱、最新隔離部署與原生LINE量測。
- 邊界：只在cmdStatus傳明確選項，dailyReminderJob同時要求dryRun與選項才建立本地context。hasDailyRecordInCategory只共用成功且欄位通過的資料；缺表／空表／讀取失敗不保存。判定日期、類型與category原語意不變。
- 回復：發布前抓新鮮HEAD與部署，只換兩模組，其餘25逐位元保留；遠端漂移則停止，確定本輪狀態後才回復。

- 兩模組已實作：cmdStatus兩分支opt-in；dryRun且旗標true才建立本地context。成功表格通過原欄位驗證才共用，失敗／缺表／空表不保存；原日期／類別／表單型別判定及通知流程保留。
- 新測試先RED（7讀，預期1），實作後GREEN；真實cmdStatus與dailyReminderJob整合，結果JSON一致。跨指令增刪、一般dryRun與正式不快取、逐次直接getter、來源／欄位失敗復原、空表補列、日期／類別／DB隔離均通過。
- .js先與v134候選基線核對，再從本輪.gs同步；未改其他模組。

- reviewer發現P2測試接縫：原fixture只走metadata fallback，未能拒絕正式wrapper分支遺漏flag。補入真實Templates helper，並另驗fallback之計數、狀態與freshness；不改產品。
- 已補實際Templates wrapper載入；主測試走正式分支，fallback另驗7→1／卡片一致／下一指令更新，新測試GREEN。產品候選未變。
- 最終獨立審閱PASS，wrapper／fallback任一flag遺漏均被mutation測試拒絕；工作區21支測試與公開候選20支測試均通過，新增fixture補強後也再通過。

## 發布與量測

- 最新v134來源重新抓取，只改Reminder／LineWebhook，其餘25模組逐位元保留；兩固定入口v135、不可變來源、HEAD、health與原URL／權限均核對。
- LINE本次狀態35.003秒連續觀察仍無回覆，43.777秒下次觀察已顯示；精確延遲未知，不能把43.777當實際耗時。help4.361秒首見回覆。讀取去重並未把整體LINE狀態等待降到可接受。
- 後續另立月檢月份解析條件順序切片，先排除不相關日檢／類別，避免重複日期格式化。
- 公開來源commit：63312914a10d4fe420102e3caefc22708a21da17，僅Reminder.gs／LineWebhook.gs／新測試，本機index和refs保留。
