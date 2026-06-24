# ISHA 教學素材截圖盤點

更新日期：2026-06-24

本清單用來判斷哪些素材已經是目前實際畫面、哪些是示意圖、哪些需要人工補截。

## 已由系統重抓，可直接使用

以下畫面來自目前公開前端頁面，不需要再手動截圖。

| 檔案 | 對應畫面 | 來源 | 狀態 |
|---|---|---|---|
| `docs/screenshots/01-workbench-home.png` | 工作台首頁 | `index.html` | 已更新為目前「快速填報」新版首頁 |
| `docs/screenshots/02-daily-incident-form.png` | 日常異常事件通報表 | `incident.html` | 已更新為目前實際表單 |
| `docs/screenshots/03-daily-check-form.png` | 每日作業前檢點表 | `daily.html?eqp=CRANE-LJ-001` | 已更新為目前固定式起重機日檢表 |
| `docs/screenshots/04-monthly-check-form.png` | 每月定期檢查紀錄 | `monthly.html?eqp=CRANE-LJ-001` | 已更新為目前固定式起重機月檢表 |

## 流程圖用同步截圖

以下檔案已同步更新，供流程圖 HTML 或流程圖 PDF 使用。

| 檔案 | 對應畫面 | 類型 |
|---|---|---|
| `docs/flowcharts/screenshots/workbench-home-current.png` | 工作台首頁 | 首屏截圖 |
| `docs/flowcharts/screenshots/daily-incident-form-current.png` | 日常異常事件通報表 | 首屏截圖 |
| `docs/flowcharts/screenshots/daily-check-current.png` | 每日作業前檢點表 | 首屏截圖 |
| `docs/flowcharts/screenshots/monthly-check-current.png` | 每月定期檢查紀錄 | 首屏截圖 |
| `docs/flowcharts/screenshots/03-daily-check-form.png` | 每日作業前檢點表 | 全頁截圖 |
| `docs/flowcharts/screenshots/04-monthly-check-form.png` | 每月定期檢查紀錄 | 全頁截圖 |

## 由設計資產產生，可直接使用

以下畫面不是手機實機截圖，而是目前 LINE 圖文選單正式圖片資產的縮圖。若只要在說明書或簡報展示「圖文選單長相」，可直接使用；若要展示 LINE 手機介面含聊天列，才需要補實機截圖。

| 檔案 | 對應畫面 | 來源 | 狀態 |
|---|---|---|---|
| `docs/screenshots/07-line-rich-menu.png` | LINE 圖文選單 | `assets/line-rich-menu-main.png` | 已更新為大字清晰版 |
| `docs/flowcharts/screenshots/07-line-rich-menu.png` | LINE 圖文選單 | `assets/line-rich-menu-main.png` | 已同步更新 |
| `docs/screenshots/daily-work-rich-menu-highlight.png` | LINE 圖文選單「待發文」圈選圖 | `assets/line-rich-menu-main.png` | 已由舊每日作業入口改為待發文 |

## 可沿用但不是自動驗證畫面

以下畫面需要有效 token、LINE 手機畫面或真實權限，系統無法保證與目前實機完全一致。若只是教學說明，可沿用；若要展示最新實機畫面，請手動補截。

| 檔案 | 畫面 | 判斷 |
|---|---|---|
| `docs/screenshots/05-incident-update-page.png` | 日常事件處理回報頁 | 需有效事件 token，現有圖可作示意 |
| `docs/screenshots/06-incident-approval-page.png` | 日常事件主管審核頁 | 需主管審核 token，現有圖可作示意 |

## 模擬圖，不需要追求實機一致

以下圖檔是教學用模擬對話或流程圖，不是 LINE 官方截圖。除非流程文字改了，不需要手動補截。

| 檔案 | 用途 |
|---|---|
| `docs/flowcharts/assets/handler-line-chat.png` | 日常事件承辦 LINE 模擬對話 |
| `docs/flowcharts/assets/supervisor-line-chat.png` | 日常事件主管 LINE 模擬對話 |
| `docs/flowcharts/assets/inspection-inspector-line-chat.png` | 各類檢查檢查人 LINE 模擬對話 |
| `docs/flowcharts/assets/inspection-supervisor-line-chat.png` | 各類檢查主管 LINE 模擬對話 |
| `docs/flowcharts/assets/handler-flow.png` | 日常事件承辦流程圖 |
| `docs/flowcharts/assets/supervisor-flow.png` | 日常事件主管流程圖 |
| `docs/flowcharts/assets/inspection-inspector-flow.png` | 各類檢查檢查人流程圖 |
| `docs/flowcharts/assets/inspection-supervisor-flow.png` | 各類檢查主管流程圖 |

## 需要手動補截的清單

這些畫面無法由本地公開網頁自動取得，若教學簡報要放「真實畫面」，請從手機或登入後畫面手動截圖。

| 優先度 | 畫面 | 補截時機 |
|---|---|---|
| 中 | LINE 圖文選單實機畫面 | 執行 `installDefaultLineRichMenu` 後，若簡報需要手機聊天列與圖文選單實機畫面，再另存實機截圖 |
| 高 | 日常異常事件 LINE 圖卡資訊 | 新增一筆日常異常事件後，截訂閱者或群組收到的圖卡 |
| 高 | 主管收到日常異常事件通知 | 狀態為處理中且填主管、或處理完成送審時，截主管端收到的圖卡 |
| 中 | 主管填寫處理意見畫面 | 使用有效事件 token 進入主管意見頁時截圖 |
| 中 | 承辦處理回報頁真實事件 | 使用有效事件 token 進入處理回報頁時截圖 |
| 中 | 主管審核結案頁真實事件 | 使用有效主管審核 token 進入審核頁時截圖 |
| 中 | LINE 指令回覆圖卡：`狀態` | 在 LINE 對話輸入 `狀態` 後截圖 |
| 中 | LINE 指令回覆圖卡：`異常` | 在 LINE 對話輸入 `異常` 後截圖 |
| 中 | LINE 指令回覆圖卡：`待處理` | 有未結案事件時輸入 `待處理` 後截圖 |
| 低 | Google Drive 歸檔資料夾 | 登入協會帳號後截實際資料夾位置 |
| 低 | Google Sheets 主要工作表分頁 | 登入試算表後截「訂閱者清單」與日常事件/檢查紀錄分頁 |

## 建議放進簡報的比例

不建議每張都放實際畫面。建議比例：

- 60%：流程圖、LINE 模擬對話、角色任務圖，讓主管快速懂流程。
- 30%：已更新的實際網站畫面，例如首頁、通報表、日檢、月檢。
- 10%：手動補截的關鍵真機畫面，例如 LINE 圖卡、主管收到通知。
