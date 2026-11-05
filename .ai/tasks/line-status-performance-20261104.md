# LINE 填表狀態實際延遲追查

- task_slug: line-status-performance-20261104
- writer: Codex 本對話；reviewer: Codex settings_reviewer（本輪只可寫 .ai/reviews/line-status-performance-20261104.md）；lease_status: CLOSED（本輪發布與原生量測完成，28秒延遲另立後續最小切片）。
- 目標：在不改提醒／簽核規則、不跨操作保存填報狀態的條件下，消除 LINE 狀態查詢的重複讀取，完成離線回歸、獨立審閱、必要發布與私人Bot實測。
- allowed_paths: apps-script/Templates.gs、LineWebhook.gs 及對應.js；scripts/test-line-status-metadata-snapshot.js；本檔與 .ai/reviews/line-status-performance-20261104.md。產品與正式測試均由本對話唯一writer修改；reviewer僅可寫指定review檔；explorer只讀。
- forbidden_actions: 不改 Calendar／年度資料、不改通知對象與觸發時機、不新增正式填報、不發測試群發通知、不使用 Claude CLI、不讀寫舊 AGENT_LOG、不覆蓋其他工作。
- 現行基線：後端v129，GitHub main=306bb3271757a55e544e074b1cfc31826338809b；其他任務場地功能已CLOSED。
- 實際網頁重測：日檢5.080、4.026秒，月檢4.821秒，皆無page error。
- 私人Bot已確認為專案 ISHA 通知小幫手，來源為既有檢查表簽核卡與指令清單；只查詢幫助／狀態，不觸發填報或簽核。
- LINE幫助：送出後0.578秒尚無回覆，7.860秒時已看到回覆，僅能說7.9秒內已顯示，不能當精確反應時間。
- LINE填表狀態：連續畫面觀察22.005秒仍無回覆，後續85.317秒的觀察點已顯示；本次能確定超過22秒，無法依此聲稱精確耗時85秒。
- 成功標準：狀態輸出與既有規則相同，失敗不能當成已填／未使用；每次新查詢重新取狀態；通知／正式寫入路徑保留原本查核；需有實際LINE回覆觀察，不只讀取計數。
- 回復：發布前保留v129來源、部署與設定；只換已審查模組，其餘逐位元保留；回讀不符先回復。

## 唯讀追查結論

- 設備資料：日檢列表1＋逐設備14、PPE2（可能額外2）、月檢列表1＋逐設備14，來源呼叫推導合計32～34次全表讀；週期模板另3次。此為呼叫結構推導，不冒稱正式trace。
- 月檢已一次讀取recordData並跨月份共用，不能誤稱按月份重讀。日檢每個有使用設備仍讀整張填報紀錄；此輪先不擴張該路徑。
- 完整資料JSON已移除簽名與照片內容，不能將22秒逕自歸因為讀簽名影像。
- 最小方案：Templates提供兩個metadata表的同步作用域，僅LINE cmdStatus中的dailyReminderJob(dryRun)使用；成功原始列可重用，Date與列需複製，例外與巢狀清理，其他呼叫維持fresh。不得掛入泛用settings scope，避免送出鎖前／鎖內檢查被快取。
- 不刪除pendingApprovalReminderJob：雖成功結果不顯示，失敗與執行診斷仍是原行為，不能作為純效能改動移除。
- Apps Script processes API回403，無正式逐函式trace權限；不將不可得資訊當成0或正常，不新增授權範圍。

## 本輪修改與驗證

- Templates僅新增設備／模板兩表的同步metadata作用域；包住整段openById→sheet→values，原列解析器、active與重複ID語意保留；回傳列／Date複製，未命名表、讀取失敗、缺少／空模板不快取。
- LineWebhook只包住cmdStatus中的dailyReminderJob(dryRun)，其他LINE指令、送出、正式排程未開metadata scope；泛用settings scope完全未擴張。
- 正式新測試直接執行cmdStatus與dailyReminderJob，模擬兩輪各14設備及PPE讀取，設備32→1、模板3→1、開DB35→2，狀態輸出一致。
- 跨指令停用／改名／模板週期／主管profile更新，未開scope的鎖前／鎖內fresh邊界、正式排程fresh、日期與物件隔離、讀取失敗與scope清理、缺表與只有標題、重複ID／active同義值、跨DB、巢狀失敗及人員表不可快取皆通過。
- 新測試先在原始產品失敗（缺少scope），正式兩模組實作後通過；.gs/.js先核對遠端舊基線再同步，完整同步檢查通過。
- 既有17組project-health、8組收件政策、reminder runtime、LINE主管入口及前輪Reminder場地context測試均通過。
- 新的遠端基線實際為v131，來源Templates與LineWebhook仍與v129相同；Calendar／Main為另一任務接續發布或臨時預覽的變動，不能以舊v129整包覆蓋。
- 目前venue-forklift-alias-20261104仍持有共用遠端部署邊界，發布前須確認其CLOSED，重新抓最新HEAD／固定部署並只換本輪兩模組，保留其餘25模組。

- 全部20支正式測試通過，獨立Codex審閱PASS；venue-forklift-alias已CLOSED，最終v133。下一步重新抓最新正式來源，僅替換兩模組。

## 本輪發布與量測結果

- 最新v133來源重新備份；只替換Templates與LineWebhook，另外25模組逐位元保留。兩個固定入口v134，API health、不可變版來源與URL／權限／執行設定均核對通過。
- 工作區20支測試全過；公開隔離快照19支測試全過。公開來源僅三檔。
- 原生LINE重新送出：幫助3.229秒首見完整回覆；填表狀態28.001秒首見完整卡片（連續螢幕觀察，近似值，不承諾固定秒數）；上一試次30.040秒時已出現。卡片項目與既有狀態符合。
- 設備metadata去重不足以解決整體LINE狀態延遲；後續針對日檢填報紀錄重複讀取，另立有限兩模組切片，不將本輪read counts轉成秒數效益。
- 公開來源commit：ee12764584c29f4b5d1e1cdd800f293c97362382，僅Templates.gs／LineWebhook.gs／新測試；本機Git index／refs不移動。
