# 機具異常處理後照片、指定核判主管、LINE 流程進度（2026-11-14）

- lease_status: 完成（v147 已上線；待真實異常處理與主管核判確認）
- 分支：`feature/machine-incident-photo-supervisor`，功能 `467ab3c`、發布 build `9033a0c`

## 需求（hao）

1. 機具設備異常處理回報沒有處理後照片。
2. 沒有指定由哪一位主管核判（階層）。
3. LINE 圖卡上直接看到流程到哪一步。

澄清：單一指定主管，由處理人從下拉選；只有異常才需要主管核判，正常檢查不變；進度條機具異常與日常異常都要；照片選填、上限同日常異常（8 張）。

## 改動

- `MachineIncidentHandling.gs`／`MachineIncidentHandlingPage.html`：處理後照片（存「異常處理紀錄/照片/<紀錄ID>」，併入 PDF）；全部完成時必選核判主管；日檢異常改為「待主管簽核」，指定主管在頁面核准（產生 PDF 歸檔）或退回（須填原因，清除完成日，通知處理人）；主管通知失敗可從頁面重送。
- `LineNotify.gs`：月檢簽核推播給指定主管（找不到才回退全體主管）；`buildFlowProgressBox_` 進度條加到機具異常與日常異常各圖卡。
- `Setup.gs`：6 個新欄位（處理照片數、處理照片資料夾、指定主管、指定主管Key、處理人Key、主管核判意見）納入白名單；未結案清單帶核判狀態。舊表讀取不寫入，寫入路徑在鎖內補欄。
- 測試：新增 `scripts/test-machine-incident-review-flow.js`（16 情境）；全套 27 支通過。

## 審閱

Claude CLI（opus-4-8 high）三輪：第一輪 FAIL（主管看不到內容與照片、通知失敗無補救、空步驟、讀取路徑寫欄、退回未清完成日）→ 修；第二輪 FAIL（巢狀鎖提早釋放、每次載入照片、舊圖閃現）→ 修；第三輪 PASS。

## v147（11/14）

- hao 回「正式上線 v147」。上線前已說明：沒有給現場用的測試環境，只能正式上線；日檢異常改為主管核准才歸檔。
- build `2026-11-14-machine-incident-review`（同步更新 `test-settings-read-snapshot.js` 的固定 build）。
- 發布：雲端 HEAD、v146、`36fadbf` 三者除 Config 與 manifest 外逐位元相同；受限套件只換 LineNotify、MachineIncidentHandling、MachineIncidentHandlingPage、Setup、Main；push 後 HEAD 與 v147 都和套件逐位元相同；兩個固定部署 @147（`clasp --user isha263`）。
- 驗證：兩入口 health 正常、build 正確；處理頁無參數時正確顯示「連結缺少必要參數」。未做真實送件與 LINE 推播（會發訊息給真人）。
- 回滾：兩部署改回 v146；觸發器跑 HEAD，要再 push v146 內容才會退回。新增的 6 欄留著不影響 v146；但 v146 的 `setupSheets` 白名單沒有這 6 欄，回滾後不要執行初始化，否則會刪掉新欄。

## 未做（範圍外）

- LINE 待核判清單與排程提醒（LineWebhook／Reminder）。
- 是否禁止處理人自己當核判主管（制度決定）。
